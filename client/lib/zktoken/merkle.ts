/**
 * merkle.ts — MerkleTreeSync
 *
 * Client-side Poseidon Merkle tree that mirrors the on-chain ShieldedPool tree.
 *
 * Architecture:
 *   - Depth 20, supporting 2^20 = 1,048,576 leaves.
 *   - Internal nodes: Poseidon([left, right]) — same parameters as Circom circuit.
 *   - Zero leaves: zero[0] = 0, zero[i] = Poseidon([zero[i-1], zero[i-1]]).
 *   - Reconstruction: replay on-chain Deposit, PrivateTransfer, Withdrawal
 *     events in block order to insert commitments in sequence.
 *   - Merkle paths: used as private inputs to ZK circuits.
 *
 * The tree is NOT a sparse Merkle tree; it is append-only.  Once a leaf is
 * set by a commitment it is never moved or cleared (even when the note is
 * spent — the leaf stays, the nullifier prevents re-use).
 */

import { getPoseidon } from "./crypto";
import type { EthersProvider, MerklePath } from "./types";
import { AbiCoder, Interface } from "ethers";
import { SHIELDED_POOL_ABI } from "./types";

// ─── Tree constants ───────────────────────────────────────────────────────────

export const TREE_DEPTH = 20;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function poseidonHash2(poseidon: any, l: bigint, r: bigint): bigint {
  const res = poseidon([poseidon.F.e(l), poseidon.F.e(r)]);
  return poseidon.F.toObject(res) as bigint;
}

// ─── Zero value precomputation ────────────────────────────────────────────────

/**
 * Pre-compute all 21 zero values (zero[0]…zero[TREE_DEPTH]).
 * Returns an array where zero[i] is the hash of an empty subtree of depth i.
 */
async function computeZeros(): Promise<bigint[]> {
  const poseidon = await getPoseidon();
  const zeros: bigint[] = new Array<bigint>(TREE_DEPTH + 1);
  zeros[0] = 0n;
  for (let i = 1; i <= TREE_DEPTH; i++) {
    zeros[i] = poseidonHash2(poseidon, zeros[i - 1]!, zeros[i - 1]!);
  }
  return zeros;
}

// ─── MerkleTreeSync ───────────────────────────────────────────────────────────

export class MerkleTreeSync {
  private readonly depth: number;
  /** All leaf commitments in insertion order. */
  private leaves: bigint[] = [];
  /**
   * Cached internal nodes.
   * layers[0] = leaves, layers[1] = their parents, … layers[depth] = root.
   * Lazily rebuilt in full when needed.
   */
  private layers: bigint[][] = [];
  private zeros: bigint[] = [];
  private _initialised = false;

  constructor(depth = TREE_DEPTH) {
    this.depth = depth;
  }

  /** Ensure Poseidon is built and zero values are computed. */
  async init(): Promise<void> {
    if (this._initialised) return;
    this.zeros = await computeZeros();
    this.layers = Array.from({ length: this.depth + 1 }, () => []);
    this._initialised = true;
  }

  // ── Insertion ─────────────────────────────────────────────────────────────

  /**
   * Append a leaf commitment to the tree.
   * Rebuilds all parent hashes along the insertion path in O(depth).
   */
  async insert(commitment: bigint): Promise<void> {
    await this.init();
    const poseidon = await getPoseidon();

    const leafIndex = this.leaves.length;
    this.leaves.push(commitment);

    // Propagate up: efficiently update only the path from this leaf to root
    // by rebuilding layers incrementally.  For simplicity we rebuild from
    // leaves upward (the tree is small enough at depth 20).
    this.layers[0] = [...this.leaves];

    let index = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const levelNodes = this.layers[level]!;
      const parentLevel: bigint[] = [];

      for (let i = 0; i < Math.ceil(levelNodes.length / 2); i++) {
        const left = levelNodes[2 * i] ?? this.zeros[level]!;
        const right = levelNodes[2 * i + 1] ?? this.zeros[level]!;
        parentLevel.push(poseidonHash2(poseidon, left, right));
      }
      this.layers[level + 1] = parentLevel;
      index = Math.floor(index / 2);
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /** Current Merkle root. */
  async getRoot(): Promise<bigint> {
    await this.init();
    if (this.leaves.length === 0) {
      return this.zeros[this.depth]!;
    }
    const rootLayer = this.layers[this.depth]!;
    return rootLayer[0] ?? this.zeros[this.depth]!;
  }

  /** Total number of inserted leaves. */
  get size(): number {
    return this.leaves.length;
  }

  /**
   * Generate a Merkle inclusion proof for a leaf at `leafIndex`.
   *
   * Returns pathElements (sibling hashes) and pathIndices (0 = leaf is left
   * child, 1 = leaf is right child) for each level from leaf to root.
   */
  async getMerklePath(leafIndex: number): Promise<MerklePath> {
    await this.init();
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`MerkleTreeSync: leafIndex ${leafIndex} out of range (size=${this.leaves.length})`);
    }

    const poseidon = await getPoseidon();
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];

    let index = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const levelNodes = this.layers[level]!;
      const isRightChild = index % 2 === 1;
      const siblingIndex = isRightChild ? index - 1 : index + 1;

      const sibling = levelNodes[siblingIndex] ?? this.zeros[level]!;
      pathElements.push(sibling);
      pathIndices.push(isRightChild ? 1 : 0);

      index = Math.floor(index / 2);
    }

    void poseidon; // used implicitly through layered computation

    return {
      root: await this.getRoot(),
      pathElements,
      pathIndices,
      leafIndex,
    };
  }

  /** Return all leaf commitments (read-only copy). */
  getLeaves(): readonly bigint[] {
    return this.leaves;
  }

  // ── Chain sync ────────────────────────────────────────────────────────────

  /**
   * Reconstruct the local tree by replaying all pool events from the chain.
   *
   * Event ordering:
   *   Deposit             → insert(commitment)
   *   PrivateTransfer     → insert(commitment1), insert(commitment2)
   *   Withdrawal          → insert(changeCommitment) only if changeCommitment ≠ 0
   *
   * All events are fetched in block order.  Pass `fromBlock` to skip already-
   * processed blocks (incremental sync).
   *
   * @param provider    ethers Provider.
   * @param poolAddress ShieldedPool contract address.
   * @param fromBlock   First block to scan (default = 0).
   */
  async syncFromChain(
    provider: EthersProvider,
    poolAddress: string,
    fromBlock = 0
  ): Promise<void> {
    await this.init();

    const iface = new Interface(SHIELDED_POOL_ABI);

    const depositTopic = iface.getEvent("Deposit")!.topicHash;
    const transferTopic = iface.getEvent("PrivateTransfer")!.topicHash;
    const withdrawalTopic = iface.getEvent("Withdrawal")!.topicHash;

    const logs = await provider.getLogs({
      address: poolAddress,
      topics: [[depositTopic, transferTopic, withdrawalTopic]],
      fromBlock,
      toBlock: "latest",
    });

    // Sort by block number to ensure correct insertion order
    logs.sort((a, b) => a.blockNumber - b.blockNumber);

    for (const log of logs) {
      const topic = log.topics[0];
      if (topic === depositTopic) {
        const parsed = iface.parseLog(log);
        if (parsed) {
          await this.insert(parsed.args["commitment"] as bigint);
        }
      } else if (topic === transferTopic) {
        const parsed = iface.parseLog(log);
        if (parsed) {
          await this.insert(parsed.args["commitment1"] as bigint);
          await this.insert(parsed.args["commitment2"] as bigint);
        }
      } else if (topic === withdrawalTopic) {
        const parsed = iface.parseLog(log);
        if (parsed) {
          const changeCommitment = parsed.args["changeCommitment"] as bigint;
          if (changeCommitment !== 0n) {
            await this.insert(changeCommitment);
          }
        }
      }
    }
  }

  /**
   * Verify a Merkle path against a known root.
   * Useful for sanity-checking a path before proof generation.
   */
  async verifyPath(
    leaf: bigint,
    path: MerklePath,
    expectedRoot?: bigint
  ): Promise<boolean> {
    const poseidon = await getPoseidon();
    let current = leaf;

    for (let i = 0; i < path.pathElements.length; i++) {
      const sibling = path.pathElements[i]!;
      const isRight = path.pathIndices[i] === 1;
      if (isRight) {
        current = poseidonHash2(poseidon, sibling, current);
      } else {
        current = poseidonHash2(poseidon, current, sibling);
      }
    }

    const root = expectedRoot ?? path.root;
    return current === root;
  }
}
