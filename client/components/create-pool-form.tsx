"use client";

import { useState } from "react";
import { Contract, Interface, parseUnits } from "ethers";
import { useWallet } from "@/hooks/use-wallet";
import { useToken } from "@/providers/token-provider";
import { POOL_REGISTRY_ABI } from "@/lib/zktoken/abi/pool-registry";
import { getWavaxAddress } from "@/lib/zktoken/abi/wavax";

const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_POOL_REGISTRY_ADDRESS ?? "";

const inputClass =
  "w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-[#ff1a1a] placeholder:text-[#444444] focus:border-[#ff1a1a] focus:outline-none transition-colors duration-200";

const btnPrimary =
  "w-full rounded-lg bg-[#b0b0b0] px-4 py-2.5 font-medium text-black hover:bg-[#ff1a1a] hover:text-black border border-[#b0b0b0] hover:border-[#ff1a1a] disabled:opacity-40 transition-colors duration-200";

const ERC20_META_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
];

export function CreatePoolForm() {
  const { address, signer, provider } = useWallet();
  const { refresh, tokens } = useToken();
  const [tokenAddress, setTokenAddress] = useState("");
  const [tokenMeta, setTokenMeta] = useState<{
    symbol: string;
    decimals: number;
    name: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);

  // Look up token metadata when address changes
  const handleLookup = async () => {
    if (!provider || !tokenAddress || tokenAddress.length !== 42) return;
    setLookingUp(true);
    setTokenMeta(null);
    setStatus(null);
    try {
      const erc20 = new Contract(tokenAddress, ERC20_META_ABI, provider);
      const [symbol, decimals, name] = await Promise.all([
        erc20.symbol(),
        erc20.decimals(),
        erc20.name().catch(() => "Unknown"),
      ]);
      setTokenMeta({
        symbol: symbol as string,
        decimals: Number(decimals),
        name: name as string,
      });

      // Check if pool already exists
      const existing = tokens.find(
        (t) => t.token.toLowerCase() === tokenAddress.toLowerCase()
      );
      if (existing) {
        setStatus(`Pool already exists for ${symbol}. Select it from the token menu.`);
      }
    } catch (err) {
      setStatus(
        `Could not read token metadata. Make sure this is a valid ERC20 address on Fuji.`
      );
    } finally {
      setLookingUp(false);
    }
  };

  const handleCreatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signer || !REGISTRY_ADDRESS || !tokenMeta) return;

    // Refresh first to catch pools created by other wallets
    await refresh();

    const existing = tokens.find(
      (t) => t.token.toLowerCase() === tokenAddress.toLowerCase()
    );
    if (existing) {
      setStatus(
        `Pool already exists for ${tokenMeta.symbol}. Select it from the token menu in the nav bar.`
      );
      return;
    }

    setPending(true);
    setStatus("Sending createPool transaction...");
    try {
      const registry = new Contract(REGISTRY_ADDRESS, POOL_REGISTRY_ABI, signer);
      const maxGasPrice = parseUnits("100", "gwei"); // 100 gwei default
      const tx = await registry.createPool(tokenAddress, maxGasPrice);
      setStatus(`Transaction submitted: ${tx.hash}. Waiting for confirmation...`);
      const receipt = await tx.wait();
      setStatus(
        `Pool created for ${tokenMeta.symbol}! Refreshing token list...`
      );

      // Refresh the token provider so the new pool appears in the selector
      await refresh();
      setStatus(
        `Done! ${tokenMeta.symbol} pool is now available. Select it from the token menu in the nav bar.`
      );
      setTokenAddress("");
      setTokenMeta(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("pool exists")) {
        // Pool was created by someone else — just refresh to pick it up
        await refresh();
        setStatus(
          `A pool for ${tokenMeta.symbol} already exists (created by another wallet). It's now available in the token selector.`
        );
      } else {
        setStatus(`Error: ${msg}`);
      }
    } finally {
      setPending(false);
    }
  };

  const quickFillWavax = () => {
    const addr = getWavaxAddress();
    setTokenAddress(addr);
    setTokenMeta(null);
    setStatus(null);
  };

  return (
    <form onSubmit={handleCreatePool} className="space-y-4">
      {/* Quick-fill buttons */}
      <div>
        <label className="block text-sm font-medium text-[#888888] mb-1">
          Quick Select
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={quickFillWavax}
            className="rounded-lg bg-[#0d0d0d] px-3 py-1.5 text-sm font-medium text-[#ff1a1a] border border-[#2a2a2a] hover:border-[#ff1a1a]/50 transition-colors duration-200"
          >
            WAVAX (Wrapped AVAX)
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#888888] mb-1">
          ERC20 Token Address
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => {
              setTokenAddress(e.target.value);
              setTokenMeta(null);
              setStatus(null);
            }}
            placeholder="0x..."
            className={`${inputClass} font-mono text-sm flex-1`}
          />
          <button
            type="button"
            onClick={handleLookup}
            disabled={
              lookingUp || !provider || !tokenAddress || tokenAddress.length !== 42
            }
            className="shrink-0 rounded-lg bg-[#b0b0b0] px-4 py-2 text-sm font-medium text-black hover:bg-[#ff1a1a] hover:text-black border border-[#b0b0b0] hover:border-[#ff1a1a] disabled:opacity-40 transition-colors duration-200"
          >
            {lookingUp ? "..." : "Lookup"}
          </button>
        </div>
      </div>

      {/* Token metadata preview */}
      {tokenMeta && (
        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-[#888888]">Name</span>
            <span className="text-[#ff1a1a]">{tokenMeta.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#888888]">Symbol</span>
            <span className="text-[#ff1a1a]">{tokenMeta.symbol}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[#888888]">Decimals</span>
            <span className="text-[#ff1a1a]">{tokenMeta.decimals}</span>
          </div>
        </div>
      )}

      {/* Existing pools list */}
      {tokens.length > 0 && (
        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-4 space-y-2">
          <p className="text-sm font-medium text-[#888888]">
            Registered Pools ({tokens.length})
          </p>
          {tokens.map((t) => (
            <div
              key={t.token}
              className="flex items-center justify-between text-sm"
            >
              <span className="text-[#ff1a1a] font-medium">{t.symbol}</span>
              <span className="text-[#666666] font-mono text-xs">
                {t.token.slice(0, 6)}...{t.token.slice(-4)}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="submit"
        disabled={!address || !tokenMeta || pending || !REGISTRY_ADDRESS}
        className={btnPrimary}
      >
        {!address
          ? "Connect wallet first"
          : !REGISTRY_ADDRESS
          ? "Registry not configured"
          : !tokenMeta
          ? "Lookup token first"
          : pending
          ? "Creating pool..."
          : `Create Pool for ${tokenMeta.symbol}`}
      </button>

      {status && (
        <p className="text-sm text-[#888888] break-all">{status}</p>
      )}
    </form>
  );
}
