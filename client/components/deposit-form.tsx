"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import { useZkToken } from "@/hooks/use-zktoken";
import { useNotes } from "@/hooks/use-notes";
import { useShieldedKey } from "@/hooks/use-shielded-key";

const POOL_ADDRESS = process.env.NEXT_PUBLIC_SHIELDED_POOL_ADDRESS ?? "";
const TOKEN_ADDRESS = process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? "";

const inputClass =
  "w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-[#ff1a1a] placeholder:text-[#444444] focus:border-[#ff1a1a] focus:outline-none transition-colors duration-200";

const btnPrimary =
  "w-full rounded-lg bg-[#b0b0b0] px-4 py-2.5 font-medium text-black hover:bg-[#ff1a1a] hover:text-black border border-[#b0b0b0] hover:border-[#ff1a1a] disabled:opacity-40 transition-colors duration-200";

const btnSecondary =
  "w-full rounded-lg bg-[#b0b0b0] px-4 py-2 text-sm font-medium text-black hover:bg-[#ff1a1a] hover:text-black border border-[#b0b0b0] hover:border-[#ff1a1a] disabled:opacity-40 transition-colors duration-200";

const btnWarning =
  "w-full rounded-lg bg-transparent px-4 py-2 text-sm font-medium text-[#ff1a1a] hover:bg-[#ff1a1a]/10 border border-[#ff1a1a]/40 hover:border-[#ff1a1a] disabled:opacity-40 transition-colors duration-200";

export function DepositForm() {
  const { ready } = useZkToken();
  const { address, signer, provider } = useWallet();
  const { notes, saveNote } = useNotes();
  const { keypair, deriving, deriveKey } = useShieldedKey();
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  // Count notes that are stuck pending finalization
  const pendingNotes = notes.filter((n) => n.leafIndex < 0);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !signer || !address) return;

    setStatus("Preparing deposit...");
    try {
      let kp = keypair;
      if (!kp) {
        setStatus("Sign the message in your wallet to derive your shielded key...");
        kp = await deriveKey();
        if (!kp) throw new Error("Failed to derive shielded key");
      }

      const { deposit, waitForDeposit } = await import("@/lib/zktoken/transaction");

      setStatus("Approve the token transfer in your wallet...");
      const result = await deposit({
        signer: signer as never,
        poolAddress: POOL_ADDRESS,
        tokenAddress: TOKEN_ADDRESS,
        amount: BigInt(amount),
        ownerPublicKey: kp.publicKey,
      });

      setStatus(`Deposit submitted: ${result.tx.hash}. Waiting for confirmation...`);

      const finalizedNote = await waitForDeposit(
        result.tx,
        result.pendingNote,
        provider! as never,
        POOL_ADDRESS
      );
      saveNote(finalizedNote);

      setStatus(`✓ Deposit confirmed! Leaf #${finalizedNote.leafIndex} — ready to transfer.`);
      setAmount("");
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Recovery: scan on-chain Deposit events to find the leafIndex for stuck notes
  const handleRecoverNotes = async () => {
    if (!provider || pendingNotes.length === 0) return;
    setRecovering(true);
    setStatus(`Scanning chain for ${pendingNotes.length} unfinalized note(s)...`);

    try {
      const { Interface } = await import("ethers");
      const { SHIELDED_POOL_ABI } = await import("@/lib/zktoken/abi/shielded-pool");
      const { finaliseNote } = await import("@/lib/zktoken/note");

      const poolIface = new Interface(SHIELDED_POOL_ABI);
      const depositTopic = poolIface.getEvent("Deposit")!.topicHash;

      // Fuji public RPC allows max 2048 blocks per getLogs request — paginate.
      const CHUNK = 2048;
      const LOOK_BACK = 50000; // ~1.5 days of Fuji blocks (~2s/block)
      const currentBlock = await (provider as never as { getBlockNumber(): Promise<number> }).getBlockNumber();
      const startBlock = Math.max(0, currentBlock - LOOK_BACK);

      type LogEntry = { topics: string[]; data: string; blockNumber: number };
      const typedProvider = provider as never as { getLogs(f: object): Promise<LogEntry[]> };

      const allLogs: LogEntry[] = [];
      const totalChunks = Math.ceil((currentBlock - startBlock + 1) / CHUNK);
      let chunkIdx = 0;
      for (let from = startBlock; from <= currentBlock; from += CHUNK) {
        const to = Math.min(from + CHUNK - 1, currentBlock);
        chunkIdx++;
        setStatus(`Chunk ${chunkIdx}/${totalChunks} — blocks ${from}–${to}…`);
        const chunk = await typedProvider.getLogs({
          address: POOL_ADDRESS,
          topics: [depositTopic],
          fromBlock: from,
          toBlock: to,
        });
        allLogs.push(...chunk);
      }

      const logs = allLogs;


      // Debug: compare local commitments vs on-chain
      console.log(`[recovery] ${allLogs.length} Deposit event(s) found in last ${LOOK_BACK} blocks`);
      allLogs.forEach(l => console.log(`[recovery] on-chain: ${l.topics[1]}`));
      pendingNotes.forEach(n => console.log(`[recovery] local:    0x${n.noteCommitment.toString(16).padStart(64, '0')}`));

      let recovered = 0;
      for (const note of pendingNotes) {
        const noteCommitmentHex =
          "0x" + note.noteCommitment.toString(16).padStart(64, "0");

        const matching = logs.find(
          (l) => l.topics[1]?.toLowerCase() === noteCommitmentHex.toLowerCase()
        );

        if (matching) {
          const parsed = poolIface.parseLog(matching);
          if (parsed) {
            const leafIndex = Number(parsed.args["leafIndex"] as bigint);
            const finalized = await finaliseNote(
              { ...note, createdAtBlock: matching.blockNumber },
              leafIndex
            );
            saveNote(finalized);
            recovered++;
          }
        }
      }

      setStatus(
        recovered > 0
          ? `✓ Recovered ${recovered} note(s)! They are now ready to use.`
          : `No match in last ${LOOK_BACK} blocks (${allLogs.length} Deposit events found). ` +
            `Check browser console — compare 'local' vs 'on-chain' commitment hashes.`
      );
    } catch (err) {
      setStatus(`Recovery error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRecovering(false);
    }
  };

  return (
    <form onSubmit={handleDeposit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-1">
          Amount (SRD)
        </label>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="100"
          className={inputClass}
        />
      </div>

      {!keypair && address && (
        <button
          type="button"
          onClick={deriveKey}
          disabled={deriving}
          className={btnSecondary}
        >
          {deriving ? "Signing..." : "Derive Shielded Key (one-time)"}
        </button>
      )}

      <button type="submit" disabled={!ready || !address} className={btnPrimary}>
        {!address ? "Connect wallet first" : !ready ? "Initializing..." : "Deposit"}
      </button>

      {/* Recovery button — only shown when there are stuck notes */}
      {pendingNotes.length > 0 && provider && (
        <button
          type="button"
          onClick={handleRecoverNotes}
          disabled={recovering}
          className={btnWarning}
        >
          {recovering
            ? "Scanning chain..."
            : `⚠ Recover ${pendingNotes.length} unfinalized note${pendingNotes.length > 1 ? "s" : ""}`}
        </button>
      )}

      {status && (
        <p className="text-sm text-[#888888] break-all">{status}</p>
      )}
    </form>
  );
}
