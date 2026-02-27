/**
 * types.ts — Shared type definitions for the ZkToken Client SDK.
 *
 * The note model mirrors the on-chain Poseidon Merkle tree and the ZK circuit
 * signal layout. All bigint values are field elements in the BN254 scalar field
 * unless otherwise noted.
 */

// ─── Curve / cryptographic primitives ────────────────────────────────────────

/** A point on the Baby Jubjub curve (twisted Edwards form). */
export type BabyJubPoint = [bigint, bigint];

/** A Baby Jubjub keypair. The private key is a scalar < subgroup order. */
export interface BabyJubKeyPair {
  /** Private key: random scalar < L (Baby Jubjub subgroup order) */
  privateKey: bigint;
  /** Public key: privateKey * Base8 */
  publicKey: BabyJubPoint;
}

// ─── Note ────────────────────────────────────────────────────────────────────

/**
 * A private token holding inside the shielded pool.
 *
 * Two derived on-chain values:
 *   pedersenCommitment = amount * G + blinding * H   (Baby Jubjub EC point)
 *   noteCommitment     = Poseidon(ped.x, ped.y, secret, nullifierPreimage, ownerPk.x)
 *
 * The nullifier is derived when the note is spent:
 *   nullifier = Poseidon(nullifierPreimage, secret, leafIndex)
 */
export interface Note {
  /** Token amount (uint64 range: 0 to 2^64 - 1). */
  amount: bigint;
  /** Random blinding factor for Pedersen commitment. */
  blinding: bigint;
  /** Random 31-byte secret known only to the note owner. */
  secret: bigint;
  /** Random 31-byte value, separate from secret, never appears on-chain. */
  nullifierPreimage: bigint;
  /** Baby Jubjub public key of the note owner (x, y). */
  ownerPublicKey: BabyJubPoint;

  // ── Derived fields (computed at creation) ──────────────────────────────────
  /** Pedersen commitment point: amount * G + blinding * H. */
  pedersenCommitment: BabyJubPoint;
  /** Note commitment (Merkle leaf): Poseidon(ped.x, ped.y, secret, nullifierPreimage, ownerPk.x). */
  noteCommitment: bigint;
  /** Nullifier: Poseidon(nullifierPreimage, secret, leafIndex). Set after leafIndex is known. */
  nullifier: bigint;

  // ── On-chain reference ─────────────────────────────────────────────────────
  /** Leaf index in the on-chain Merkle tree. */
  leafIndex: number;
  /** Whether this note has been spent (nullifier revealed). */
  spent: boolean;
  /** ERC20 token contract address this note represents. */
  tokenAddress: string;
  /** Block number when this note was created (for re-sync optimisation). */
  createdAtBlock: number;
}

/** Plaintext note data encoded in the encrypted memo (128 bytes on-chain). */
export interface NoteMemoData {
  amount: bigint;
  blinding: bigint;
  secret: bigint;
  nullifierPreimage: bigint;
}

// ─── Merkle ───────────────────────────────────────────────────────────────────

/** Merkle inclusion proof for a single leaf. */
export interface MerklePath {
  /** Root the proof is relative to. */
  root: bigint;
  /** Sibling hashes from leaf to root (length = tree depth). */
  pathElements: bigint[];
  /** Path direction bits: 0 = current node is left child, 1 = right child (length = tree depth). */
  pathIndices: number[];
  /** Leaf index in the tree. */
  leafIndex: number;
}

// ─── Proofs ───────────────────────────────────────────────────────────────────

/** Raw Groth16 proof components as returned by snarkjs. */
export interface Groth16Proof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve: string;
}

/** Result of a transfer proof generation. */
export interface TransferProofResult {
  /** ABI-encoded proof bytes (256 bytes) for ShieldedPool.transfer(). */
  proofBytes: Uint8Array;
  /** Public signals: [merkleRoot, nullifierHash, newCommitment1, newCommitment2]. */
  publicSignals: [bigint, bigint, bigint, bigint];
  /** Recipient output note (to share with recipient via encrypted memo). */
  recipientNote: Note;
  /** Change note returned to sender. */
  changeNote: Note;
  /** Raw proof for debugging / alternative encoding. */
  rawProof: Groth16Proof;
}

/** Result of a withdraw proof generation. */
export interface WithdrawProofResult {
  /** ABI-encoded proof bytes (256 bytes) for ShieldedPool.withdraw(). */
  proofBytes: Uint8Array;
  /** Public signals: [merkleRoot, nullifierHash, amount, changeCommitment]. */
  publicSignals: [bigint, bigint, bigint, bigint];
  /** Change note (undefined for full withdrawals). */
  changeNote?: Note;
  /** Raw proof for debugging / alternative encoding. */
  rawProof: Groth16Proof;
}

// ─── Transaction parameters ───────────────────────────────────────────────────

export interface DepositParams {
  /** EthersJS signer for sending the transaction. */
  signer: EthersSigner;
  /** ShieldedPool contract address. */
  poolAddress: string;
  /** ERC20 token address. */
  tokenAddress: string;
  /** Amount to deposit (in token base units). */
  amount: bigint;
  /** Owner's Baby Jubjub public key for the new note. */
  ownerPublicKey: BabyJubPoint;
}

export interface TransferParams {
  /** EthersJS signer. */
  signer: EthersSigner;
  /** ShieldedPool contract address. */
  poolAddress: string;
  /** EthersJS provider for event querying. */
  provider: EthersProvider;
  /** Note to spend. */
  inputNote: Note;
  /** Amount to send to recipient. */
  transferAmount: bigint;
  /** Recipient's Baby Jubjub public key. */
  recipientPublicKey: BabyJubPoint;
  /** Sender's Baby Jubjub public key (for change note). */
  senderPublicKey: BabyJubPoint;
  /** Sender's Baby Jubjub private key (needed to prove ownership in circuit). */
  senderPrivateKey: bigint;
  /** Path to transfer.wasm (URL in browser, filesystem path in Node). */
  wasmPath: string;
  /** Path to transfer_final.zkey. */
  zkeyPath: string;
}

export interface WithdrawParams {
  /** EthersJS signer. */
  signer: EthersSigner;
  /** ShieldedPool contract address. */
  poolAddress: string;
  /** EthersJS provider for event querying. */
  provider: EthersProvider;
  /** Note to spend. */
  inputNote: Note;
  /** Amount to withdraw (0 < withdrawAmount <= inputNote.amount). */
  withdrawAmount: bigint;
  /** EVM recipient address for the released tokens. */
  recipient: string;
  /** Sender's public key (for change note if partial withdrawal). */
  senderPublicKey: BabyJubPoint;
  /** Sender's Baby Jubjub private key (needed to prove ownership in circuit). */
  senderPrivateKey: bigint;
  /** Path to withdraw.wasm. */
  wasmPath: string;
  /** Path to withdraw_final.zkey. */
  zkeyPath: string;
}

// ─── Minimal ethers type aliases (avoids importing ethers at top-level) ───────

/** Minimal interface for an ethers v6 Signer. */
export interface EthersSigner {
  getAddress(): Promise<string>;
  sendTransaction(tx: EthersTransactionRequest): Promise<EthersTransactionResponse>;
  provider: EthersProvider | null;
}

/** Minimal interface for an ethers v6 Provider. */
export interface EthersProvider {
  getLogs(filter: EthersLogFilter): Promise<EthersLog[]>;
  getBlockNumber(): Promise<number>;
  getNetwork(): Promise<{ chainId: bigint }>;
}

export interface EthersTransactionRequest {
  to?: string;
  data?: string;
  value?: bigint;
}

export interface EthersTransactionResponse {
  hash: string;
  wait(): Promise<EthersTransactionReceipt>;
}

export interface EthersTransactionReceipt {
  blockNumber: number;
  status: number | null;
}

export interface EthersLogFilter {
  address?: string;
  topics?: (string | null | string[])[];
  fromBlock?: number | string;
  toBlock?: number | string;
}

export interface EthersLog {
  topics: string[];
  data: string;
  blockNumber: number;
  transactionHash: string;
}

// ─── ShieldedPool ABI ─────────────────────────────────────────────────────────

/** Minimal ABI fragments needed by the SDK. */
export const SHIELDED_POOL_ABI = [
  // deposit(uint256 amount, uint256 commitment)
  "function deposit(uint256 amount, uint256 commitment) external",

  // transfer(bytes proof, uint256 merkleRoot, uint256 nullifierHash,
  //          uint256 newCommitment1, uint256 newCommitment2,
  //          bytes encryptedMemo1, bytes encryptedMemo2)
  "function transfer(bytes calldata proof, uint256 merkleRoot, uint256 nullifierHash, uint256 newCommitment1, uint256 newCommitment2, bytes calldata encryptedMemo1, bytes calldata encryptedMemo2) external",

  // withdraw(bytes proof, uint256 merkleRoot, uint256 nullifierHash,
  //          uint256 amount, uint256 changeCommitment,
  //          address recipient, bytes encryptedMemo)
  "function withdraw(bytes calldata proof, uint256 merkleRoot, uint256 nullifierHash, uint256 amount, uint256 changeCommitment, address recipient, bytes calldata encryptedMemo) external",

  // View functions
  "function getRoot() external view returns (uint256)",
  "function getNextLeafIndex() external view returns (uint32)",
  "function isSpent(uint256 nullifierHash) external view returns (bool)",
  "function isKnownRoot(uint256 root) external view returns (bool)",

  // Events
  "event Deposit(uint256 indexed commitment, uint32 leafIndex, uint256 timestamp)",
  "event PrivateTransfer(uint256 nullifierHash, uint256 commitment1, uint256 commitment2, bytes encryptedMemo1, bytes encryptedMemo2)",
  "event Withdrawal(uint256 nullifierHash, address indexed recipient, uint256 amount, uint256 changeCommitment, bytes encryptedMemo)",
] as const;

/** Minimal ERC20 ABI for approve/allowance. */
export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
] as const;
