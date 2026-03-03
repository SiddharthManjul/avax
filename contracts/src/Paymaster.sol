// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ShieldedPool} from "./ShieldedPool.sol";

/**
 * @title Paymaster
 * @notice Holds AVAX and refunds gas to relayers who submit ZK proofs on behalf
 *         of users. This breaks the on-chain link between a user's EVM address
 *         and their shielded pool activity.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 *   • Permissionless: anyone can relay (no whitelist).
 *   • Front-running protection: `relayerAddress` param must equal `msg.sender`.
 *   • Gas refund: `(gasUsed + GAS_OVERHEAD) * min(tx.gasprice, maxGasPrice)`
 *     sent to msg.sender after the pool call succeeds.
 *   • Owner can cap `maxGasPrice` to prevent griefing.
 *   • No modifications to ShieldedPool required — it doesn't check msg.sender.
 */
contract Paymaster {
    // ────────────────────────────────────────────────────────────────────────
    // State
    // ────────────────────────────────────────────────────────────────────────

    /// @notice The ShieldedPool this paymaster forwards calls to.
    ShieldedPool public immutable pool;

    /// @notice Owner (deployer) — can drain funds and set max gas price.
    address public owner;

    /// @notice Maximum gas price the paymaster will reimburse (anti-griefing).
    uint256 public maxGasPrice;

    /// @notice Fixed overhead added to measured gas to cover the refund transfer itself.
    uint256 public constant GAS_OVERHEAD = 50_000;

    // ────────────────────────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────────────────────────

    event RelayedTransfer(address indexed relayer, uint256 gasRefund);
    event RelayedWithdraw(address indexed relayer, uint256 gasRefund);
    event Funded(address indexed from, uint256 amount);
    event Drained(address indexed to, uint256 amount);
    event MaxGasPriceUpdated(uint256 newMaxGasPrice);
    event OwnerTransferred(address indexed oldOwner, address indexed newOwner);

    // ────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ────────────────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Paymaster: not owner");
        _;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Constructor
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @param _pool         ShieldedPool contract address.
     * @param _maxGasPrice  Initial max reimbursable gas price (e.g. 100 gwei).
     */
    constructor(address _pool, uint256 _maxGasPrice) {
        require(_pool != address(0), "Paymaster: zero pool");
        pool = ShieldedPool(_pool);
        owner = msg.sender;
        maxGasPrice = _maxGasPrice;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Relay: Private Transfer
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Relay a private transfer on behalf of a user.
     * @param relayerAddress    Must equal msg.sender (front-running protection).
     * @param proof             ABI-encoded Groth16 proof.
     * @param merkleRoot        Merkle root the proof was generated against.
     * @param nullifierHash     Nullifier of the consumed note.
     * @param newCommitment1    Recipient note commitment.
     * @param newCommitment2    Change note commitment.
     * @param encryptedMemo1    ECDH-encrypted note data for recipient.
     * @param encryptedMemo2    ECDH-encrypted change note data for sender.
     */
    function relayTransfer(
        address relayerAddress,
        bytes calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 newCommitment1,
        uint256 newCommitment2,
        bytes calldata encryptedMemo1,
        bytes calldata encryptedMemo2
    ) external {
        uint256 gasStart = gasleft();
        require(msg.sender == relayerAddress, "Paymaster: relayer mismatch");

        pool.transfer(
            proof,
            merkleRoot,
            nullifierHash,
            newCommitment1,
            newCommitment2,
            encryptedMemo1,
            encryptedMemo2
        );

        uint256 gasUsed = gasStart - gasleft() + GAS_OVERHEAD;
        uint256 refund = _refund(gasUsed);

        emit RelayedTransfer(msg.sender, refund);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Relay: Withdraw
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Relay a withdrawal on behalf of a user.
     * @param relayerAddress    Must equal msg.sender (front-running protection).
     * @param proof             ABI-encoded Groth16 proof.
     * @param merkleRoot        Merkle root the proof was generated against.
     * @param nullifierHash     Nullifier of the consumed note.
     * @param amount            Token amount to release.
     * @param changeCommitment  Change note commitment (0 for full withdrawal).
     * @param recipient         Address to send ERC20 tokens to.
     * @param encryptedMemo     ECDH-encrypted change note data.
     */
    function relayWithdraw(
        address relayerAddress,
        bytes calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        uint256 changeCommitment,
        address recipient,
        bytes calldata encryptedMemo
    ) external {
        uint256 gasStart = gasleft();
        require(msg.sender == relayerAddress, "Paymaster: relayer mismatch");

        pool.withdraw(
            proof,
            merkleRoot,
            nullifierHash,
            amount,
            changeCommitment,
            recipient,
            encryptedMemo
        );

        uint256 gasUsed = gasStart - gasleft() + GAS_OVERHEAD;
        uint256 refund = _refund(gasUsed);

        emit RelayedWithdraw(msg.sender, refund);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Funding
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Deposit AVAX to fund gas refunds.
    function fund() external payable {
        require(msg.value > 0, "Paymaster: zero value");
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Accept AVAX sent directly.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    /// @notice Owner-only: withdraw AVAX from the paymaster.
    function drain(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Paymaster: zero address");
        require(amount <= address(this).balance, "Paymaster: insufficient balance");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Paymaster: drain failed");
        emit Drained(to, amount);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Admin
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Owner-only: set the maximum reimbursable gas price.
    function setMaxGasPrice(uint256 _maxGasPrice) external onlyOwner {
        maxGasPrice = _maxGasPrice;
        emit MaxGasPriceUpdated(_maxGasPrice);
    }

    /// @notice Owner-only: transfer ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Paymaster: zero owner");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ────────────────────────────────────────────────────────────────────────
    // View
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Returns the AVAX balance available for gas refunds.
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Internal
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @dev Compute and send the gas refund to msg.sender.
     *      Refund = gasUsed * min(tx.gasprice, maxGasPrice).
     *      Silently caps at available balance (never reverts on low funds).
     */
    function _refund(uint256 gasUsed) internal returns (uint256 refund) {
        uint256 price = tx.gasprice < maxGasPrice ? tx.gasprice : maxGasPrice;
        refund = gasUsed * price;

        // Cap at available balance
        if (refund > address(this).balance) {
            refund = address(this).balance;
        }

        if (refund > 0) {
            (bool ok, ) = msg.sender.call{value: refund}("");
            require(ok, "Paymaster: refund failed");
        }
    }
}
