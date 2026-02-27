/**
 * note.ts — NoteManager
 *
 * Note creation, cryptographic derivation, serialisation, and local storage.
 *
 * A Note is a private token holding in the shielded pool.  Its lifecycle:
 *   1. Created client-side (createNote) before a deposit or transfer.
 *   2. Stored locally via NoteStore.
 *   3. Spent by generating a ZK proof that reveals the nullifier.
 *   4. Marked spent (markSpent) so it is excluded from future selections.
 *
 * Cryptographic identities:
 *   pedersenCommitment = amount * G + blinding * H   (Baby Jubjub)
 *   noteCommitment     = Poseidon([ped.x, ped.y, secret, nullifierPreimage, ownerPk.x])
 *   nullifier          = Poseidon([nullifierPreimage, secret, leafIndex])
 *
 * H generator: computed by scripts/gen_h_point.js (HashToCurve approach):
 *   Hx = 11991158623290214195992298073348058700477835202184614670606597982489144817024
 *   Hy = 21045328185755068580775605509882913360526674377439752325760858626206285218496
 */

import { getBabyJub, getPoseidon } from "./crypto";
import type { BabyJubPoint, Note, NoteMemoData } from "./types";
import { bytesToHex } from "./utils";

// ─── Generator H (from gen_h_point.js) ───────────────────────────────────────

/** x-coordinate of the independently generated Pedersen blinding generator H. */
const H_X =
  11991158623290214195992298073348058700477835202184614670606597982489144817024n;
/** y-coordinate of H. */
const H_Y =
  21045328185755068580775605509882913360526674377439752325760858626206285218496n;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Generate a cryptographically random 31-byte scalar (< field prime). */
function randomBytes31(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  return BigInt("0x" + bytesToHex(bytes));
}

/** Extract a bigint result from a Poseidon hash. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function poseidonHash(poseidon: any, inputs: bigint[]): bigint {
  const result = poseidon(inputs.map((i) => poseidon.F.e(i)));
  return poseidon.F.toObject(result) as bigint;
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * Compute a Pedersen commitment on Baby Jubjub.
 *   C = amount * G + blinding * H
 *
 * G = babyJub.Base8 (standard generator, cofactor-cleared)
 * H = independently generated point (scripts/gen_h_point.js)
 */
export async function computePedersenCommitment(
  amount: bigint,
  blinding: bigint
): Promise<BabyJubPoint> {
  const babyJub = await getBabyJub();
  const F = babyJub.F;

  // G contribution: amount * Base8
  const G = babyJub.Base8;
  const gPart = babyJub.mulPointEscalar(G, amount);

  // H contribution: blinding * H
  const H = [F.e(H_X), F.e(H_Y)];
  const hPart = babyJub.mulPointEscalar(H, blinding);

  // Sum via Baby Jubjub EC addition (twisted Edwards addPoint)
  const sum = babyJub.addPoint(gPart, hPart);

  return [F.toObject(sum[0]) as bigint, F.toObject(sum[1]) as bigint];
}

/**
 * Compute the note commitment (Merkle leaf value).
 *   noteCommitment = Poseidon([ped.x, ped.y, secret, nullifierPreimage, ownerPk.x])
 */
export async function computeNoteCommitment(
  pedersenCommitment: BabyJubPoint,
  secret: bigint,
  nullifierPreimage: bigint,
  ownerPublicKeyX: bigint
): Promise<bigint> {
  const poseidon = await getPoseidon();
  return poseidonHash(poseidon, [
    pedersenCommitment[0],
    pedersenCommitment[1],
    secret,
    nullifierPreimage,
    ownerPublicKeyX,
  ]);
}

/**
 * Compute the nullifier for a note.
 *   nullifier = Poseidon([nullifierPreimage, secret, leafIndex])
 *
 * leafIndex is included to prevent reuse of the same secret+preimage
 * across multiple deposits from producing the same nullifier.
 */
export async function computeNullifier(
  nullifierPreimage: bigint,
  secret: bigint,
  leafIndex: number
): Promise<bigint> {
  const poseidon = await getPoseidon();
  return poseidonHash(poseidon, [nullifierPreimage, secret, BigInt(leafIndex)]);
}

/**
 * Create a new Note with all cryptographic fields derived.
 *
 * leafIndex defaults to -1 (unknown until the deposit tx is mined and the
 * Deposit event is observed).  Update it via `note.leafIndex = <actual>` and
 * then recompute the nullifier with `computeNullifier`.
 *
 * @param amount          Token amount (uint64 range).
 * @param ownerPublicKey  Baby Jubjub public key of the note owner.
 * @param tokenAddress    ERC20 token address this note represents.
 * @param createdAtBlock  Block number at creation (0 if unknown yet).
 */
export async function createNote(
  amount: bigint,
  ownerPublicKey: BabyJubPoint,
  tokenAddress: string,
  createdAtBlock = 0
): Promise<Note> {
  if (amount <= 0n || amount >= 2n ** 64n) {
    throw new Error(`createNote: amount ${amount} out of uint64 range`);
  }

  const blinding = randomBytes31();
  const secret = randomBytes31();
  const nullifierPreimage = randomBytes31();

  const pedersenCommitment = await computePedersenCommitment(amount, blinding);
  const noteCommitment = await computeNoteCommitment(
    pedersenCommitment,
    secret,
    nullifierPreimage,
    ownerPublicKey[0]
  );

  return {
    amount,
    blinding,
    secret,
    nullifierPreimage,
    ownerPublicKey,
    pedersenCommitment,
    noteCommitment,
    nullifier: 0n, // set later when leafIndex is assigned
    leafIndex: -1, // unknown until on-chain
    spent: false,
    tokenAddress: tokenAddress.toLowerCase(),
    createdAtBlock,
  };
}

/**
 * Finalise a note after its leaf index is known (from the Deposit event).
 * Also computes and sets the nullifier.
 *
 * Returns a new Note object (does not mutate the input).
 */
export async function finaliseNote(note: Note, leafIndex: number): Promise<Note> {
  const nullifier = await computeNullifier(
    note.nullifierPreimage,
    note.secret,
    leafIndex
  );
  return { ...note, leafIndex, nullifier };
}

/**
 * Reconstruct a Note received from an encrypted memo.
 *
 * After ECDH decryption the recipient has `NoteMemoData`.  They then derive
 * the Pedersen commitment, noteCommitment, and eventually the nullifier (once
 * the leafIndex is known from the PrivateTransfer event).
 */
export async function noteFromMemoData(
  memoData: NoteMemoData,
  ownerPublicKey: BabyJubPoint,
  tokenAddress: string,
  leafIndex: number,
  createdAtBlock: number
): Promise<Note> {
  const pedersenCommitment = await computePedersenCommitment(
    memoData.amount,
    memoData.blinding
  );
  const noteCommitment = await computeNoteCommitment(
    pedersenCommitment,
    memoData.secret,
    memoData.nullifierPreimage,
    ownerPublicKey[0]
  );
  const nullifier = await computeNullifier(
    memoData.nullifierPreimage,
    memoData.secret,
    leafIndex
  );

  return {
    amount: memoData.amount,
    blinding: memoData.blinding,
    secret: memoData.secret,
    nullifierPreimage: memoData.nullifierPreimage,
    ownerPublicKey,
    pedersenCommitment,
    noteCommitment,
    nullifier,
    leafIndex,
    spent: false,
    tokenAddress: tokenAddress.toLowerCase(),
    createdAtBlock,
  };
}

// ─── Serialisation ────────────────────────────────────────────────────────────

/** Serialise a Note to a JSON string (bigint → hex string). */
export function encodeNote(note: Note): string {
  return JSON.stringify({
    amount: "0x" + note.amount.toString(16),
    blinding: "0x" + note.blinding.toString(16),
    secret: "0x" + note.secret.toString(16),
    nullifierPreimage: "0x" + note.nullifierPreimage.toString(16),
    ownerPublicKey: [
      "0x" + note.ownerPublicKey[0].toString(16),
      "0x" + note.ownerPublicKey[1].toString(16),
    ],
    pedersenCommitment: [
      "0x" + note.pedersenCommitment[0].toString(16),
      "0x" + note.pedersenCommitment[1].toString(16),
    ],
    noteCommitment: "0x" + note.noteCommitment.toString(16),
    nullifier: "0x" + note.nullifier.toString(16),
    leafIndex: note.leafIndex,
    spent: note.spent,
    tokenAddress: note.tokenAddress,
    createdAtBlock: note.createdAtBlock,
  });
}

/** Deserialise a Note from a JSON string. */
export function decodeNote(json: string): Note {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = JSON.parse(json) as any;
  return {
    amount: BigInt(d.amount),
    blinding: BigInt(d.blinding),
    secret: BigInt(d.secret),
    nullifierPreimage: BigInt(d.nullifierPreimage),
    ownerPublicKey: [BigInt(d.ownerPublicKey[0]), BigInt(d.ownerPublicKey[1])],
    pedersenCommitment: [
      BigInt(d.pedersenCommitment[0]),
      BigInt(d.pedersenCommitment[1]),
    ],
    noteCommitment: BigInt(d.noteCommitment),
    nullifier: BigInt(d.nullifier),
    leafIndex: d.leafIndex as number,
    spent: d.spent as boolean,
    tokenAddress: d.tokenAddress as string,
    createdAtBlock: d.createdAtBlock as number,
  };
}

// ─── NoteStore ────────────────────────────────────────────────────────────────

/**
 * In-memory note store.
 *
 * Keyed by noteCommitment (hex string).  In a production browser client this
 * would be backed by IndexedDB; in Node.js by LevelDB.  The in-memory
 * implementation is sufficient for integration tests and server-side usage.
 */
export class NoteStore {
  private readonly _notes = new Map<string, Note>();

  private key(note: Note): string {
    return "0x" + note.noteCommitment.toString(16);
  }

  /** Upsert a note. */
  save(note: Note): void {
    this._notes.set(this.key(note), { ...note });
  }

  /** Return all notes, optionally filtered by token address. */
  getAll(tokenAddress?: string): Note[] {
    const all = [...this._notes.values()];
    if (!tokenAddress) return all;
    const addr = tokenAddress.toLowerCase();
    return all.filter((n) => n.tokenAddress === addr);
  }

  /** Return only unspent notes. */
  getUnspent(tokenAddress?: string): Note[] {
    return this.getAll(tokenAddress).filter((n) => !n.spent);
  }

  /**
   * Mark a note as spent by its nullifier.
   * Iterates all notes — acceptable for small stores (< 10k notes).
   */
  markSpent(nullifier: bigint): boolean {
    for (const [k, note] of this._notes) {
      if (note.nullifier === nullifier) {
        this._notes.set(k, { ...note, spent: true });
        return true;
      }
    }
    return false;
  }

  /** Remove all notes (useful for testing). */
  clear(): void {
    this._notes.clear();
  }

  /** Total number of stored notes (spent + unspent). */
  get size(): number {
    return this._notes.size;
  }
}
