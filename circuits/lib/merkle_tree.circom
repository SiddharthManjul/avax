pragma circom 2.2.2;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/mux1.circom";

// Verifies a Merkle inclusion proof against a known root.
// Depth: 20 levels, Poseidon(t=3) for internal nodes.
template MerkleTreeInclusionProof(depth) {
    signal input leaf;
    signal input leaf_index;
    signal input path_elements[depth];  // sibling hashes
    signal input path_indices[depth];   // 0 = left, 1 = right

    signal output root;

    component hashers[depth];
    component mux[depth];

    signal levelHash[depth + 1];
    levelHash[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        path_indices[i] * (path_indices[i] - 1) === 0; // must be 0 or 1

        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== levelHash[i];
        mux[i].c[0][1] <== path_elements[i];
        mux[i].c[1][0] <== path_elements[i];
        mux[i].c[1][1] <== levelHash[i];
        mux[i].s <== path_indices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        levelHash[i + 1] <== hashers[i].out;
    }

    root <== levelHash[depth];
}
