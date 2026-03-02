"use client";

import { useWallet } from "@/hooks/use-wallet";
import { useNotes } from "@/hooks/use-notes";
import { useEffect, useState } from "react";
import { BrowserProvider, Contract, formatEther, formatUnits } from "ethers";
import { TEST_TOKEN_ABI } from "@/lib/zktoken/abi/test-token";

interface TokenInfo {
  symbol: string;
  balance: string;
  decimals: number;
  address: string;
}

export function TokenBalances() {
  const { address, provider } = useWallet();
  const { unspent } = useNotes();
  const shieldedTotal = unspent.reduce((sum, n) => sum + n.amount, 0n);
  const [avaxBalance, setAvaxBalance] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address || !provider) {
      setAvaxBalance(null);
      setTokenInfo(null);
      return;
    }

    let cancelled = false;

    async function fetchBalances() {
      setLoading(true);
      try {
        const rawBalance = await provider!.getBalance(address!);
        if (!cancelled) setAvaxBalance(formatEther(rawBalance));

        const tokenAddr = process.env.NEXT_PUBLIC_TOKEN_ADDRESS;
        if (tokenAddr && tokenAddr.length > 0) {
          const erc20 = new Contract(
            tokenAddr,
            TEST_TOKEN_ABI,
            provider as unknown as BrowserProvider
          );
          const [balance, decimals, symbol] = await Promise.all([
            erc20.balanceOf(address),
            erc20.decimals(),
            erc20.symbol(),
          ]);
          if (!cancelled) {
            setTokenInfo({
              symbol: symbol as string,
              balance: formatUnits(balance as bigint, decimals as number),
              decimals: Number(decimals),
              address: tokenAddr,
            });
          }
        }
      } catch {
        // Silently fail — balances are informational
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchBalances();
    return () => {
      cancelled = true;
    };
  }, [address, provider]);

  if (!address) return null;

  const cardClass = "rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-4";
  const labelClass = "text-sm text-[#888888]";
  const valueClass = "mt-1 text-lg font-medium text-[#ff1a1a] font-mono";
  const dimClass = "text-[#444444]";

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* AVAX balance */}
      <div className={cardClass}>
        <p className={labelClass}>AVAX Balance</p>
        <p className={valueClass}>
          {loading && avaxBalance === null ? (
            <span className={dimClass}>Loading...</span>
          ) : avaxBalance !== null ? (
            `${Number(avaxBalance).toFixed(4)} AVAX`
          ) : (
            <span className={dimClass}>—</span>
          )}
        </p>
      </div>

      {/* ERC20 token balance */}
      <div className={cardClass}>
        <p className={labelClass}>
          {tokenInfo ? tokenInfo.symbol : "Token"} Balance
        </p>
        <p className={valueClass}>
          {loading && !tokenInfo ? (
            <span className={dimClass}>Loading...</span>
          ) : tokenInfo ? (
            `${Number(tokenInfo.balance).toFixed(2)} ${tokenInfo.symbol}`
          ) : (
            <span className={dimClass}>Not configured</span>
          )}
        </p>
        {tokenInfo && (
          <p className="mt-0.5 text-xs text-[#666666] font-mono truncate">
            {tokenInfo.address}
          </p>
        )}
      </div>

      {/* Shielded balance */}
      <div className={cardClass}>
        <p className={labelClass}>Shielded SRD</p>
        <p className={valueClass}>
          {shieldedTotal > 0n ? (
            `${shieldedTotal.toString()} zkSRD`
          ) : (
            <span className={dimClass}>0 zkSRD</span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-[#666666]">
          {unspent.length} unspent note{unspent.length !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}
