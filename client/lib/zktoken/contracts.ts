/**
 * contracts.ts — Centralized contract configuration from environment variables.
 *
 * Reads NEXT_PUBLIC_* env vars set in .env.local (filled post-deployment).
 */

export interface ContractConfig {
  poolAddress: string;
  tokenAddress: string;
  registryAddress: string;
  chainId: number;
  rpcUrl: string;
}

/**
 * Returns the contract addresses and network config from env vars.
 * Throws if required addresses are missing.
 */
export function getConfig(): ContractConfig {
  const poolAddress = process.env.NEXT_PUBLIC_SHIELDED_POOL_ADDRESS ?? "";
  const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? "";
  const registryAddress = process.env.NEXT_PUBLIC_POOL_REGISTRY_ADDRESS ?? "";
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "43113");
  const rpcUrl =
    process.env.NEXT_PUBLIC_RPC_URL ??
    "https://api.avax-test.network/ext/bc/C/rpc";

  return { poolAddress, tokenAddress, registryAddress, chainId, rpcUrl };
}

/**
 * Returns true if all required contract addresses are configured.
 */
export function isConfigured(): boolean {
  const { poolAddress, tokenAddress } = getConfig();
  return poolAddress.length > 0 && tokenAddress.length > 0;
}

/**
 * Returns the registry address from env, or empty string if not set.
 */
export function getRegistryAddress(): string {
  return process.env.NEXT_PUBLIC_POOL_REGISTRY_ADDRESS ?? "";
}

// Re-export ABIs for convenience
export { SHIELDED_POOL_ABI } from "./abi/shielded-pool";
export { TEST_TOKEN_ABI } from "./abi/test-token";
export { TRANSFER_VERIFIER_ABI } from "./abi/transfer-verifier";
export { WITHDRAW_VERIFIER_ABI } from "./abi/withdraw-verifier";
export { POOL_REGISTRY_ABI } from "./abi/pool-registry";
