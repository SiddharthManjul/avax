"use client";

import { useNotes } from "@/hooks/use-notes";
import { NoteList } from "@/components/note-list";

export default function NotesPage() {
  const { notes, unspent, clearAll } = useNotes();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Notes</h1>
          <p className="mt-1 text-zinc-400">
            Your shielded note inventory. {unspent.length} unspent of{" "}
            {notes.length} total.
          </p>
        </div>
        {notes.length > 0 && (
          <button
            onClick={clearAll}
            className="rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Unspent</h2>
        <NoteList notes={unspent} />
      </div>

      {notes.some((n) => n.spent) && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Spent</h2>
          <NoteList notes={notes.filter((n) => n.spent)} />
        </div>
      )}
    </div>
  );
}
