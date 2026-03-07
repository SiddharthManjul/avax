// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IncrementalMerkleTree} from "./IncrementalMerkleTree.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";

/// @dev Minimal ERC20 interface — transfer + transferFrom only.
interface IERC20 {
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title ShieldedPool
 * @notice Privacy-preserving ERC20 wrapper using Groth16 ZK proofs and an
 *         incremental Poseidon Merkle tree.
 *
 * ─── Architecture (Option A — in-circuit Pedersen balance check) ──────────
 *   Pedersen commitment coordinates never appear on-chain. The ZK circuit
 *   verifies C_in == C_out_1 + C_out_2 via BabyAdd internally. The contract
 *   receives only 4 public outputs per proof:
 *     Transfer : [merkle_root, nullifier_hash, new_commitment_1, new_commitment_2]
 *     Withdraw : [merkle_root, nullifier_hash, amount,           change_commitment]
 *
 * ─── ERC20 interface (minimal, no SafeERC20 dep) ─────────────────────────
 *   We use a local IERC20 to avoid importing OpenZeppelin, keeping this
 *   repo dependency-free (only forge-std for tests).
 *
 * ─── Security properties ─────────────────────────────────────────────────
 *   • Nullifier double-spend: enforced by `nullifiers` mapping
 *   • Stale proof tolerance: last 30 roots accepted (see IncrementalMerkleTree)
 *   • Range proofs: enforced inside ZK circuit (64-bit amounts, Num2Bits)
 *   • Reentrancy: ERC20 transfer is the last operation in withdraw()
 */
contract ShieldedPool {
    using IncrementalMerkleTree for IncrementalMerkleTree.TreeData;

    // ────────────────────────────────────────────────────────────────────────
    // State
    // ────────────────────────────────────────────────────────────────────────

    /// @notice The ERC20 token this pool wraps.
    IERC20 public immutable token;

    /// @notice Scaling factor for token amounts. The ZK circuit operates on
    ///         whole-token amounts (e.g. 500) to fit within the 64-bit range
    ///         proof. On-chain ERC20 transfers multiply by this scale factor
    ///         (e.g. 500 * 1e18 = 500 tokens with 18 decimals).
    ///         Set to 10^decimals of the wrapped ERC20 at deploy time.
    uint256 public immutable amountScale;

    /// @notice Groth16 verifier for the transfer circuit (4 public signals).
    IVerifier public immutable transferVerifier;

    /// @notice Groth16 verifier for the withdraw circuit (4 public signals).
    IVerifier public immutable withdrawVerifier;

    /// @dev Incremental Poseidon Merkle tree (depth 20).
    IncrementalMerkleTree.TreeData internal _tree;

    /// @notice Spent nullifier registry. True ⇒ note already consumed.
    mapping(uint256 => bool) public nullifiers;

    // ────────────────────────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Emitted when a note commitment is inserted during deposit.
     * @param commitment  The note commitment (leaf value).
     * @param leafIndex   Position in the Merkle tree.
     * @param timestamp   Block timestamp for client-side tree sync.
     */
    event Deposit(
        uint256 indexed commitment,
        uint32 leafIndex,
        uint256 timestamp
    );

    /**
     * @notice Emitted on a successful private transfer.
     * @param nullifierHash   Nullifier of the consumed input note.
     * @param commitment1     New note commitment for the recipient.
     * @param commitment2     Change note commitment back to sender.
     * @param encryptedMemo1  ECDH-encrypted note data for recipient.
     * @param encryptedMemo2  ECDH-encrypted note data for sender (change note).
     */
    event PrivateTransfer(
        uint256 nullifierHash,
        uint256 commitment1,
        uint256 commitment2,
        bytes encryptedMemo1,
        bytes encryptedMemo2
    );

    /**
     * @notice Emitted on a successful withdrawal.
     * @param nullifierHash   Nullifier of the consumed input note.
     * @param recipient       Address that received the ERC20 tokens.
     * @param amount          Token amount withdrawn (public, intentional).
     * @param changeCommitment New commitment for the change note (if any).
     * @param encryptedMemo   ECDH-encrypted change note data.
     */
    event Withdrawal(
        uint256 nullifierHash,
        address indexed recipient,
        uint256 amount,
        uint256 changeCommitment,
        bytes encryptedMemo
    );

    // ────────────────────────────────────────────────────────────────────────
    // Constructor
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @param _token           ERC20 token address.
     * @param _transferVerifier Deployed Groth16VerifierTransfer address.
     * @param _withdrawVerifier Deployed Groth16VerifierWithdraw address.
     * @param _poseidon        Deployed Poseidon(2) contract (must match circuit params).
     * @param _amountScale     Scaling factor = 10^decimals of the wrapped ERC20.
     */
    constructor(
        address _token,
        address _transferVerifier,
        address _withdrawVerifier,
        address _poseidon,
        uint256 _amountScale
    ) {
        require(_token != address(0), "ShieldedPool: zero token");
        require(
            _transferVerifier != address(0),
            "ShieldedPool: zero transfer verifier"
        );
        require(
            _withdrawVerifier != address(0),
            "ShieldedPool: zero withdraw verifier"
        );
        require(_poseidon != address(0), "ShieldedPool: zero poseidon");
        require(_amountScale > 0, "ShieldedPool: zero scale");

        token = IERC20(_token);
        transferVerifier = IVerifier(_transferVerifier);
        withdrawVerifier = IVerifier(_withdrawVerifier);
        amountScale = _amountScale;

        _tree.init(_poseidon);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Deposit
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Lock ERC20 tokens and insert a note commitment into the Merkle tree.
     *
     * The deposit amount IS visible on-chain (ERC20 transfer is public). Privacy
     * begins after the note is in the tree. For maximum anonymity, use fixed
     * denomination amounts so deposits are indistinguishable.
     *
     * @param amount      Token amount to lock (must be approved first).
     * @param commitment  Note commitment = Poseidon(pedersen.x, pedersen.y,
     *                    secret, nullifier_preimage, owner_pk.x).
     *                    Computed entirely client-side; never validated here.
     */
    function deposit(uint256 amount, uint256 commitment) external {
        require(amount > 0, "ShieldedPool: zero amount");
        require(commitment != 0, "ShieldedPool: zero commitment");

        // Pull tokens — amount is in whole-token units, scale to ERC20 decimals
        bool ok = token.transferFrom(msg.sender, address(this), amount * amountScale);
        require(ok, "ShieldedPool: transferFrom failed");

        // Insert commitment into the Merkle tree
        (uint32 leafIndex, ) = _tree.insert(commitment);

        emit Deposit(commitment, leafIndex, block.timestamp);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Private Transfer
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Consume an existing note (via nullifier) and create two new notes.
     *
     * No tokens enter or leave the contract. The Pedersen balance check
     * (C_in == C_out1 + C_out2) is proven inside the ZK circuit; the contract
     * only sees the 4 public signals.
     *
     * @param proof          ABI-encoded Groth16 proof [pA, pB, pC].
     * @param merkleRoot     Merkle root the proof was generated against.
     * @param nullifierHash  Nullifier of the consumed note.
     * @param newCommitment1 Recipient note commitment.
     * @param newCommitment2 Change note commitment.
     * @param encryptedMemo1 ECDH-encrypted note data for the recipient.
     * @param encryptedMemo2 ECDH-encrypted change note data for the sender.
     */
    function transfer(
        bytes calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 newCommitment1,
        uint256 newCommitment2,
        bytes calldata encryptedMemo1,
        bytes calldata encryptedMemo2
    ) external {
        // ── Input validation ────────────────────────────────────────────────
        require(_tree.isKnownRoot(merkleRoot), "ShieldedPool: unknown root");
        require(!nullifiers[nullifierHash], "ShieldedPool: note already spent");
        require(newCommitment1 != 0, "ShieldedPool: zero commitment1");
        require(newCommitment2 != 0, "ShieldedPool: zero commitment2");

        // ── Decode and verify proof ─────────────────────────────────────────
        (
            uint256[2] memory pA,
            uint256[2][2] memory pB,
            uint256[2] memory pC
        ) = _decodeProof(proof);

        uint256[4] memory pubSignals = [
            merkleRoot,
            nullifierHash,
            newCommitment1,
            newCommitment2
        ];

        require(
            transferVerifier.verifyProof(pA, pB, pC, pubSignals),
            "ShieldedPool: invalid transfer proof"
        );

        // ── State updates ───────────────────────────────────────────────────
        nullifiers[nullifierHash] = true;

        _tree.insert(newCommitment1);
        _tree.insert(newCommitment2);

        emit PrivateTransfer(
            nullifierHash,
            newCommitment1,
            newCommitment2,
            encryptedMemo1,
            encryptedMemo2
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // Withdraw
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @notice Consume a note and release ERC20 tokens to `recipient`.
     *
     * The withdrawal amount is public (necessary to release ERC20). The link
     * between depositor and withdrawer is hidden by the ZK proof.
     *
     * If the note amount exceeds `amount`, a change commitment is inserted
     * for the remainder. Set `changeCommitment = 0` for a full withdrawal
     * (the circuit must also enforce this).
     *
     * @param proof            ABI-encoded Groth16 proof [pA, pB, pC].
     * @param merkleRoot       Merkle root the proof was generated against.
     * @param nullifierHash    Nullifier of the consumed note.
     * @param amount           Token amount to release.
     * @param changeCommitment Change note commitment (0 for full withdrawal).
     * @param recipient        Address to send ERC20 tokens to.
     * @param encryptedMemo    ECDH-encrypted change note data (ignored if no change).
     */
    function withdraw(
        bytes calldata proof,
        uint256 merkleRoot,
        uint256 nullifierHash,
        uint256 amount,
        uint256 changeCommitment,
        address recipient,
        bytes calldata encryptedMemo
    ) external {
        // ── Input validation ────────────────────────────────────────────────
        require(_tree.isKnownRoot(merkleRoot), "ShieldedPool: unknown root");
        require(!nullifiers[nullifierHash], "ShieldedPool: note already spent");
        require(amount > 0, "ShieldedPool: zero amount");
        require(recipient != address(0), "ShieldedPool: zero recipient");

        // ── Decode and verify proof ─────────────────────────────────────────
        (
            uint256[2] memory pA,
            uint256[2][2] memory pB,
            uint256[2] memory pC
        ) = _decodeProof(proof);

        uint256[4] memory pubSignals = [
            merkleRoot,
            nullifierHash,
            amount,
            changeCommitment
        ];

        require(
            withdrawVerifier.verifyProof(pA, pB, pC, pubSignals),
            "ShieldedPool: invalid withdraw proof"
        );

        // ── State updates (before ERC20 transfer — reentrancy protection) ───
        nullifiers[nullifierHash] = true;

        if (changeCommitment != 0) {
            _tree.insert(changeCommitment);
        }

        // ── Release tokens (last operation) — scale to ERC20 decimals ─────
        bool ok = token.transfer(recipient, amount * amountScale);
        require(ok, "ShieldedPool: transfer failed");

        emit Withdrawal(
            nullifierHash,
            recipient,
            amount,
            changeCommitment,
            encryptedMemo
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // View functions
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Returns the current Merkle root.
    function getRoot() external view returns (uint256) {
        return _tree.getRoot();
    }

    /// @notice Returns the next leaf index (= current tree size).
    function getNextLeafIndex() external view returns (uint32) {
        return _tree.nextIndex;
    }

    /// @notice Returns true if the nullifier has been spent.
    function isSpent(uint256 nullifierHash) external view returns (bool) {
        return nullifiers[nullifierHash];
    }

    /// @notice Returns true if the root is in the historical root set.
    function isKnownRoot(uint256 root) external view returns (bool) {
        return _tree.isKnownRoot(root);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ────────────────────────────────────────────────────────────────────────

    /**
     * @dev Decode the packed proof bytes into the three Groth16 components.
     *
     * ABI encoding of [pA(2), pB(2,2), pC(2)] is:
     *   bytes = abi.encode(uint256[2], uint256[2][2], uint256[2])
     *
     * This matches the output of snarkjs.groth16.exportSolidityCallData().
     */
    function _decodeProof(
        bytes calldata proof
    )
        internal
        pure
        returns (
            uint256[2] memory pA,
            uint256[2][2] memory pB,
            uint256[2] memory pC
        )
    {
        require(proof.length == 256, "ShieldedPool: invalid proof length");
        (pA, pB, pC) = abi.decode(
            proof,
            (uint256[2], uint256[2][2], uint256[2])
        );
    }
}
