"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/use-wallet";
import { FuturisticButton } from "@/components/ui/button";
import { HeroSection } from "@/components/landing/HeroSection";
import { BentoGrid } from "@/components/landing/BentoGrid";
import { ScrollSections } from "@/components/landing/ScrollSections";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";

const Background3D = dynamic(
  () => import("@/components/landing/Background3D").then((m) => m.Background3D),
  { ssr: false }
);


/* ────────────────────────────────────────────────────────── */
/*  LANDING NAV                                               */
/* ────────────────────────────────────────────────────────── */
function LandingNav() {
  const { connect, connecting } = useWallet();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#1a1a1a] bg-black/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="text-xl font-bold text-[#ff1a1a] tracking-wide uppercase">
          Shroud Network
        </span>
        <FuturisticButton
          variant="outline"
          size="sm"
          onClick={connect}
          disabled={connecting}
          borderColor="rgba(255,26,26,0.8)"
          borderWidth={1.5}
          className="text-[#ff1a1a] text-xs font-semibold tracking-wider uppercase"
        >
          {connecting ? "Connecting…" : "Connect Wallet"}
        </FuturisticButton>
      </div>
    </header>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  BENTO SECTION HEADER                                      */
/* ────────────────────────────────────────────────────────── */
function BentoHeader() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      viewport={{ once: true }}
      className="text-center mb-14 px-4"
    >
      <h2 className="text-3xl md:text-4xl font-bold text-[#ff1a1a]">
        Built for Privacy
      </h2>
      <p className="mt-3 text-[#888888] max-w-xl mx-auto">
        Every component of Shroud Network is engineered for confidentiality.
      </p>
    </motion.div>
  );
}

/* ────────────────────────────────────────────────────────── */
/*  FOOTER                                                    */
/* ────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-[#2a2a2a] bg-black py-12 px-6 mt-24">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col items-center justify-between gap-8 sm:flex-row sm:items-start">
          <div className="max-w-xs text-center sm:text-left">
            <p className="text-xl font-bold text-[#ff1a1a] uppercase tracking-wide">
              Shroud Network
            </p>
            <p className="mt-2 text-sm text-[#888888]">
              Zero-knowledge shielded token transfers on Avalanche. Privacy by default.
            </p>
          </div>

          <div className="flex gap-10 text-sm text-[#888888]">
            <div className="space-y-2">
              <p className="font-semibold text-[#ff1a1a]/70 uppercase tracking-wider text-xs mb-3">
                Protocol
              </p>
              <a href="https://github.com" className="block hover:text-[#ff1a1a] transition-colors duration-200">GitHub</a>
              <a href="#" className="block hover:text-[#ff1a1a] transition-colors duration-200">Docs</a>
              <a href="https://testnet.snowtrace.io" className="block hover:text-[#ff1a1a] transition-colors duration-200">Explorer</a>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-[#ff1a1a]/70 uppercase tracking-wider text-xs mb-3">
                Community
              </p>
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
/*  PAGE                                                      */
/* ────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const [mountKey, setMountKey] = useState(0);

  // Force remount of Background3D after hydration so Three.js has a real DOM element
  useEffect(() => {
    setMountKey((prev) => prev + 1);
  }, []);

  return (
    <div className="min-h-screen bg-black relative">
      <Background3D key={mountKey} />
      <LandingNav />

      {/* Hero — full viewport */}
      <div className="pt-16">
        <HeroSection />
      </div>

      {/* Bento Grid */}
      <section id="features" className="pt-24 pb-12">
        <BentoHeader />
        <BentoGrid />
      </section>

      {/* Scroll Sections */}
      <section className="py-12">
        <ScrollSections />
      </section>

      <Footer />
    </div>
  );
}
