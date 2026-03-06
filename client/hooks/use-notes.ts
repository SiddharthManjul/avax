"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "@/lib/zktoken/types";
import { NoteStore, encodeNote, decodeNote } from "@/lib/zktoken/note";
import { useShieldedKey } from "./use-shielded-key";

const STORAGE_PREFIX = "zktoken_notes_";
const SCAN_BLOCK_KEY = "zktoken_last_scan_block";

const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? "";
const POOL_ADDRESS = process.env.NEXT_PUBLIC_SHIELDED_POOL_ADDRESS ?? "";

/** Derive the localStorage key for a given shielded public key. */
function storageKeyFor(pkX: bigint): string {
  return STORAGE_PREFIX + pkX.toString(16).slice(0, 16);
}

/**
 * Hook that wraps NoteStore with localStorage persistence.
 *
 * Note discovery priority:
 *   1. Notification relay (instant — sender posted encrypted notification)
 *   2. Indexer trial decryption (fast — queries indexed events, not RPC)
 *   3. Chain scanning fallback (slow — only if relay + indexer both fail)
 *
 * localStorage is a cache, not the source of truth. Notes can always be
 * recovered from on-chain encrypted memos.
 */
export function useNotes() {
  const storeRef = useRef(new NoteStore());
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const { keypair } = useShieldedKey();
  const currentKeyRef = useRef<string | null>(null);

  // Hydrate from localStorage cache when keypair changes
  useEffect(() => {
    storeRef.current.clear();

    if (!keypair) {
      setNotes([]);
      currentKeyRef.current = null;
      return;
    }

    const key = storageKeyFor(keypair.publicKey[0]);
    currentKeyRef.current = key;

    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        for (const json of arr) {
          storeRef.current.save(decodeNote(json));
        }
      }

      // Migrate old global key (one-time)
      const oldRaw = localStorage.getItem("zktoken_notes");
      if (oldRaw) {
        const oldArr = JSON.parse(oldRaw) as string[];
        for (const json of oldArr) {
          const note = decodeNote(json);
          if (note.ownerPublicKey[0] === keypair.publicKey[0]) {
            storeRef.current.save(note);
          }
        }
      }

      setNotes(storeRef.current.getAll());
    } catch {
      // Ignore corrupt storage
    }
  }, [keypair]);

  const persist = useCallback(() => {
    const all = storeRef.current.getAll();
    const serialized = all.map((n) => encodeNote(n));
    const key = currentKeyRef.current;
    if (key) {
      localStorage.setItem(key, JSON.stringify(serialized));
    }
    setNotes([...all]);
  }, []);

  const saveNote = useCallback(
    (note: Note) => {
      storeRef.current.save(note);
      persist();
    },
    [persist]
  );

  const markSpent = useCallback(
    (nullifier: bigint) => {
      storeRef.current.markSpent(nullifier);
      persist();
    },
    [persist]
  );

  const getUnspent = useCallback((tokenAddress?: string) => {
    return storeRef.current.getUnspent(tokenAddress);
  }, []);

  const clearAll = useCallback(() => {
    storeRef.current.clear();
    const key = currentKeyRef.current;
    if (key) {
      localStorage.removeItem(key);
    }
    setNotes([]);
  }, []);

  /**
   * Refresh notes using the 3-tier discovery strategy:
   *   1. Notification relay (instant)
   *   2. Indexer scan (fast)
   *   3. Chain scan (slow fallback)
   */
  const refreshNotes = useCallback(async () => {
    if (!keypair) return;
    setLoading(true);

    const existingCommitments = new Set(
      storeRef.current.getAll().map((n) => n.noteCommitment.toString())
    );

    let foundNew = false;

    try {
      // Tier 1: Check notification relay (instant)
      try {
        const { scanNotesFromRelay } = await import("@/lib/zktoken/transaction");
        const relayNotes = await scanNotesFromRelay({
          myPrivateKey: keypair.privateKey,
          myPublicKey: keypair.publicKey,
          tokenAddress: TOKEN_ADDRESS,
          existingCommitments,
        });
        for (const note of relayNotes) {
          storeRef.current.save(note);
          existingCommitments.add(note.noteCommitment.toString());
          foundNew = true;
        }
      } catch (err) {
        console.warn("[use-notes] Relay check failed:", err);
      }

      // Tier 2: Indexer scan (for anything the relay missed)
      let indexerWorked = false;
      try {
        const lastBlock = parseInt(localStorage.getItem(SCAN_BLOCK_KEY) ?? "0");
        const { scanNotesFromIndexer } = await import("@/lib/zktoken/transaction");
        const indexerNotes = await scanNotesFromIndexer({
          myPrivateKey: keypair.privateKey,
          myPublicKey: keypair.publicKey,
          tokenAddress: TOKEN_ADDRESS,
          existingCommitments,
          afterBlock: lastBlock,
        });
        for (const note of indexerNotes) {
          storeRef.current.save(note);
          existingCommitments.add(note.noteCommitment.toString());
          foundNew = true;
        }

        // Update scan checkpoint — only if indexer returned data
        const { fetchPoolState } = await import("@/lib/zktoken/indexer");
        const state = await fetchPoolState();
        if (state.lastIndexedBlock > 0) {
          localStorage.setItem(SCAN_BLOCK_KEY, state.lastIndexedBlock.toString());
          indexerWorked = true;
        }
      } catch (err) {
        console.warn("[use-notes] Indexer scan failed:", err);
      }

      // Tier 3: Chain scan — runs if indexer failed OR returned no data and we have no notes
      if (!indexerWorked && storeRef.current.getAll().length === 0) {
        console.log("[use-notes] Falling back to chain scan...");
        try {
          const { scanChainForNotes } = await import("@/lib/zktoken/transaction");
          const { JsonRpcProvider } = await import("ethers");
          const provider = new JsonRpcProvider(process.env.NEXT_PUBLIC_RPC_URL);

          const chainNotes = await scanChainForNotes({
            provider: provider as never,
            poolAddress: POOL_ADDRESS,
            myPrivateKey: keypair.privateKey,
            myPublicKey: keypair.publicKey,
            tokenAddress: TOKEN_ADDRESS,
            existingNullifiers: new Set(
              storeRef.current.getAll().map((n) => n.nullifier.toString())
            ),
          });

          for (const note of chainNotes) {
            if (!existingCommitments.has(note.noteCommitment.toString())) {
              storeRef.current.save(note);
              foundNew = true;
            }
          }
        } catch (chainErr) {
          console.warn("[use-notes] Chain scan also failed:", chainErr);
        }
      }

      if (foundNew) {
        persist();
      }
    } finally {
      setLoading(false);
    }
  }, [keypair, persist]);

  return {
    notes,
    unspent: notes.filter((n) => !n.spent),
    loading,
    saveNote,
    markSpent,
    getUnspent,
    clearAll,
    refreshNotes,
  };
}
