/**
 * utils.ts — Shared utilities for the ZkToken SDK.
 *
 * Replaces Node.js Buffer usage with pure browser-compatible helpers.
 */

/** Convert a Uint8Array to a hex string (no 0x prefix). */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Convert a hex string (with or without 0x prefix) to a Uint8Array. */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
