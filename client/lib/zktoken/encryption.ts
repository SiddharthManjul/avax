/**
 * encryption.ts — MemoEncryptor
 *
 * ECDH + AES-256-GCM encrypted memos for the ZkToken shielded pool.
 *
 * Protocol (matching CLAUDE.md spec):
 *   Sender side:
 *     1. Generate ephemeral Baby Jubjub keypair: (ek_priv, ek_pub)
 *     2. shared_point = ECDH(ek_priv, recipient_pub_key)
 *     3. aes_key = SHA-256(shared_point.x || shared_point.y) — 32 bytes
 *     4. plaintext = [amount, blinding, secret, nullifierPreimage] — each 32 bytes = 128 bytes
 *     5. Encrypt with AES-256-GCM, random 12-byte nonce
 *     6. Wire format: ek_pub(64B) || nonce(12B) || ciphertext(128B) || GCM_tag(16B) = 220 bytes
 *
 *   Recipient side (trial decryption):
 *     1. Extract ek_pub from the first 64 bytes of memo
 *     2. shared_point = ECDH(my_priv_key, ek_pub)
 *     3. Derive aes_key the same way
 *     4. Attempt AES-256-GCM decryption — if GCM tag verification fails → not for me
 *     5. If succeeds → decode plaintext → reconstruct note
 */

import { KeyManager } from "./keys";
import type { BabyJubPoint, NoteMemoData } from "./types";
import { bytesToHex } from "./utils";
export type { NoteMemoData };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get the backing ArrayBuffer of a Uint8Array (handles subarrays). */
function toBuffer(u: Uint8Array): ArrayBuffer {
  return (u.buffer as ArrayBuffer).slice(u.byteOffset, u.byteOffset + u.byteLength);
}

// ─── Wire-format constants ────────────────────────────────────────────────────

/** Bytes for the ephemeral public key (x + y, 32 bytes each). */
const EK_PUB_BYTES = 64;
/** AES-GCM nonce length. */
const NONCE_BYTES = 12;
/** Plaintext length: 4 × 32-byte BigUint256. */
const PLAINTEXT_BYTES = 128;
/** GCM authentication tag length. */
const TAG_BYTES = 16;
/** Total memo wire-format length in bytes. */
export const MEMO_BYTES = EK_PUB_BYTES + NONCE_BYTES + PLAINTEXT_BYTES + TAG_BYTES; // 220

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Encode a bigint as a 32-byte big-endian Uint8Array. */
function bigintTo32Bytes(v: bigint): Uint8Array {
  const hex = v.toString(16).padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Decode a 32-byte big-endian Uint8Array to bigint. */
function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt("0x" + bytesToHex(bytes));
}

/** Concatenate Uint8Arrays or ArrayBuffers into a single Uint8Array. */
function concat(...arrays: (Uint8Array | ArrayBuffer)[]): Uint8Array {
  const bufs = arrays.map((a) => (a instanceof Uint8Array ? a : new Uint8Array(a)));
  const len = bufs.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const a of bufs) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/** Derive AES-256-GCM key from a Baby Jubjub shared point using SHA-256. */
async function deriveAesKey(sharedPoint: BabyJubPoint): Promise<CryptoKey> {
  const xBytes = bigintTo32Bytes(sharedPoint[0]);
  const yBytes = bigintTo32Bytes(sharedPoint[1]);
  const keyMaterial = concat(xBytes, yBytes);

  // SHA-256 of the shared point coordinates
  const rawKey = await crypto.subtle.digest("SHA-256", toBuffer(keyMaterial));

  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Generate a random 12-byte nonce for AES-GCM. */
function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(nonce);
  return nonce;
}

// ─── Plaintext encode/decode ──────────────────────────────────────────────────

/**
 * Encode NoteMemoData into 128 bytes:
 *   [amount(32)][blinding(32)][secret(32)][nullifierPreimage(32)]
 */
function encodeMemoPlaintext(data: NoteMemoData): Uint8Array {
  return concat(
    bigintTo32Bytes(data.amount),
    bigintTo32Bytes(data.blinding),
    bigintTo32Bytes(data.secret),
    bigintTo32Bytes(data.nullifierPreimage)
  );
}

/** Decode 128 bytes back to NoteMemoData. */
function decodeMemoPlaintext(bytes: Uint8Array): NoteMemoData {
  if (bytes.length !== PLAINTEXT_BYTES) {
    throw new Error(`decodeMemoPlaintext: expected ${PLAINTEXT_BYTES} bytes, got ${bytes.length}`);
  }
  return {
    amount: bytes32ToBigint(bytes.slice(0, 32)),
    blinding: bytes32ToBigint(bytes.slice(32, 64)),
    secret: bytes32ToBigint(bytes.slice(64, 96)),
    nullifierPreimage: bytes32ToBigint(bytes.slice(96, 128)),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypt note memo data for a recipient.
 *
 * @param noteData       The note fields to transmit.
 * @param recipientPubKey Recipient's Baby Jubjub public key.
 * @returns              Encrypted memo bytes (220 bytes).
 */
export async function encryptMemo(
  noteData: NoteMemoData,
  recipientPubKey: BabyJubPoint
): Promise<Uint8Array> {
  // 1. Generate ephemeral keypair
  const ephemeral = await KeyManager.generate();
  const ekPub = ephemeral.publicKey;
  const ekPriv = ephemeral.privateKey;

  // 2. ECDH shared secret
  const sharedPoint = await KeyManager.ecdh(ekPriv, recipientPubKey);

  // 3. Derive AES key
  const aesKey = await deriveAesKey(sharedPoint);

  // 4. Encrypt plaintext
  const nonce = randomNonce();
  const plaintext = encodeMemoPlaintext(noteData);
  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBuffer(nonce), tagLength: 128 },
    aesKey,
    toBuffer(plaintext)
  );

  // 5. Pack: ekPub.x(32) || ekPub.y(32) || nonce(12) || ciphertext+tag(144)
  return concat(
    bigintTo32Bytes(ekPub[0]),
    bigintTo32Bytes(ekPub[1]),
    nonce,
    ciphertextWithTag
  );
}

/**
 * Attempt to decrypt a memo using the recipient's private key.
 *
 * Returns `null` if decryption fails (memo is not addressed to this key).
 *
 * @param memo       Raw memo bytes from a PrivateTransfer/Withdrawal event.
 * @param myPrivKey  Recipient's Baby Jubjub private key.
 */
export async function decryptMemo(
  memo: Uint8Array,
  myPrivKey: bigint
): Promise<NoteMemoData | null> {
  if (memo.length < EK_PUB_BYTES + NONCE_BYTES + TAG_BYTES) {
    return null; // too short to be valid
  }

  try {
    // 1. Extract wire-format fields
    const ekPubX = bytes32ToBigint(memo.slice(0, 32));
    const ekPubY = bytes32ToBigint(memo.slice(32, 64));
    const ekPub: BabyJubPoint = [ekPubX, ekPubY];
    const nonce = memo.slice(64, 76);
    const ciphertextWithTag = memo.slice(76); // ciphertext(128) + tag(16)

    // 2. ECDH shared secret
    const sharedPoint = await KeyManager.ecdh(myPrivKey, ekPub);

    // 3. Derive AES key
    const aesKey = await deriveAesKey(sharedPoint);

    // 4. Decrypt (throws DOMException if GCM tag fails)
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toBuffer(nonce), tagLength: 128 },
      aesKey,
      toBuffer(ciphertextWithTag)
    );

    return decodeMemoPlaintext(new Uint8Array(plaintext));
  } catch {
    // GCM authentication failed — this memo is not for us
    return null;
  }
}

// ─── Event scanning ───────────────────────────────────────────────────────────

/** A decoded PrivateTransfer or Withdrawal event with memo bytes. */
export interface MemoEvent {
  /** Raw encrypted memo bytes. */
  memoBytes: Uint8Array;
  /** Commitment this memo describes (commitment1, commitment2, or changeCommitment). */
  commitment: bigint;
  /** Leaf index of the described commitment in the Merkle tree. */
  leafIndex: number;
  /** Block number of the event. */
  blockNumber: number;
  /** Type of event. */
  eventType: "transfer" | "withdrawal";
}

/**
 * Trial-decrypt all memo events with the given private key.
 * Returns decoded note data for any memos that successfully decrypt.
 *
 * This is the core mechanism for recipients to discover incoming notes.
 * It is O(n) in the number of events — use a background worker for large
 * event sets, or offload to a trusted scanning server.
 */
export async function scanMemos(
  events: MemoEvent[],
  myPrivKey: bigint
): Promise<Array<{ memoData: NoteMemoData; commitment: bigint; leafIndex: number; blockNumber: number }>> {
  const results: Array<{ memoData: NoteMemoData; commitment: bigint; leafIndex: number; blockNumber: number }> = [];

  for (const event of events) {
    const memoData = await decryptMemo(event.memoBytes, myPrivKey);
    if (memoData !== null) {
      results.push({
        memoData,
        commitment: event.commitment,
        leafIndex: event.leafIndex,
        blockNumber: event.blockNumber,
      });
    }
  }

  return results;
}
