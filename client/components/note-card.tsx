"use client";

import type { Note } from "@/lib/zktoken/types";

export function NoteCard({ note }: { note: Note }) {
  return (
    <div
      className={`rounded-lg border p-4 transition-colors duration-200 ${
        note.spent
          ? "border-[#2a2a2a] bg-[#0a0a0a] opacity-50"
          : "border-[#2a2a2a] bg-[#0d0d0d] hover:border-[#ff1a1a]/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-[#888888]">
          Leaf #{note.leafIndex === -1 ? "pending" : note.leafIndex}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            note.spent
              ? "bg-[#ff1a1a]/10 text-[#ff1a1a]/60"
              : "bg-[#ff1a1a]/15 text-[#ff1a1a]"
          }`}
        >
          {note.spent ? "Spent" : "Unspent"}
        </span>
      </div>
      <div className="mt-2">
        <span className="text-2xl font-bold text-[#ff1a1a]">
          {note.amount.toString()}
        </span>
        <span className="ml-2 text-sm text-[#888888]">tokens</span>
      </div>
      <div className="mt-2 text-xs font-mono text-[#444444] truncate">
        commitment: 0x{note.noteCommitment.toString(16).slice(0, 16)}...
      </div>
    </div>
  );
}
