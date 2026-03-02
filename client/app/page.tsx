"use client";

import { useWallet } from "@/hooks/use-wallet";
import { FuturisticButton } from "@/components/ui/button";
import Link from "next/link";

/* ────────────────────────────────────────────────────────── */
/*  LANDING NAV                                               */
/* ────────────────────────────────────────────────────────── */
function LandingNav() {
  const { connect, connecting } = useWallet();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#1a1a1a] bg-grey-700 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-xl font-bold text-[#ff1a1a] tracking-wide">
          Shroud Network
        </span>
        <FuturisticButton
          variant="outline"
          size="sm"
          onClick={connect}
          disabled={connecting}
          borderColor="rgba(255,26,26,0.8)"
          borderWidth={1.5}
          className="text-[#ff1a1a] hover:text-black hover:bg-[#ff1a1a] text-xs font-semibold tracking-wider uppercase"
        >
          {connecting ? "Connecting…" : "Connect Wallet"}
        </FuturisticButton>
      </div>
    </header>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  HERO                                                      */
/* ────────────────────────────────────────────────────────── */
function Hero() {
  const { connect, connecting } = useWallet();

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 pt-24">
      {/* Background grid + radial glow */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,26,26,0.15) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,26,26,0.15) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_60%,rgba(255,26,26,0.08),transparent)]" />

      <div className="relative z-10 max-w-4xl text-center">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#ff1a1a]/30 bg-[#ff1a1a]/5 px-4 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ff1a1a] animate-pulse" />
          <span className="text-xs font-medium text-[#ff1a1a] tracking-widest uppercase">
            Live on Avalanche Fuji
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl font-bold leading-tight tracking-tight text-[#ff1a1a] sm:text-6xl lg:text-7xl">
          Privacy-First
          <br />
          <span className="text-white">Token Transfers</span>
        </h1>

        {/* Sub-headline */}
        <p className="mx-auto mt-6 max-w-2xl text-lg text-[#888888] leading-relaxed">
          Shroud Network is a zero-knowledge shielded pool on Avalanche.
          Shield your assets, transfer privately, and maintain full self-custody —
          no one can trace your transactions.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <FuturisticButton
            size="lg"
            onClick={connect}
            disabled={connecting}
            borderColor="rgba(255,26,26,0.9)"
            borderWidth={2}
            className="bg-[#ff1a1a] text-black font-bold hover:bg-[#ff1a1a]/90 px-8"
          >
            {connecting ? "Connecting…" : "Launch App →"}
          </FuturisticButton>
          <FuturisticButton
            variant="outline"
            size="lg"
            borderColor="rgba(255,26,26,0.5)"
            borderWidth={1.5}
            className="text-[#ff1a1a] font-semibold px-8"
            onClick={() =>
              document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })
            }
          >
            Explore Features
          </FuturisticButton>
        </div>

        {/* Stats strip */}
        <div className="mt-16 grid grid-cols-3 divide-x divide-[#2a2a2a] rounded-xl border border-[#2a2a2a] bg-[#0d0d0d]">
          {[
            { label: "Chain", value: "Avalanche" },
            { label: "Privacy Model", value: "ZK-SNARKs" },
            { label: "Custody", value: "Self-Sovereign" },
          ].map(({ label, value }) => (
            <div key={label} className="py-5 px-6 text-center">
              <p className="text-xl font-bold text-[#ff1a1a]">{value}</p>
              <p className="mt-1 text-xs text-[#888888] uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  BENTO GRID                                                */
/* ────────────────────────────────────────────────────────── */
const bentoItems = [
  {
    icon: "🔒",
    title: "Shielded Transfers",
    body: "Every transaction is cryptographically hidden. Observers see only commitment hashes, never amounts or participants.",
    span: "md:col-span-2",
    accent: true,
  },
  {
    icon: "⚡",
    title: "Sub-second Proofs",
    body: "Optimized Groth16 circuits generate proofs in milliseconds — no waiting, seamless UX.",
    span: "md:col-span-1",
    accent: false,
  },
  {
    icon: "🌐",
    title: "Avalanche Native",
    body: "Built on Avalanche C-Chain for high throughput and near-zero fees.",
    span: "md:col-span-1",
    accent: false,
  },
  {
    icon: "🔑",
    title: "Self-Custody Keys",
    body: "Your shielded keypair is derived locally from your wallet signature. No server ever sees it.",
    span: "md:col-span-1",
    accent: false,
  },
  {
    icon: "📊",
    title: "Verifiable Integrity",
    body: "Every deposit, transfer, and withdrawal is verified by an on-chain ZK verifier. Trustless by design.",
    span: "md:col-span-2",
    accent: true,
  },
];

function BentoGrid() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-6 py-24">
      <div className="mb-14 text-center">
        <h2 className="text-3xl font-bold text-[#ff1a1a] sm:text-4xl">
          Built for Privacy
        </h2>
        <p className="mt-3 text-[#888888]">
          Every component of Shroud Network is engineered for confidentiality.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {bentoItems.map(({ icon, title, body, span, accent }) => (
          <div
            key={title}
            className={`group relative overflow-hidden rounded-xl border bg-[#0d0d0d] p-6 transition-all duration-300 ${span} ${
              accent
                ? "border-[#ff1a1a]/30 hover:border-[#ff1a1a]/60"
                : "border-[#2a2a2a] hover:border-[#ff1a1a]/30"
            }`}
          >
            {accent && (
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_30%_50%,rgba(255,26,26,0.05),transparent)] pointer-events-none" />
            )}
            <div className="mb-4 text-3xl">{icon}</div>
            <h3 className="mb-2 text-lg font-bold text-[#ff1a1a]">{title}</h3>
            <p className="text-sm text-[#888888] leading-relaxed">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  USE CASES                                                 */
/* ────────────────────────────────────────────────────────── */
const useCases = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
      </svg>
    ),
    title: "Private DeFi",
    description:
      "Shield your yield farming and liquidity positions from MEV bots and front-runners. Trade on your terms.",
    tags: ["MEV Protection", "AMM Privacy", "Yield Farming"],
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Zm0 3h.008v.008h-.008v-.008Z" />
      </svg>
    ),
    title: "DAO Treasury",
    description:
      "Confidential contractor payroll and grant disbursements. Keep treasury strategy private while remaining auditable.",
    tags: ["Confidential Payroll", "Grant Privacy", "On-chain Audit"],
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a7.464 7.464 0 0 1-1.15 3.993m1.989 3.559A11.209 11.209 0 0 0 8.25 10.5a3.75 3.75 0 1 1 7.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 0 1-3.6 9.75m6.633-4.596a18.666 18.666 0 0 1-2.485 5.33" />
      </svg>
    ),
    title: "Personal Privacy",
    description:
      "Break the on-chain link between your public wallet and private holdings. Full financial privacy, zero compromise.",
    tags: ["Address Shielding", "Transaction Unlinkability", "Anonymous Transfers"],
  },
];

function UseCases() {
  return (
    <section className="relative overflow-hidden py-24">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_100%_60%_at_50%_50%,rgba(255,26,26,0.04),transparent)]" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-bold text-[#ff1a1a] sm:text-4xl">Use Cases</h2>
          <p className="mt-3 text-[#888888]">
            Privacy is a right, not a privilege. Here's how Shroud Network enables it.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {useCases.map(({ icon, title, description, tags }) => (
            <div
              key={title}
              className="group flex flex-col rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] p-7 transition-all duration-300 hover:border-[#ff1a1a]/40 hover:bg-[#ff1a1a]/5"
            >
              {/* Icon */}
              <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-lg border border-[#2a2a2a] bg-black text-[#ff1a1a] group-hover:border-[#ff1a1a]/40 transition-colors duration-300">
                {icon}
              </div>

              <h3 className="mb-3 text-xl font-bold text-[#ff1a1a]">{title}</h3>
              <p className="mb-6 text-sm text-[#888888] leading-relaxed flex-1">{description}</p>

              {/* Tags */}
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-[#ff1a1a]/20 bg-[#ff1a1a]/5 px-3 py-1 text-xs font-medium text-[#ff1a1a]/80"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* How it works mini diagram */}
        <div className="mt-20 rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] p-8 overflow-x-auto">
          <h3 className="mb-10 text-center text-xl font-bold text-[#ff1a1a]">How It Works</h3>
          <div className="flex min-w-[600px] items-center justify-between gap-4">
            {[
              { step: "01", label: "Deposit", desc: "Lock ERC20 into the shielded pool and receive a private note" },
              { step: "02", label: "Shield", desc: "Your funds are hidden in a Merkle tree of commitments" },
              { step: "03", label: "Transfer", desc: "Generate a ZK proof and send to any recipient privately" },
              { step: "04", label: "Withdraw", desc: "Prove ownership without revealing which note was spent" },
            ].map(({ step, label, desc }, i, arr) => (
              <div key={step} className="flex items-center gap-4 flex-1">
                <div className="flex-1 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-[#ff1a1a]/40 bg-[#ff1a1a]/10 text-sm font-bold text-[#ff1a1a]">
                    {step}
                  </div>
                  <p className="font-bold text-[#ff1a1a] mb-1">{label}</p>
                  <p className="text-xs text-[#888888]">{desc}</p>
                </div>
                {i < arr.length - 1 && (
                  <div className="flex-shrink-0 text-[#ff1a1a]/30 text-xl">→</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  FOOTER                                                    */
/* ────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-[#2a2a2a] bg-black py-12 px-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center justify-between gap-8 sm:flex-row sm:items-start">
          {/* Brand */}
          <div className="max-w-xs text-center sm:text-left">
            <p className="text-xl font-bold text-[#ff1a1a]">Shroud Network</p>
            <p className="mt-2 text-sm text-[#888888]">
              Zero-knowledge shielded token transfers on Avalanche. Privacy by default.
            </p>
          </div>

          {/* Links */}
          <div className="flex gap-8 text-sm text-[#888888]">
            <div className="space-y-2">
              <p className="font-semibold text-[#ff1a1a]/80 uppercase tracking-wider text-xs mb-3">Protocol</p>
              <a href="https://github.com" className="block hover:text-[#ff1a1a] transition-colors duration-200">GitHub</a>
              <a href="https://docs.shroudnetwork.xyz" className="block hover:text-[#ff1a1a] transition-colors duration-200">Docs</a>
              <a href="https://testnet.snowtrace.io" className="block hover:text-[#ff1a1a] transition-colors duration-200">Explorer</a>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-[#ff1a1a]/80 uppercase tracking-wider text-xs mb-3">Community</p>
              <a href="https://twitter.com" className="block hover:text-[#ff1a1a] transition-colors duration-200">Twitter</a>
              <a href="https://discord.gg" className="block hover:text-[#ff1a1a] transition-colors duration-200">Discord</a>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-[#2a2a2a] pt-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <p className="text-xs text-[#444444]">
            © 2026 Shroud Network. All rights reserved.
          </p>
          <p className="text-xs text-[#444444]">
            Built on <span className="text-[#ff1a1a]/60">Avalanche</span> · Powered by ZK-SNARKs
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  PAGE EXPORT                                               */
/* ────────────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-black">
      <LandingNav />
      <Hero />
      <BentoGrid />
      <UseCases />
      <Footer />
    </div>
  );
}
