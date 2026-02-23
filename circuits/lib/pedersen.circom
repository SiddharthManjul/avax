pragma circom 2.2.2;

include "circomlib/circuits/escalarmulfix.circom";
include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/bitify.circom";

//
// PedersenCommitment
//
// Verifies a Pedersen commitment C = v*G + r*H on the Baby Jubjub curve.
//
// Baby Jubjub (twisted Edwards) parameters:
//   a = 168700,  d = 168696
//   base field: BN254 scalar field (p = 21888242...617)
//   subgroup order: 2736030358979909402780800718157159386076813972158567259200215660948447373041
//
// Generator G (from README spec):
//   Gx = 995203441582195749578291179787384436505546430278305826713579947235728471134
//   Gy = 5472060717959818805561601436314318772137091100104008585924551046643952123905
//
// Generator H = HashToCurve("zktoken_pedersen_h"):
//   MUST be computed off-circuit using scripts/gen_h_point.js before compiling.
//   Nobody must know log_G(H). Leave Hx/Hy as 0 until that script is run.
//
// Constraint estimate: ~500-700 per EscalarMulFix + ~1 for BabyAdd = ~1100-1400 total
//
template PedersenCommitment() {
    // --- Private inputs ---
    signal input value;    // v: token amount (64-bit uint)
    signal input blinding; // r: blinding factor (254-bit BN254 scalar)

    // --- Public inputs (commitment point to verify against) ---
    signal input commitment_x;
    signal input commitment_y;

    // --- Baby Jubjub generator G ---
    var Gx = 995203441582195749578291179787384436505546430278305826713579947235728471134;
    var Gy = 5472060717959818805561601436314318772137091100104008585924551046643952123905;

    // --- Baby Jubjub generator H = HashToCurve("zktoken_pedersen_h") ---
    // Derived by scripts/gen_h_point.js (counter=0, SHA-256 try-and-increment + cofactor clearing)
    // On-curve: PASS | Subgroup: PASS | H ≠ G: PASS
    var Hx = 11991158623290214195992298073348058700477835202184614670606597982489144817024;
    var Hy = 21045328185755068580775605509882913360526674377439752325760858626206285218496;

    // --- v * G : 64-bit fixed-base scalar multiplication ---
    // amount is uint64, so 64 bits are sufficient; saves constraints vs 254
    component bitsV = Num2Bits(64);
    bitsV.in <== value;

    component mulG = EscalarMulFix(64, [Gx, Gy]);
    for (var i = 0; i < 64; i++) {
        mulG.e[i] <== bitsV.out[i];
    }

    // --- r * H : 254-bit fixed-base scalar multiplication ---
    // blinding is a full BN254 scalar (up to 254 bits)
    component bitsR = Num2Bits(254);
    bitsR.in <== blinding;

    component mulH = EscalarMulFix(254, [Hx, Hy]);
    for (var i = 0; i < 254; i++) {
        mulH.e[i] <== bitsR.out[i];
    }

    // --- C = v*G + r*H (Baby Jubjub point addition) ---
    component add = BabyAdd();
    add.x1 <== mulG.out[0];
    add.y1 <== mulG.out[1];
    add.x2 <== mulH.out[0];
    add.y2 <== mulH.out[1];

    // --- Enforce computed commitment matches public input ---
    add.xout === commitment_x;
    add.yout === commitment_y;
}
