/**
 * relay-notify.ts — Client-side notification relay module.
 *
 * After a transfer or withdrawal, the sender posts an encrypted notification
 * for the recipient. The recipient checks the relay on login for instant
 * note discovery without full memo scanning.
 *
 * Privacy:
 *   - Tag = poseidon(recipientPubKey.x, recipientPubKey.y) — unlinkable to wallet
 *   - Payload = AES-256-GCM encrypted to recipient's Baby Jubjub key
 *   - Relay sees opaque tag → encrypted blob mappings, nothing else
 */

import { getPoseidon } from "./crypto";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { encryptMemo, decryptMemo } from "./encryption";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { BabyJubPoint, NoteMemoData } from "./types";
import { bytesToHex, hexToBytes } from "./utils";

const NOTIFY_URL = "/api/notify";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NotificationData {
  /** Transaction hash of the on-chain transfer. */
  txHash: string;
  /** Leaf index of the note in the Merkle tree. */
  leafIndex: number;
  /** Block number where the event was included. */
  blockNumber: number;
  /** Event type that created this note. */
  eventType: "transfer" | "withdrawal";
  /** The encrypted memo hex from the on-chain event (contains the actual note data). */
  memoHex: string;
  /** The note commitment (for deduplication). */
  commitment: string;
}

export interface ReceivedNotification {
  id: string;
  data: NotificationData;
  timestamp: number;
}

// ─── Tag derivation ─────────────────────────────────────────────────────────

/**
 * Derive a recipient tag from their Baby Jubjub public key.
 * tag = poseidon(pubKey.x, pubKey.y) — deterministic, unlinkable to wallet.
 */
export async function deriveTag(pubKey: BabyJubPoint): Promise<string> {
  const poseidon = await getPoseidon();
  const hash = poseidon([poseidon.F.e(pubKey[0]), poseidon.F.e(pubKey[1])]);
  const tag = poseidon.F.toObject(hash) as bigint;
  return tag.toString();
}

// ─── Payload encryption ─────────────────────────────────────────────────────

/**
 * Encrypt notification data for a recipient.
 * Uses the same ECDH + AES-256-GCM scheme as memo encryption.
 * The plaintext is JSON-encoded notification data.
 */
async function encryptNotification(
  data: NotificationData,
  recipientPubKey: BabyJubPoint
): Promise<string> {
  const json = JSON.stringify(data);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(json);

  // We reuse the memo encryption infrastructure but with arbitrary-length plaintext.
  // Pack into a simple format: use ECDH to derive a shared key, AES-GCM encrypt.
  const { KeyManager } = await import("./keys");
  const ephemeral = await KeyManager.generate();
  const sharedPoint = await KeyManager.ecdh(
    ephemeral.privateKey,
    recipientPubKey
  );

  // Derive AES key from shared point
  const xHex = sharedPoint[0].toString(16).padStart(64, "0");
  const yHex = sharedPoint[1].toString(16).padStart(64, "0");
  const keyMaterial = hexToBytes(xHex + yHex);
  const rawKey = await crypto.subtle.digest(
    "SHA-256",
    (keyMaterial.buffer as ArrayBuffer).slice(
      keyMaterial.byteOffset,
      keyMaterial.byteOffset + keyMaterial.byteLength
    )
  );
  const aesKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce.buffer as ArrayBuffer },
      aesKey,
      (bytes.buffer as ArrayBuffer).slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      )
    )
  );

  // Wire format: ekPub.x(32) || ekPub.y(32) || nonce(12) || ciphertext+tag(variable)
  const ekX = hexToBytes(
    ephemeral.publicKey[0].toString(16).padStart(64, "0")
  );
  const ekY = hexToBytes(
    ephemeral.publicKey[1].toString(16).padStart(64, "0")
  );

  const total = new Uint8Array(32 + 32 + 12 + ciphertext.length);
  total.set(ekX, 0);
  total.set(ekY, 32);
  total.set(nonce, 64);
  total.set(ciphertext, 76);

  return bytesToHex(total);
}

/**
 * Decrypt a notification payload using the recipient's private key.
 */
async function decryptNotification(
  payloadHex: string,
  myPrivKey: bigint
): Promise<NotificationData | null> {
  try {
    const bytes = hexToBytes(payloadHex);
    if (bytes.length < 76) return null; // too short

    // Extract fields
    const ekPubX = BigInt("0x" + bytesToHex(bytes.slice(0, 32)));
    const ekPubY = BigInt("0x" + bytesToHex(bytes.slice(32, 64)));
    const nonce = bytes.slice(64, 76);
    const ciphertext = bytes.slice(76);

    const { KeyManager } = await import("./keys");
    const sharedPoint = await KeyManager.ecdh(myPrivKey, [ekPubX, ekPubY]);

    // Derive same AES key
    const xHex = sharedPoint[0].toString(16).padStart(64, "0");
    const yHex = sharedPoint[1].toString(16).padStart(64, "0");
    const keyMaterial = hexToBytes(xHex + yHex);
    const rawKey = await crypto.subtle.digest(
      "SHA-256",
      (keyMaterial.buffer as ArrayBuffer).slice(
        keyMaterial.byteOffset,
        keyMaterial.byteOffset + keyMaterial.byteLength
      )
    );
    const aesKey = await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );

    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: (nonce.buffer as ArrayBuffer).slice(nonce.byteOffset, nonce.byteOffset + nonce.byteLength) },
      aesKey,
      (ciphertext.buffer as ArrayBuffer).slice(
        ciphertext.byteOffset,
        ciphertext.byteOffset + ciphertext.byteLength
      )
    );

    const decoder = new TextDecoder();
    const json = decoder.decode(plaintext);
    return JSON.parse(json) as NotificationData;
  } catch {
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Post an encrypted notification for a recipient after a successful transfer.
 * Called by the sender's client after relayTransfer/relayWithdraw succeeds.
 */
export async function postNotification(params: {
  recipientPubKey: BabyJubPoint;
  txHash: string;
  leafIndex: number;
  blockNumber: number;
  eventType: "transfer" | "withdrawal";
  memoHex: string;
  commitment: string;
}): Promise<void> {
  const tag = await deriveTag(params.recipientPubKey);

  const data: NotificationData = {
    txHash: params.txHash,
    leafIndex: params.leafIndex,
    blockNumber: params.blockNumber,
    eventType: params.eventType,
    memoHex: params.memoHex,
    commitment: params.commitment,
  };

  const payload = await encryptNotification(data, params.recipientPubKey);

  const res = await fetch(NOTIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag, payload }),
  });

  if (!res.ok) {
    console.warn("[relay-notify] Failed to post notification:", res.status);
  }
}

/**
 * Post a self-notification (sender saves their own change note to the relay).
 * Ensures note recovery across devices.
 */
export async function postSelfNotification(params: {
  myPubKey: BabyJubPoint;
  txHash: string;
  leafIndex: number;
  blockNumber: number;
  eventType: "transfer" | "withdrawal";
  memoHex: string;
  commitment: string;
}): Promise<void> {
  return postNotification({
    recipientPubKey: params.myPubKey,
    ...params,
  });
}

/**
 * Fetch and decrypt all notifications for the current user.
 * Returns only notifications that successfully decrypt.
 */
export async function fetchNotifications(
  myPubKey: BabyJubPoint,
  myPrivKey: bigint
): Promise<ReceivedNotification[]> {
  const tag = await deriveTag(myPubKey);

  const res = await fetch(`${NOTIFY_URL}?tag=${encodeURIComponent(tag)}`);
  if (!res.ok) {
    console.warn("[relay-notify] Failed to fetch notifications:", res.status);
    return [];
  }

  const json = await res.json();
  const raw: Array<{ id: string; payload: string; timestamp: number }> =
    json.notifications ?? [];

  const results: ReceivedNotification[] = [];
  for (const entry of raw) {
    const data = await decryptNotification(entry.payload, myPrivKey);
    if (data) {
      results.push({ id: entry.id, data, timestamp: entry.timestamp });
    }
  }

  return results;
}

/**
 * Delete a notification after it has been processed.
 */
export async function deleteNotification(
  myPubKey: BabyJubPoint,
  notificationId: string
): Promise<void> {
  const tag = await deriveTag(myPubKey);
  await fetch(
    `${NOTIFY_URL}?tag=${encodeURIComponent(tag)}&id=${encodeURIComponent(notificationId)}`,
    { method: "DELETE" }
  );
}

/**
 * Delete all notifications for the current user.
 */
export async function clearNotifications(
  myPubKey: BabyJubPoint
): Promise<void> {
  const tag = await deriveTag(myPubKey);
  await fetch(`${NOTIFY_URL}?tag=${encodeURIComponent(tag)}`, {
    method: "DELETE",
  });
}
