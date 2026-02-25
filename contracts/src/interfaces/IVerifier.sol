// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVerifier
 * @notice Interface implemented by both auto-generated Groth16 verifier contracts.
 *
 * Both the transfer and withdraw circuits expose exactly 4 public signals, so a
 * single interface covers both verifiers. This lets ShieldedPool accept either
 * verifier address through the same typed variable.
 *
 * Public signal ordering:
 *   Transfer : [merkle_root, nullifier_hash, new_commitment_1, new_commitment_2]
 *   Withdraw : [merkle_root, nullifier_hash, amount,           change_commitment]
 *
 * The proof arguments use the standard Groth16 BN254 representation as
 * produced by snarkjs:
 *   _pA  — G1 point (x, y)
 *   _pB  — G2 point ((x1, x2), (y1, y2)) in Fq2
 *   _pC  — G1 point (x, y)
 */
interface IVerifier {
    /**
     * @param _pA         Groth16 proof element A (G1 point)
     * @param _pB         Groth16 proof element B (G2 point)
     * @param _pC         Groth16 proof element C (G1 point)
     * @param _pubSignals 4 public circuit outputs, circuit-specific ordering
     * @return            true iff the proof is valid for the given public signals
     */
    function verifyProof(
        uint256[2]    calldata _pA,
        uint256[2][2] calldata _pB,
        uint256[2]    calldata _pC,
        uint256[4]    calldata _pubSignals
    ) external view returns (bool);
}
