"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import { useZkToken } from "@/hooks/use-zktoken";

export function DepositForm() {
  const { ready } = useZkToken();
  const { address, signer } = useWallet();
  const [tokenAddress, setTokenAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !signer || !address) return;

    setStatus("Preparing deposit...");
    try {
      const { deposit } = await import("@/lib/zktoken/transaction");
      const { KeyManager } = await import("@/lib/zktoken/keys");

      // Generate a keypair for this deposit (in production, use persistent key)
      const keypair = await KeyManager.generate();

      const poolAddress = tokenAddress; // TODO: resolve pool from factory
      const result = await deposit({
        signer: signer as never,
        poolAddress,
        tokenAddress,
        amount: BigInt(amount),
        ownerPublicKey: keypair.publicKey,
      });

      setStatus(`Deposit submitted: ${result.tx.hash}`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <form onSubmit={handleDeposit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-zinc-400 mb-1">
          Token Address
        </label>
        <input
          type="text"
          value={tokenAddress}
          onChange={(e) => setTokenAddress(e.target.value)}
          placeholder="0x..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
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
          placeholder="1000000"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder:text-zinc-600 focus:border-indigo-500 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={!ready || !address}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
      >
        {!address ? "Connect wallet first" : !ready ? "Initializing..." : "Deposit"}
      </button>
      {status && (
        <p className="text-sm text-zinc-400 break-all">{status}</p>
      )}
    </form>
  );
}
