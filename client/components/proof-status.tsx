"use client";

export function ProofStatus({ generating }: { generating: boolean }) {
  if (!generating) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[#ff1a1a]/30 bg-[#ff1a1a]/5 px-4 py-3">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#ff1a1a] border-t-transparent" />
      <span className="text-sm text-[#ff1a1a]">
        Generating ZK proof... This may take a few seconds.
      </span>
    </div>
  );
}
