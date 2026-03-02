"use client";

import { useZkToken } from "@/hooks/use-zktoken";
import { useWallet } from "@/hooks/use-wallet";
import { useNotes } from "@/hooks/use-notes";
import { TokenBalances } from "@/components/token-balances";
import Link from "next/link";

export default function DashboardPage() {
  const { ready, error } = useZkToken();
  const { address, chainId, networkName, wrongNetwork, switchToExpectedNetwork } = useWallet();
  const { unspent } = useNotes();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-[#ff1a1a] tracking-tight">Dashboard</h1>
        <p className="mt-1 text-[#888888]">
          ZkToken shielded pool — private token transfers on Avalanche
        </p>
      </div>

      {/* Status cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-4">
          <p className="text-sm text-[#888888]">WASM Status</p>
          <p className="mt-1 text-lg font-medium">
            {error ? (
              <span className="text-[#ff1a1a]">Error</span>
            ) : ready ? (
              <span className="text-[#ff1a1a]">Ready</span>
            ) : (
              <span className="text-yellow-500">Loading...</span>
            )}
          </p>
        </div>

        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-4">
          <p className="text-sm text-[#888888]">Wallet</p>
          <p className="mt-1 text-lg font-medium font-mono truncate">
            {address ? (
              <span className="text-[#ff1a1a]">
                {address.slice(0, 6)}...{address.slice(-4)}
              </span>
            ) : (
              <span className="text-[#444444]">Not connected</span>
            )}
          </p>
          {chainId && (
            <p className="mt-0.5 text-xs text-[#666666]">
              {networkName ?? `Chain ${chainId}`}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-4">
          <p className="text-sm text-[#888888]">Shielded Notes</p>
          <p className="mt-1 text-lg font-medium text-[#ff1a1a]">
            {unspent.length} unspent
          </p>
          <p className="mt-0.5 text-sm font-mono text-[#888888]">
            {unspent.reduce((s, n) => s + n.amount, 0n).toString()} zkSRD
          </p>
        </div>
      </div>

      {/* Wrong network warning */}
      {wrongNetwork && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 flex items-center justify-between">
          <p className="text-sm text-yellow-400">
            Wrong network — please switch to{" "}
            {process.env.NEXT_PUBLIC_CHAIN_ID === "43114"
              ? "Avalanche C-Chain"
              : "Avalanche Fuji"}
            .
          </p>
          <button
            onClick={switchToExpectedNetwork}
            className="rounded-lg bg-[#b0b0b0] px-3 py-1.5 text-sm font-medium text-black hover:bg-[#ff1a1a] hover:text-black transition-colors duration-200 border border-[#b0b0b0] hover:border-[#ff1a1a]"
          >
            Switch Network
          </button>
        </div>
      )}

      {/* Token balances */}
      <TokenBalances />

      {/* Quick actions */}
      <div>
        <h2 className="text-lg font-semibold text-[#ff1a1a] mb-3">Quick Actions</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            {
              href: "/deposit",
              label: "Deposit",
              desc: "Lock ERC20 tokens into the shielded pool",
            },
            {
              href: "/transfer",
              label: "Transfer",
              desc: "Send tokens privately within the pool",
            },
            {
              href: "/withdraw",
              label: "Withdraw",
              desc: "Exit tokens from the pool to any address",
            },
          ].map(({ href, label, desc }) => (
            <Link
              key={href}
              href={href}
              className="group rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] p-4 hover:border-[#ff1a1a]/50 hover:bg-[#ff1a1a]/5 transition-all duration-200"
            >
              <p className="font-semibold text-[#ff1a1a]">{label}</p>
              <p className="mt-1 text-sm text-[#888888]">{desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
