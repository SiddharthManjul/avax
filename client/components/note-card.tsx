"use client";

import type { Note } from "@/lib/zktoken/types";

export function NoteCard({ note }: { note: Note }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        note.spent
          ? "border-zinc-800 bg-zinc-900/50 opacity-60"
          : "border-zinc-700 bg-zinc-900"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-zinc-400">
          Leaf #{note.leafIndex === -1 ? "pending" : note.leafIndex}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            note.spent
              ? "bg-red-500/20 text-red-400"
              : "bg-green-500/20 text-green-400"
          }`}
        >
          {note.spent ? "Spent" : "Unspent"}
        </span>
      </div>
      <div className="mt-2">
        <span className="text-2xl font-bold text-white">
          {note.amount.toString()}
        </span>
        <span className="ml-2 text-sm text-zinc-500">tokens</span>
      </div>
      <div className="mt-2 text-xs font-mono text-zinc-600 truncate">
        commitment: 0x{note.noteCommitment.toString(16).slice(0, 16)}...
      </div>
    </div>
  );
}
