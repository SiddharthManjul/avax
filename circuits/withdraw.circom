pragma circom 2.2.2;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/babyjub.circom";
include "lib/merkle_tree.circom";
include "lib/pedersen.circom";
include "lib/nullifier.circom";
include "lib/range_proof.circom";

//
// PrivateWithdraw
//
// Proves a valid exit from the shielded pool:
//   1. Sender owns a note committed in the Merkle tree
//   2. Input Pedersen commitment is correctly formed
//   3. Nullifier is correctly derived (prevents double-spend)
//   4. Amount is conserved: amount_in == amount (public) + change_amount
//   5. Blinding is conserved: blinding_in == change_blinding
//      (withdrawal portion carries zero blinding since the amount is already public)
//   6. Pedersen balance holds IN-CIRCUIT: C_in == C_withdraw + C_change
//   7. Both amounts fit in 64 bits
//   8. Change Pedersen commitment is correctly formed
//   9. Change note commitment is correctly formed
//
// The withdrawal amount is PUBLIC (required to release the correct ERC20 amount).
// The change commitment stays in the pool as a new private note.
// For a full withdrawal (no change): change_amount = 0, change_commitment = 0.
//
// NOTE: Baby Jubjub ≠ BN254 G1. The EVM ecAdd precompile at 0x06 is for
// BN254 G1 ONLY. Balance is verified here inside the circuit via BabyAdd.
//
// Blinding design for withdrawal:
//   C_in      = amount_in    * G + blinding_in    * H
//   C_withdraw = amount      * G + 0              * H  (zero blinding — amount is public)
//   C_change   = change_amount * G + change_blinding * H
//   Balance: C_in = C_withdraw + C_change
//   ⟹ blinding_in = 0 + change_blinding  ⟹  blinding_in === change_blinding
//
// Estimated constraints: ~7,000–8,000
//   Ownership (BabyPbk):           ~700
//   Input PedersenCommit:         ~1,200
//   Note commitment (Poseidon5):    ~250
//   Merkle proof (20 × Poseidon2): ~5,000
//   Nullifier (Poseidon3):          ~250
//   Amount + blinding conservation:   ~2
//   Range proofs (2 × 64-bit):       ~256
//   Withdraw PedersenCommit:        ~400   (64-bit only, zero blinding)
//   Change PedersenCommit:         ~1,200
//   Change note commit (Poseidon5): ~250
//   Balance check (BabyAdd):          ~6
//
template PrivateWithdraw(depth) {

    // -----------------------------------------------------------------------
    // Public inputs (visible on-chain)
    // -----------------------------------------------------------------------
    signal input merkle_root;       // Merkle tree root the proof is against
    signal input nullifier_hash;    // nullifier of the consumed note
    signal input amount;            // withdrawal amount (revealed to release ERC20)
    signal input change_commitment; // change note commitment (0 for full withdrawal)

    // -----------------------------------------------------------------------
    // Private inputs — input note
    // -----------------------------------------------------------------------
    signal input amount_in;             // uint64 total amount in the note
    signal input blinding_in;           // Pedersen blinding factor
    signal input secret;                // 31-byte secret known only to owner
    signal input nullifier_preimage;    // 31-byte value used to derive nullifier
    signal input owner_private_key;     // sender's Baby Jubjub private key
    signal input leaf_index;            // position of note in Merkle tree
    signal input merkle_path[depth];    // sibling hashes along Merkle path
    signal input path_indices[depth];   // 0=left child, 1=right child at each level

    // -----------------------------------------------------------------------
    // Private inputs — change note (remainder after withdrawal)
    // -----------------------------------------------------------------------
    signal input change_amount;              // uint64 remainder (0 for full withdrawal)
    signal input change_blinding;            // Pedersen blinding for change note
    signal input secret_change;              // change note secret
    signal input nullifier_preimage_change;  // change note nullifier preimage
    signal input owner_pk_change_x;          // sender Baby Jubjub pk.x (change owner)

    // -----------------------------------------------------------------------
    // 1. Ownership
    //    ~700 constraints
    // -----------------------------------------------------------------------
    component ownerPk = BabyPbk();
    ownerPk.in <== owner_private_key;

    // -----------------------------------------------------------------------
    // 2. Input Pedersen commitment: C_in = amount_in*G + blinding_in*H
    //    ~1,200 constraints
    // -----------------------------------------------------------------------
    component pedersenIn = PedersenCommit();
    pedersenIn.value   <== amount_in;
    pedersenIn.blinding <== blinding_in;

    // -----------------------------------------------------------------------
    // 3. Note commitment reconstruction + Merkle inclusion proof
    //    note_commitment = Poseidon(C_in.x, C_in.y, secret, nullifier_preimage, owner_pk.x)
    //    ~250 + ~5,000 constraints
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
    //    ~250 constraints
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
    amount_in === amount + change_amount;

    // -----------------------------------------------------------------------
    // 6. Blinding conservation
    //    The withdrawn portion carries zero blinding (amount is already public).
    //    So blinding_in = 0 + change_blinding = change_blinding.
    //    ~1 constraint
    // -----------------------------------------------------------------------
    blinding_in === change_blinding;

    // -----------------------------------------------------------------------
    // 7. Range proofs: both amounts must fit in 64 bits
    //    ~128 constraints each
    // -----------------------------------------------------------------------
    component rangeWithdraw = RangeProof(64);
    rangeWithdraw.value <== amount;

    component rangeChange = RangeProof(64);
    rangeChange.value <== change_amount;

    // -----------------------------------------------------------------------
    // 8. Withdrawal Pedersen commitment: C_withdraw = amount*G + 0*H
    //    Zero blinding because the amount is already public.
    //    Uses only the 64-bit G scalar mul path. ~400 constraints.
    // -----------------------------------------------------------------------
    component bitsW = Num2Bits(64);
    bitsW.in <== amount;

    var Gx = 995203441582195749578291179787384436505546430278305826713579947235728471134;
    var Gy = 5472060717959818805561601436314318772137091100104008585924551046643952123905;

    component mulGW = EscalarMulFix(64, [Gx, Gy]);
    for (var i = 0; i < 64; i++) {
        mulGW.e[i] <== bitsW.out[i];
    }
    // C_withdraw = (mulGW.out[0], mulGW.out[1])
    // (identity added via BabyAdd below, no separate component needed)

    // -----------------------------------------------------------------------
    // 9. Change Pedersen commitment: C_change = change_amount*G + change_blinding*H
    //    ~1,200 constraints
    // -----------------------------------------------------------------------
    component pedersenChange = PedersenCommit();
    pedersenChange.value   <== change_amount;
    pedersenChange.blinding <== change_blinding;

    // -----------------------------------------------------------------------
    // 10. Change note commitment correctness
    //     change_commitment = Poseidon(C_change.x, C_change.y, secret_change,
    //                                  nullifier_preimage_change, owner_pk_change.x)
    //     ~250 constraints
    // -----------------------------------------------------------------------
    component noteChange = Poseidon(5);
    noteChange.inputs[0] <== pedersenChange.out_x;
    noteChange.inputs[1] <== pedersenChange.out_y;
    noteChange.inputs[2] <== secret_change;
    noteChange.inputs[3] <== nullifier_preimage_change;
    noteChange.inputs[4] <== owner_pk_change_x;
    noteChange.out === change_commitment;

    // -----------------------------------------------------------------------
    // 11. In-circuit Pedersen balance check: C_in == C_withdraw + C_change
    //     ~6 constraints
    // -----------------------------------------------------------------------
    component balanceCheck = BabyAdd();
    balanceCheck.x1 <== mulGW.out[0];
    balanceCheck.y1 <== mulGW.out[1];
    balanceCheck.x2 <== pedersenChange.out_x;
    balanceCheck.y2 <== pedersenChange.out_y;

    pedersenIn.out_x === balanceCheck.xout;
    pedersenIn.out_y === balanceCheck.yout;
}

component main {public [
    merkle_root,
    nullifier_hash,
    amount,
    change_commitment
]} = PrivateWithdraw(20);
