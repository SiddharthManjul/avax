"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import { useZkToken } from "@/hooks/use-zktoken";
import { useNotes } from "@/hooks/use-notes";
import { useShieldedKey } from "@/hooks/use-shielded-key";
import { ProofStatus } from "./proof-status";
import type { Note } from "@/lib/zktoken/types";

const POOL_ADDRESS = process.env.NEXT_PUBLIC_SHIELDED_POOL_ADDRESS ?? "";

const inputClass =
  "w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-[#ff1a1a] placeholder:text-[#444444] focus:border-[#ff1a1a] focus:outline-none transition-colors duration-200";

const selectClass =
  "w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-[#ff1a1a] focus:border-[#ff1a1a] focus:outline-none transition-colors duration-200";

const btnPrimary =
  "w-full rounded-lg bg-[#b0b0b0] px-4 py-2.5 font-medium text-black hover:bg-[#ff1a1a] hover:text-black border border-[#b0b0b0] hover:border-[#ff1a1a] disabled:opacity-40 transition-colors duration-200";

const btnSecondary =
  "w-full rounded-lg bg-[#b0b0b0] px-4 py-2 text-sm font-medium text-black hover:bg-[#ff1a1a] hover:text-black border border-[#b0b0b0] hover:border-[#ff1a1a] disabled:opacity-40 transition-colors duration-200";

export function WithdrawForm() {
  const { ready } = useZkToken();
  const { address, provider } = useWallet();
  const { unspent, saveNote, markSpent } = useNotes();
  const { keypair, deriveKey } = useShieldedKey();
  const [selectedNoteIdx, setSelectedNoteIdx] = useState<number>(-1);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const selectedNote: Note | undefined =
    selectedNoteIdx >= 0 ? unspent[selectedNoteIdx] : undefined;

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !address || !provider || !selectedNote) return;

    const withdrawAmount = BigInt(amount);
    if (withdrawAmount <= 0n || withdrawAmount > selectedNote.amount) {
      setStatus(`Error: amount must be between 1 and ${selectedNote.amount}`);
      return;
    }

    if (!recipient || !recipient.startsWith("0x") || recipient.length !== 42) {
      setStatus("Error: enter a valid EVM recipient address");
      return;
    }

    setGenerating(true);
    setTxHash(null);
    setStatus(null);

    try {
      let kp = keypair;
      if (!kp) {
        setStatus("Sign the message in your wallet to derive your shielded key...");
        kp = await deriveKey();
        if (!kp) throw new Error("Failed to derive shielded key");
      }

      setStatus("Syncing Merkle tree...");
      const { relayWithdraw } = await import("@/lib/zktoken/transaction");

      setStatus("Generating ZK proof (this may take a moment)...");
      const result = await relayWithdraw({
        provider: provider as never,
        poolAddress: POOL_ADDRESS,
        inputNote: selectedNote,
        withdrawAmount,
        recipient,
        senderPublicKey: kp.publicKey,
        senderPrivateKey: kp.privateKey,
        wasmPath: "/circuits/withdraw.wasm",
        zkeyPath: "/circuits/withdraw_final.zkey",
      });

      setTxHash(result.relay.txHash);

      markSpent(selectedNote.nullifier);
      if (result.changeNote && result.changeNote.amount > 0n) {
        saveNote(result.changeNote);
      }

      setStatus("Withdrawal confirmed via relay!");
      setSelectedNoteIdx(-1);
      setAmount("");
      setRecipient("");
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <form onSubmit={handleWithdraw} className="space-y-4">
      {/* Note selector */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-1">
          Select Note to Spend
        </label>
        {unspent.length === 0 ? (
          <p className="text-sm text-[#444444]">No unspent notes. Deposit tokens first.</p>
        ) : (
          <select
            value={selectedNoteIdx}
            onChange={(e) => setSelectedNoteIdx(Number(e.target.value))}
            className={selectClass}
          >
            <option value={-1}>Choose a note...</option>
            {unspent.map((note, i) => (
              <option key={note.noteCommitment.toString()} value={i}>
                {note.amount.toString()} SRD (leaf #{note.leafIndex})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Recipient */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-1">
          Recipient Address (public EVM)
        </label>
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x..."
          className={`${inputClass} font-mono text-sm`}
        />
      </div>

      {/* Amount */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-1">
          Amount (SRD)
        </label>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={selectedNote ? `Max: ${selectedNote.amount}` : "500"}
          className={inputClass}
        />
      </div>

      <ProofStatus generating={generating} />

      <button
        type="submit"
        disabled={!ready || !address || generating || !selectedNote}
        className={btnPrimary}
      >
        {!address
          ? "Connect wallet first"
          : !ready
          ? "Initializing..."
          : !selectedNote
          ? "Select a note"
          : generating
          ? "Generating proof..."
          : "Withdraw via Relay"}
      </button>

      {txHash && (
        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-3">
          <p className="text-xs text-[#888888] mb-1">Transaction Hash</p>
          <p className="text-sm text-[#ff1a1a] font-mono break-all">{txHash}</p>
        </div>
      )}
      {status && (
        <p className="text-sm text-[#888888] break-all">{status}</p>
      )}
    </form>
  );
}
