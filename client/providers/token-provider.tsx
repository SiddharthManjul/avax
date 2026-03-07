"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useWallet } from "@/hooks/use-wallet";
import type { PoolInfo } from "@/lib/zktoken/registry";

const STORAGE_KEY = "zktoken_active_token";

interface TokenContextValue {
  /** All registered tokens from the on-chain registry. */
  tokens: PoolInfo[];
  /** Currently selected token (null while loading or if none available). */
  activeToken: PoolInfo | null;
  /** Switch the active token. */
  setActiveToken: (token: PoolInfo) => void;
  /** True while fetching from registry. */
  loading: boolean;
  /** Reload pools from the registry. */
  refresh: () => Promise<void>;
}

const TokenContext = createContext<TokenContextValue>({
  tokens: [],
  activeToken: null,
  setActiveToken: () => {},
  loading: false,
  refresh: async () => {},
});

export function useToken() {
  return useContext(TokenContext);
}

export function TokenProvider({ children }: { children: ReactNode }) {
  const { provider } = useWallet();
  const [tokens, setTokens] = useState<PoolInfo[]>([]);
  const [activeToken, setActiveTokenState] = useState<PoolInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const registryAddress =
    process.env.NEXT_PUBLIC_POOL_REGISTRY_ADDRESS ?? "";

  const fetchPools = useCallback(async () => {
    if (!provider || !registryAddress) {
      // Fallback: construct a single pool from legacy env vars
      const poolAddr = process.env.NEXT_PUBLIC_SHIELDED_POOL_ADDRESS ?? "";
      const tokenAddr = process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? "";
      const paymasterAddr = process.env.NEXT_PUBLIC_PAYMASTER_ADDRESS ?? "";
      if (poolAddr && tokenAddr) {
        const fallback: PoolInfo = {
          pool: poolAddr,
          paymaster: paymasterAddr,
          token: tokenAddr,
          symbol: "SRD",
          decimals: 18,
          createdAt: 0,
        };
        setTokens([fallback]);
        setActiveTokenState(fallback);
      }
      return;
    }

    setLoading(true);
    try {
      const { fetchAllPools } = await import("@/lib/zktoken/registry");
      const pools = await fetchAllPools(registryAddress, provider);
      setTokens(pools);

      if (pools.length > 0) {
        // Restore previously selected token from localStorage
        const savedAddr =
          typeof window !== "undefined"
            ? localStorage.getItem(STORAGE_KEY)
            : null;
        const saved = savedAddr
          ? pools.find(
              (p) => p.token.toLowerCase() === savedAddr.toLowerCase()
            )
          : null;
        setActiveTokenState(saved ?? pools[0]);
      }
    } catch (err) {
      console.warn("[TokenProvider] Failed to fetch pools from registry:", err);
      // Fallback to legacy env vars
      const poolAddr = process.env.NEXT_PUBLIC_SHIELDED_POOL_ADDRESS ?? "";
      const tokenAddr = process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? "";
      const paymasterAddr = process.env.NEXT_PUBLIC_PAYMASTER_ADDRESS ?? "";
      if (poolAddr && tokenAddr) {
        const fallback: PoolInfo = {
          pool: poolAddr,
          paymaster: paymasterAddr,
          token: tokenAddr,
          symbol: "SRD",
          decimals: 18,
          createdAt: 0,
        };
        setTokens([fallback]);
        setActiveTokenState(fallback);
      }
    } finally {
      setLoading(false);
    }
  }, [provider, registryAddress]);

  useEffect(() => {
    fetchPools();
  }, [fetchPools]);

  const setActiveToken = useCallback((token: PoolInfo) => {
    setActiveTokenState(token);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, token.token);
    }
  }, []);

  return (
    <TokenContext.Provider
      value={{ tokens, activeToken, setActiveToken, loading, refresh: fetchPools }}
    >
      {children}
    </TokenContext.Provider>
  );
}
