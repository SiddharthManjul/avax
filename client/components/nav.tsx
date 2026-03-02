"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./wallet-button";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/deposit", label: "Deposit" },
  { href: "/transfer", label: "Transfer" },
  { href: "/withdraw", label: "Withdraw" },
  { href: "/notes", label: "Notes" },
  { href: "/faucet", label: "Faucet" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-[#2a2a2a] bg-black">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-bold text-[#ff1a1a] tracking-wide">
            ZkToken
          </Link>
          <div className="flex gap-1">
            {links.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-200 ${
                  pathname === href
                    ? "bg-[#ff1a1a]/10 text-[#ff1a1a] border border-[#ff1a1a]/40"
                    : "text-[#888888] hover:text-[#ff1a1a] hover:bg-[#ff1a1a]/5"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
        <WalletButton />
      </div>
    </nav>
  );
}
