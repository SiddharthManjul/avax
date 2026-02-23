pragma circom 2.2.2;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/babyjub.circom";
include "lib/merkle_tree.circom";
include "lib/pedersen.circom";
include "lib/nullifier.circom";
include "lib/range_proof.circom";

//
// Withdraw
//
// Proves a valid private withdrawal:
//   - sender owns a note committed in the Merkle tree
//   - the consumed note's Pedersen commitment is correctly formed
//   - the nullifier is correctly derived (prevents double-spend)
//   - amount (public) + change_amount == amount_in (conservation)
//   - blinding_in == change_blinding (full blinding goes to change note)
//   - change note commitment is correctly formed
//   - both amounts are in 64-bit range
//
// The withdrawal amount is PUBLIC (required to release the correct ERC20 amount).
// This breaks the link between depositor and withdrawer without revealing
// how many prior transfers occurred in between.
//
// On-chain Pedersen balance check (C_in == C_withdraw + C_change) is handled
// via the ecAdd precompile — NOT in this circuit.
//
template Withdraw(depth) {

    // -----------------------------------------------------------------------
    // Public inputs (visible on-chain)
    // -----------------------------------------------------------------------
    signal input merkle_root;         // Merkle tree root used in proof
    signal input nullifier_hash;      // nullifier of the consumed note
    signal input amount;              // withdrawal amount (revealed to release ERC20)
    signal input input_pedersen_x;    // x-coord of input Pedersen commitment
    signal input input_pedersen_y;    // y-coord of input Pedersen commitment
    signal input change_pedersen_x;   // x-coord of change Pedersen commitment
    signal input change_pedersen_y;   // y-coord of change Pedersen commitment
    signal input change_commitment;   // change note commitment

    // -----------------------------------------------------------------------
    // Private inputs — input note
    // -----------------------------------------------------------------------
    signal input amount_in;              // uint64 total amount in the note
    signal input blinding_in;            // Pedersen blinding factor
    signal input secret;                 // 31-byte secret known only to owner
    signal input nullifier_preimage;     // 31-byte value used to derive nullifier
    signal input owner_private_key;      // sender's Baby Jubjub private key
    signal input leaf_index;             // position of note in Merkle tree
    signal input merkle_path[depth];     // sibling hashes along the Merkle path
    signal input path_indices[depth];    // 0=left, 1=right at each level

    // -----------------------------------------------------------------------
    // Private inputs — change note (remainder after withdrawal)
    // -----------------------------------------------------------------------
    signal input change_amount;              // uint64 change back to sender
    signal input change_blinding;            // Pedersen blinding for change note
    signal input secret_change;              // change note secret
    signal input nullifier_preimage_change;  // change note nullifier preimage
    signal input owner_pk_change_x;          // sender's Baby Jubjub pk.x (change owner)

    // -----------------------------------------------------------------------
    // 1. Ownership: derive owner public key from private key
    // -----------------------------------------------------------------------
    component ownerPk = BabyPbk();
    ownerPk.in <== owner_private_key;

    // -----------------------------------------------------------------------
    // 2. Input Pedersen commitment correctness
    //    Proves: input_pedersen = amount_in * G + blinding_in * H
    // -----------------------------------------------------------------------
    component pedersenIn = PedersenCommitment();
    pedersenIn.value        <== amount_in;
    pedersenIn.blinding     <== blinding_in;
    pedersenIn.commitment_x <== input_pedersen_x;
    pedersenIn.commitment_y <== input_pedersen_y;

    // -----------------------------------------------------------------------
    // 3. Note commitment reconstruction + Merkle inclusion proof
    //    note_commitment = Poseidon(ped.x, ped.y, secret, nullifier_preimage, owner_pk.x)
    // -----------------------------------------------------------------------
    component noteHasher = Poseidon(5);
    noteHasher.inputs[0] <== input_pedersen_x;
    noteHasher.inputs[1] <== input_pedersen_y;
    noteHasher.inputs[2] <== secret;
    noteHasher.inputs[3] <== nullifier_preimage;
    noteHasher.inputs[4] <== ownerPk.Ax;

    component merkleProof = MerkleTreeInclusionProof(depth);
    merkleProof.leaf <== noteHasher.out;
    for (var i = 0; i < depth; i++) {
        merkleProof.path_elements[i] <== merkle_path[i];
        merkleProof.path_indices[i]  <== path_indices[i];
    }
    merkleProof.root === merkle_root;

    // -----------------------------------------------------------------------
    // 4. Nullifier derivation
    //    nullifier = Poseidon(nullifier_preimage, secret, leaf_index)
    // -----------------------------------------------------------------------
    component nullifierComp = NullifierDeriver();
    nullifierComp.nullifier_preimage <== nullifier_preimage;
    nullifierComp.secret             <== secret;
    nullifierComp.leaf_index         <== leaf_index;
    nullifierComp.nullifier === nullifier_hash;

    // -----------------------------------------------------------------------
    // 5. Amount conservation: amount_in == amount (public) + change_amount
    // -----------------------------------------------------------------------
    amount_in === amount + change_amount;

    // -----------------------------------------------------------------------
    // 6. Blinding conservation: blinding_in == change_blinding
    //    For a withdrawal, the withdrawn portion has no change note on the
    //    prover side — the ERC20 transfer is the "output". The full blinding
    //    factor is assigned to the change note so the on-chain ecAdd check
    //    C_in == C_withdraw_pedersen + C_change passes.
    //    (C_withdraw_pedersen is computed on-chain for the revealed amount.)
    // -----------------------------------------------------------------------
    blinding_in === change_blinding;

    // -----------------------------------------------------------------------
    // 7. Range proofs: both amounts must fit in 64 bits
    // -----------------------------------------------------------------------
    component rangeWithdraw = RangeProof(64);
    rangeWithdraw.value <== amount;

    component rangeChange = RangeProof(64);
    rangeChange.value <== change_amount;

    // -----------------------------------------------------------------------
    // 8. Change Pedersen commitment correctness
    //    Proves: change_pedersen = change_amount * G + change_blinding * H
    // -----------------------------------------------------------------------
    component pedersenChange = PedersenCommitment();
    pedersenChange.value        <== change_amount;
    pedersenChange.blinding     <== change_blinding;
    pedersenChange.commitment_x <== change_pedersen_x;
    pedersenChange.commitment_y <== change_pedersen_y;

    // -----------------------------------------------------------------------
    // 9. Change note commitment correctness
    //    change_commitment = Poseidon(change_ped.x, change_ped.y, secret_change,
    //                                  nullifier_preimage_change, owner_pk_change.x)
    // -----------------------------------------------------------------------
    component noteChange = Poseidon(5);
    noteChange.inputs[0] <== change_pedersen_x;
    noteChange.inputs[1] <== change_pedersen_y;
    noteChange.inputs[2] <== secret_change;
    noteChange.inputs[3] <== nullifier_preimage_change;
    noteChange.inputs[4] <== owner_pk_change_x;
    noteChange.out === change_commitment;
}

component main {public [
    merkle_root,
    nullifier_hash,
    amount,
    input_pedersen_x,
    input_pedersen_y,
    change_pedersen_x,
    change_pedersen_y,
    change_commitment
]} = Withdraw(20);
