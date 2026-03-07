export const POOL_REGISTRY_ABI = [
  "function createPool(address token, uint256 maxGasPrice) external returns (address pool, address paymaster)",
  "function getPool(address token) external view returns (tuple(address pool, address paymaster, address token, string symbol, uint8 decimals, uint256 createdAt))",
  "function tryGetPool(address token) external view returns (tuple(address pool, address paymaster, address token, string symbol, uint8 decimals, uint256 createdAt))",
  "function getAllPools() external view returns (tuple(address pool, address paymaster, address token, string symbol, uint8 decimals, uint256 createdAt)[])",
  "function poolCount() external view returns (uint256)",
  "function registeredTokens(uint256) external view returns (address)",
  "function transferVerifier() external view returns (address)",
  "function withdrawVerifier() external view returns (address)",
  "function poseidon() external view returns (address)",
  "function owner() external view returns (address)",
  "event PoolCreated(address indexed token, address pool, address paymaster, string symbol, uint8 decimals)",
] as const;
