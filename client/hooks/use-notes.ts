"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Note } from "@/lib/zktoken/types";
import { NoteStore, encodeNote, decodeNote } from "@/lib/zktoken/note";

const STORAGE_KEY = "zktoken_notes";

/**
 * Hook that wraps NoteStore with localStorage persistence.
 * Notes are hydrated on mount and persisted on every mutation.
 */
export function useNotes() {
  const storeRef = useRef(new NoteStore());
  const [notes, setNotes] = useState<Note[]>([]);

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        for (const json of arr) {
          storeRef.current.save(decodeNote(json));
        }
        setNotes(storeRef.current.getAll());
      }
    } catch {
      // Ignore corrupt storage
    }
  }, []);

  const persist = useCallback(() => {
    const all = storeRef.current.getAll();
    const serialized = all.map((n) => encodeNote(n));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
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
    localStorage.removeItem(STORAGE_KEY);
    setNotes([]);
  }, []);

  return {
    notes,
    unspent: notes.filter((n) => !n.spent),
    saveNote,
    markSpent,
    getUnspent,
    clearAll,
  };
}
