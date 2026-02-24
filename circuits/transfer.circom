pragma circom 2.2.2;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/babyjub.circom";
include "lib/merkle_tree.circom";
include "lib/pedersen.circom";
include "lib/nullifier.circom";
include "lib/range_proof.circom";

//
// PrivateTransfer
//
// Proves a valid private transfer inside the shielded pool:
//   1. Sender owns a note committed in the Merkle tree (ownership + inclusion)
//   2. Input Pedersen commitment is correctly formed
//   3. Nullifier is correctly derived (prevents double-spend)
//   4. Amount is conserved: amount_in == amount_out_1 + amount_out_2
//   5. Blinding is conserved: blinding_in == blinding_out_1 + blinding_out_2
//   6. Pedersen balance holds IN-CIRCUIT: C_in == C_out1 + C_out2
//      (verified via BabyAdd — NOT via on-chain ecAdd precompile)
//   7. Output amounts fit in 64 bits (range proofs)
//   8. Output Pedersen commitments are correctly formed
//   9. Output note commitments are correctly formed
//
// NOTE: Baby Jubjub ≠ BN254 G1. The EVM ecAdd precompile at 0x06 operates
// on BN254 G1 points only and CANNOT be used for Baby Jubjub point addition.
// All Pedersen balance verification is done here inside the circuit.
//
// Pedersen commitment coordinates are entirely PRIVATE — they are computed
// internally and never exposed as public signals. The contract only sees
// {merkle_root, nullifier_hash, new_commitment_1, new_commitment_2}.
//
// Estimated constraints: ~9,000–10,000
//   Ownership (BabyPbk):           ~700
//   Input PedersenCommit:         ~1,200
//   Note commitment (Poseidon5):    ~250
//   Merkle proof (20 × Poseidon2): ~5,000
//   Nullifier (Poseidon3):          ~250
//   Amount conservation:              ~1
//   Blinding conservation:            ~1
//   Range proofs (2 × 64-bit):       ~256
//   Output PedersenCommit × 2:     ~2,400
//   Output note commits × 2:        ~500
//   Balance check (BabyAdd):          ~6
//
template PrivateTransfer(depth) {

    // -----------------------------------------------------------------------
    // Public inputs (visible on-chain, passed to Groth16 verifier)
    // -----------------------------------------------------------------------
    signal input merkle_root;       // Merkle tree root the proof is against
    signal input nullifier_hash;    // nullifier of the consumed note
    signal input new_commitment_1;  // output note commitment for recipient
    signal input new_commitment_2;  // output note commitment for change

    // -----------------------------------------------------------------------
    // Private inputs — input note
    // -----------------------------------------------------------------------
    signal input amount_in;             // uint64 token amount being spent
    signal input blinding_in;           // Pedersen blinding factor
    signal input secret;                // 31-byte secret known only to owner
    signal input nullifier_preimage;    // 31-byte value used to derive nullifier
    signal input owner_private_key;     // sender's Baby Jubjub private key
    signal input leaf_index;            // position of note in Merkle tree
    signal input merkle_path[depth];    // sibling hashes along the Merkle path
    signal input path_indices[depth];   // 0=left child, 1=right child at each level

    // -----------------------------------------------------------------------
    // Private inputs — output notes
    // -----------------------------------------------------------------------
    signal input amount_out_1;              // recipient amount (uint64)
    signal input amount_out_2;              // change amount (uint64)
    signal input blinding_out_1;            // recipient Pedersen blinding factor
    signal input blinding_out_2;            // change Pedersen blinding factor
    signal input secret_out_1;              // recipient note secret
    signal input secret_out_2;              // change note secret
    signal input nullifier_preimage_out_1;  // recipient nullifier preimage
    signal input nullifier_preimage_out_2;  // change nullifier preimage
    signal input owner_pk_out_1_x;          // recipient Baby Jubjub pk.x
    signal input owner_pk_out_1_y;          // recipient Baby Jubjub pk.y
    signal input owner_pk_out_2_x;          // sender Baby Jubjub pk.x (change note)
    signal input owner_pk_out_2_y;          // sender Baby Jubjub pk.y

    // -----------------------------------------------------------------------
    // 1. Ownership: derive owner public key from private key
    //    Proves sender controls the private key committed in the input note.
    //    ~700 constraints
    // -----------------------------------------------------------------------
    component ownerPk = BabyPbk();
    ownerPk.in <== owner_private_key;

    // -----------------------------------------------------------------------
    // 2. Input Pedersen commitment: compute C_in = amount_in*G + blinding_in*H
    //    Result is used for note commitment hashing and the balance check.
    //    ~1,200 constraints
    // -----------------------------------------------------------------------
    component pedersenIn = PedersenCommit();
    pedersenIn.value   <== amount_in;
    pedersenIn.blinding <== blinding_in;
    // pedersenIn.out_x / pedersenIn.out_y = C_in (private, not a public signal)

    // -----------------------------------------------------------------------
    // 3. Note commitment reconstruction + Merkle inclusion proof
    //    note_commitment = Poseidon(C_in.x, C_in.y, secret, nullifier_preimage, owner_pk.x)
    //    Poseidon: ~250 constraints | Merkle proof (20 levels): ~5,000 constraints
    // -----------------------------------------------------------------------
    component noteHasher = Poseidon(5);
    noteHasher.inputs[0] <== pedersenIn.out_x;
    noteHasher.inputs[1] <== pedersenIn.out_y;
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
    //    leaf_index prevents same secret+preimage producing the same nullifier
    //    across different deposits. ~250 constraints
    // -----------------------------------------------------------------------
    component nullifierComp = NullifierDeriver();
    nullifierComp.nullifier_preimage <== nullifier_preimage;
    nullifierComp.secret             <== secret;
    nullifierComp.leaf_index         <== leaf_index;
    nullifierComp.nullifier === nullifier_hash;

    // -----------------------------------------------------------------------
    // 5. Amount conservation
    //    ~1 constraint
    // -----------------------------------------------------------------------
    amount_in === amount_out_1 + amount_out_2;

    // -----------------------------------------------------------------------
    // 6. Blinding conservation
    //    Required so that the Pedersen commitments balance algebraically:
    //    C_in = (v1+v2)*G + (r1+r2)*H = C_out1 + C_out2
    //    Together with constraint 10 (explicit BabyAdd), this provides full
    //    in-circuit proof that the commitment balance holds.
    //    ~1 constraint
    // -----------------------------------------------------------------------
    blinding_in === blinding_out_1 + blinding_out_2;

    // -----------------------------------------------------------------------
    // 7. Range proofs: output amounts must fit in 64 bits
    //    Prevents negative-amount field-wrap attack on token supply.
    //    ~128 constraints each
    // -----------------------------------------------------------------------
    component range1 = RangeProof(64);
    range1.value <== amount_out_1;

    component range2 = RangeProof(64);
    range2.value <== amount_out_2;

    // -----------------------------------------------------------------------
    // 8. Output Pedersen commitments
    //    C_out1 = amount_out_1*G + blinding_out_1*H
    //    C_out2 = amount_out_2*G + blinding_out_2*H
    //    ~1,200 constraints each
    // -----------------------------------------------------------------------
    component pedersenOut1 = PedersenCommit();
    pedersenOut1.value   <== amount_out_1;
    pedersenOut1.blinding <== blinding_out_1;

    component pedersenOut2 = PedersenCommit();
    pedersenOut2.value   <== amount_out_2;
    pedersenOut2.blinding <== blinding_out_2;

    // -----------------------------------------------------------------------
    // 9. Output note commitment correctness
    //    new_commitment_i = Poseidon(C_i.x, C_i.y, secret_i, nullifier_preimage_i, pk_i.x)
    //    ~250 constraints each
    // -----------------------------------------------------------------------
    component noteOut1 = Poseidon(5);
    noteOut1.inputs[0] <== pedersenOut1.out_x;
    noteOut1.inputs[1] <== pedersenOut1.out_y;
    noteOut1.inputs[2] <== secret_out_1;
    noteOut1.inputs[3] <== nullifier_preimage_out_1;
    noteOut1.inputs[4] <== owner_pk_out_1_x;
    noteOut1.out === new_commitment_1;

    component noteOut2 = Poseidon(5);
    noteOut2.inputs[0] <== pedersenOut2.out_x;
    noteOut2.inputs[1] <== pedersenOut2.out_y;
    noteOut2.inputs[2] <== secret_out_2;
    noteOut2.inputs[3] <== nullifier_preimage_out_2;
    noteOut2.inputs[4] <== owner_pk_out_2_x;
    noteOut2.out === new_commitment_2;

    // -----------------------------------------------------------------------
    // 10. In-circuit Pedersen balance check: C_in == C_out1 + C_out2
    //     Explicit Edwards point addition on Baby Jubjub (~6 constraints).
    //     This — combined with constraints 5 and 6 — fully proves that
    //     the transferred value is conserved without revealing any amounts.
    //     NOT done via the BN254 ecAdd precompile (Baby Jubjub ≠ BN254 G1).
    // -----------------------------------------------------------------------
    component balanceCheck = BabyAdd();
    balanceCheck.x1 <== pedersenOut1.out_x;
    balanceCheck.y1 <== pedersenOut1.out_y;
    balanceCheck.x2 <== pedersenOut2.out_x;
    balanceCheck.y2 <== pedersenOut2.out_y;

    pedersenIn.out_x === balanceCheck.xout;
    pedersenIn.out_y === balanceCheck.yout;
}

component main {public [
    merkle_root,
    nullifier_hash,
    new_commitment_1,
    new_commitment_2
]} = PrivateTransfer(20);
