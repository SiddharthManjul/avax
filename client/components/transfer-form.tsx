"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import { useZkToken } from "@/hooks/use-zktoken";
import { ProofStatus } from "./proof-status";

export function TransferForm() {
  const { ready } = useZkToken();
  const { address } = useWallet();
  const [recipientPubKeyX, setRecipientPubKeyX] = useState("");
  const [recipientPubKeyY, setRecipientPubKeyY] = useState("");
  const [amount, setAmount] = useState("");
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !address) return;

    setGenerating(true);
    setStatus("Generating ZK proof...");
    try {
      // In production: select note from NoteStore, generate proof, submit
      setStatus("Transfer proof generation requires a selected note and pool connection.");
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <form onSubmit={handleTransfer} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-1">
          Recipient Public Key X
        </label>
        <input
          type="text"
          value={recipientPubKeyX}
          onChange={(e) => setRecipientPubKeyX(e.target.value)}
          placeholder="0x..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none font-mono text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-1">
          Recipient Public Key Y
        </label>
        <input
          type="text"
          value={recipientPubKeyY}
          onChange={(e) => setRecipientPubKeyY(e.target.value)}
          placeholder="0x..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none font-mono text-sm"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-1">
          Amount
        </label>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="500000"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
        />
      </div>
      <ProofStatus generating={generating} />
      <button
        type="submit"
        disabled={!ready || !address || generating}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
      >
        {!address ? "Connect wallet first" : !ready ? "Initializing..." : generating ? "Generating proof..." : "Transfer"}
      </button>
      {status && (
        <p className="text-sm text-zinc-400 break-all">{status}</p>
      )}
    </form>
  );
}
