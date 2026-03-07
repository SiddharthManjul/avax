// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ShieldedPool} from "./ShieldedPool.sol";
import {Paymaster} from "./Paymaster.sol";

/// @dev Minimal ERC20 metadata interface for reading symbol/decimals at pool creation.
interface IERC20Metadata {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

/**
 * @title PoolRegistry
 * @notice Factory + registry for ShieldedPool instances.
 *
 * Deploys one ShieldedPool + one Paymaster per ERC20 token. Shared
 * infrastructure (transfer verifier, withdraw verifier, Poseidon) is
 * deployed once and reused across all pools.
 *
 * Pool creation is permissionless — anyone can call `createPool`.
 */
contract PoolRegistry {
    // ────────────────────────────────────────────────────────────────────────
    // Types
    // ────────────────────────────────────────────────────────────────────────

    struct PoolInfo {
        address pool;
        address paymaster;
        address token;
        string symbol;
        uint8 decimals;
        uint256 createdAt;
    }

    // ────────────────────────────────────────────────────────────────────────
    // State
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Shared Groth16 transfer verifier (deployed once).
    address public immutable transferVerifier;

    /// @notice Shared Groth16 withdraw verifier (deployed once).
    address public immutable withdrawVerifier;

    /// @notice Shared Poseidon(2) hasher (deployed once).
    address public immutable poseidon;

    /// @notice Registry owner — can transfer ownership.
    address public owner;

    /// @notice token address → pool info.
    mapping(address => PoolInfo) internal _tokenToPool;

    /// @notice Ordered list of registered token addresses (for enumeration).
    address[] public registeredTokens;

    // ────────────────────────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────────────────────────

    event PoolCreated(
        address indexed token,
        address pool,
        address paymaster,
        string symbol,
        uint8 decimals
    );
    event OwnerTransferred(address indexed oldOwner, address indexed newOwner);

    // ────────────────────────────────────────────────────────────────────────
    // Constructor
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @param _transferVerifier Deployed Groth16 transfer verifier.
     * @param _withdrawVerifier Deployed Groth16 withdraw verifier.
     * @param _poseidon         Deployed Poseidon(2) contract.
     */
    constructor(
        address _transferVerifier,
        address _withdrawVerifier,
        address _poseidon
    ) {
        require(_transferVerifier != address(0), "PoolRegistry: zero transfer verifier");
        require(_withdrawVerifier != address(0), "PoolRegistry: zero withdraw verifier");
        require(_poseidon != address(0), "PoolRegistry: zero poseidon");

        transferVerifier = _transferVerifier;
        withdrawVerifier = _withdrawVerifier;
        poseidon = _poseidon;
        owner = msg.sender;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Pool creation
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deploy a ShieldedPool + Paymaster for `token`.
     * @param token       ERC20 token address (must expose symbol() and decimals()).
     * @param maxGasPrice Maximum gas price the paymaster will reimburse.
     * @return pool       Deployed ShieldedPool address.
     * @return paymaster  Deployed Paymaster address.
     */
    function createPool(
        address token,
        uint256 maxGasPrice
    ) external returns (address pool, address paymaster) {
        require(token != address(0), "PoolRegistry: zero token");
        require(_tokenToPool[token].pool == address(0), "PoolRegistry: pool exists");

        // Read ERC20 metadata
        string memory symbol = IERC20Metadata(token).symbol();
        uint8 decimals = IERC20Metadata(token).decimals();
        uint256 scale = 10 ** uint256(decimals);

        // Deploy ShieldedPool
        ShieldedPool poolContract = new ShieldedPool(
            token,
            transferVerifier,
            withdrawVerifier,
            poseidon,
            scale
        );
        pool = address(poolContract);

        // Deploy Paymaster
        Paymaster paymasterContract = new Paymaster(pool, maxGasPrice);
        paymaster = address(paymasterContract);

        // Transfer paymaster ownership to the caller
        paymasterContract.transferOwnership(msg.sender);

        // Register
        _tokenToPool[token] = PoolInfo({
            pool: pool,
            paymaster: paymaster,
            token: token,
            symbol: symbol,
            decimals: decimals,
            createdAt: block.timestamp
        });
        registeredTokens.push(token);

        emit PoolCreated(token, pool, paymaster, symbol, decimals);
    }

    // ────────────────────────────────────────────────────────────────────────
    // View functions
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Returns pool info for a given token. Reverts if no pool exists.
    function getPool(address token) external view returns (PoolInfo memory) {
        PoolInfo memory info = _tokenToPool[token];
        require(info.pool != address(0), "PoolRegistry: no pool for token");
        return info;
    }

    /// @notice Returns pool info or zero-address pool if none exists (no revert).
    function tryGetPool(address token) external view returns (PoolInfo memory) {
        return _tokenToPool[token];
    }

    /// @notice Returns all registered pools.
    function getAllPools() external view returns (PoolInfo[] memory) {
        uint256 len = registeredTokens.length;
        PoolInfo[] memory pools = new PoolInfo[](len);
        for (uint256 i = 0; i < len; i++) {
            pools[i] = _tokenToPool[registeredTokens[i]];
        }
        return pools;
    }

    /// @notice Returns the number of registered pools.
    function poolCount() external view returns (uint256) {
        return registeredTokens.length;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Admin
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Transfer registry ownership.
    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "PoolRegistry: not owner");
        require(newOwner != address(0), "PoolRegistry: zero owner");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }
}
