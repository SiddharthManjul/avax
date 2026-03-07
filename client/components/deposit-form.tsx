"use client";

import { useState, useMemo } from "react";
import { Contract, parseEther } from "ethers";
import { useWallet } from "@/hooks/use-wallet";
import { useZkToken } from "@/hooks/use-zktoken";
import { useNotes } from "@/hooks/use-notes";
import { useShieldedKey } from "@/hooks/use-shielded-key";
import { useToken } from "@/providers/token-provider";
import { getWavaxAddress, WAVAX_ABI } from "@/lib/zktoken/abi/wavax";

const inputClass =
  "w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-[#ff1a1a] placeholder:text-[#444444] focus:border-[#ff1a1a] focus:outline-none transition-colors duration-200";

const btnPrimary =
  "w-full rounded-lg bg-[#b0b0b0] px-4 py-2.5 font-medium text-black hover:bg-[#ff1a1a] hover:text-black border border-[#b0b0b0] hover:border-[#ff1a1a] disabled:opacity-40 transition-colors duration-200";

const btnSecondary =
  "w-full rounded-lg bg-[#b0b0b0] px-4 py-2 text-sm font-medium text-black hover:bg-[#ff1a1a] hover:text-black border border-[#b0b0b0] hover:border-[#ff1a1a] disabled:opacity-40 transition-colors duration-200";

const btnWarning =
  "w-full rounded-lg bg-transparent px-4 py-2 text-sm font-medium text-[#ff1a1a] hover:bg-[#ff1a1a]/10 border border-[#ff1a1a]/40 hover:border-[#ff1a1a] disabled:opacity-40 transition-colors duration-200";

const toggleBtn = (active: boolean) =>
  `flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-200 ${
    active
      ? "bg-[#ff1a1a]/10 text-[#ff1a1a] border border-[#ff1a1a]/40"
      : "bg-[#0d0d0d] text-[#888888] border border-[#2a2a2a] hover:text-[#ff1a1a] hover:border-[#ff1a1a]/30"
  }`;

export function DepositForm() {
  const { ready } = useZkToken();
  const { address, signer, provider } = useWallet();
  const { notes, saveNote, loading, refreshNotes } = useNotes();
  const { keypair, deriveKey } = useShieldedKey();
  const { activeToken } = useToken();

  const POOL_ADDRESS = activeToken?.pool ?? "";
  const TOKEN_ADDRESS = activeToken?.token ?? "";
  const tokenSymbol = activeToken?.symbol ?? "Token";
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [useNativeAvax, setUseNativeAvax] = useState(false);

  // Detect if the active token is WAVAX
  const isWavaxPool = useMemo(() => {
    if (!TOKEN_ADDRESS) return false;
    const wavax = getWavaxAddress();
    return TOKEN_ADDRESS.toLowerCase() === wavax.toLowerCase();
  }, [TOKEN_ADDRESS]);

  // Count notes that are stuck pending finalization
  const pendingNotes = notes.filter((n) => n.leafIndex < 0);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !signer || !address) return;

    const trimmed = amount.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      setStatus("Error: amount must be a whole number (no decimals)");
      return;
    }

    setStatus("Preparing deposit...");
    try {
      let kp = keypair;
      if (!kp) {
        setStatus("Sign the message in your wallet to derive your shielded key...");
        kp = await deriveKey();
        if (!kp) throw new Error("Failed to derive shielded key");
      }

      // If depositing native AVAX into a WAVAX pool, wrap first
      if (isWavaxPool && useNativeAvax) {
        setStatus("Wrapping native AVAX to WAVAX...");
        const wavaxContract = new Contract(TOKEN_ADDRESS, WAVAX_ABI, signer);
        const amountScale = activeToken?.decimals ?? 18;
        // amount is in whole units, scale to wei
        const wrapValue = BigInt(trimmed) * (10n ** BigInt(amountScale));
        const wrapTx = await wavaxContract.deposit({ value: wrapValue });
        await wrapTx.wait();
        setStatus("AVAX wrapped to WAVAX. Now depositing into shielded pool...");
      }

      const { deposit, waitForDeposit } = await import("@/lib/zktoken/transaction");

      setStatus("Approve the token transfer in your wallet...");
      const result = await deposit({
        signer: signer as never,
        poolAddress: POOL_ADDRESS,
        tokenAddress: TOKEN_ADDRESS,
        amount: BigInt(trimmed),
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

      setStatus(`Deposit confirmed! Leaf #${finalizedNote.leafIndex} — ready to transfer.`);
      setAmount("");
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Recovery: sync the full Merkle tree and find leaf indices for stuck notes.
  const handleRecoverNotes = async () => {
    if (!provider || pendingNotes.length === 0) return;
    setRecovering(true);
    setStatus(`Syncing Merkle tree to recover ${pendingNotes.length} unfinalized note(s)...`);

    try {
      const { MerkleTreeSync } = await import("@/lib/zktoken/merkle");
      const { finaliseNote } = await import("@/lib/zktoken/note");

      const tree = new MerkleTreeSync();
      await tree.syncFromChain(provider as never, POOL_ADDRESS);

      setStatus(`Tree synced (${tree.size} leaves). Matching commitments...`);

      let recovered = 0;
      for (const note of pendingNotes) {
        const leafIndex = tree.findLeafIndex(note.noteCommitment);
        if (leafIndex >= 0) {
          const finalized = await finaliseNote(note, leafIndex);
          saveNote(finalized);
          recovered++;
        }
      }

      setStatus(
        recovered > 0
          ? `Recovered ${recovered} note(s)! They are now ready to use.`
          : `No matching commitments found in ${tree.size} on-chain leaves.`
      );
    } catch (err) {
      setStatus(`Recovery error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRecovering(false);
    }
  };

  // Scan for incoming notes — relay first, then indexer, then chain fallback
  const handleScanNotes = async () => {
    setStatus("Scanning for incoming notes...");
    await refreshNotes();
    setStatus("Scan complete.");
  };

  return (
    <form onSubmit={handleDeposit} className="space-y-4">
      {/* AVAX / WAVAX toggle — only shown when active pool is WAVAX */}
      {isWavaxPool && (
        <div>
          <label className="block text-sm font-medium text-[#888888] mb-1">
            Deposit From
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setUseNativeAvax(true)}
              className={toggleBtn(useNativeAvax)}
            >
              Native AVAX
            </button>
            <button
              type="button"
              onClick={() => setUseNativeAvax(false)}
              className={toggleBtn(!useNativeAvax)}
            >
              WAVAX (ERC20)
            </button>
          </div>
          {useNativeAvax && (
            <p className="mt-1 text-xs text-[#666666]">
              Your native AVAX will be automatically wrapped to WAVAX, then deposited into the shielded pool.
            </p>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-[#888888] mb-1">
          Amount ({isWavaxPool && useNativeAvax ? "AVAX" : tokenSymbol})
        </label>
        <input
          type="text"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="100"
          className={inputClass}
        />
      </div>

      <button type="submit" disabled={!ready || !address || !keypair} className={btnPrimary}>
        {!address
          ? "Connect wallet first"
          : !ready
          ? "Initializing..."
          : isWavaxPool && useNativeAvax
          ? "Wrap AVAX & Deposit"
          : "Deposit"}
      </button>

      {/* Scan for incoming notes — uses relay + indexer + chain fallback */}
      {address && keypair && (
        <button
          type="button"
          onClick={handleScanNotes}
          disabled={loading}
          className={btnSecondary}
        >
          {loading ? "Scanning..." : "Scan for Incoming Notes"}
        </button>
      )}

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
            : `Recover ${pendingNotes.length} unfinalized note${pendingNotes.length > 1 ? "s" : ""}`}
        </button>
      )}

      {status && (
        <p className="text-sm text-[#888888] break-all">{status}</p>
      )}
    </form>
  );
}
