"use client";

import { ZkTokenProvider } from "@/providers/zktoken-provider";
import { WalletProvider } from "@/providers/wallet-provider";
import { Nav } from "@/components/nav";
import { VaultGate } from "@/components/vault-gate";
import { useWallet } from "@/hooks/use-wallet";
import { useRouter, usePathname } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

const LANDING = "/";
const APP_PATHS = ["/dashboard", "/deposit", "/transfer", "/withdraw", "/notes", "/faucet"];

/** Watches wallet state and handles redirects between landing / app */
function WalletRedirect() {
  const { address } = useWallet();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (address && pathname === LANDING) {
      router.push("/dashboard");
    } else if (!address && APP_PATHS.some((p) => pathname.startsWith(p))) {
      router.push(LANDING);
    }
  }, [address, pathname, router]);

  return null;
}

function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === LANDING;

  return (
    <>
      <WalletRedirect />
      {/* Only show the authenticated nav on app pages */}
      {!isLanding && <Nav />}
      {isLanding ? (
        <>{children}</>
      ) : (
        <main className="mx-auto max-w-5xl px-4 py-8">
          <VaultGate>{children}</VaultGate>
        </main>
      )}
    </>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <ZkTokenProvider>
        <AppShell>{children}</AppShell>
      </ZkTokenProvider>
    </WalletProvider>
  );
}
