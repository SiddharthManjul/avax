#!/usr/bin/env bash
# =============================================================================
# setup_ceremony.sh
#
# ZkToken Trusted Setup Ceremony
# --------------------------------
# Performs the full Groth16 trusted setup for the transfer and withdraw circuits.
#
# Steps:
#   1. Pre-flight checks (snarkjs, node, build artifacts)
#   2. Download Powers of Tau (Hermez bn128 2^15, covers up to 32,768 constraints)
#   3. Phase 2 setup  — transfer circuit  (25,133 non-linear constraints)
#   4. Phase 2 setup  — withdraw circuit  (20,858 non-linear constraints)
#   5. Export verification keys (JSON)
#   6. Generate Solidity verifier contracts → src/
#
# Idempotent: each output file is checked before regenerating. Pass --force to
# unconditionally redo every step.
#
# Usage:
#   bash scripts/setup_ceremony.sh              # normal run
#   bash scripts/setup_ceremony.sh --force      # redo everything
#   bash scripts/setup_ceremony.sh --verbose    # print snarkjs output
#
# IMPORTANT — Production use:
#   This script uses a single-contributor randomness step. For a production
#   deployment you MUST run a proper multi-party computation (MPC) ceremony
#   with multiple independent contributors. See:
#   https://github.com/iden3/snarkjs#7-prepare-phase-2
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CIRCUITS_BUILD="$ROOT/circuits/build"
SETUP_DIR="$ROOT/circuits/trusted_setup"
SRC_DIR="$ROOT/src"

PTAU_FILE="$SETUP_DIR/powersOfTau28_hez_final_15.ptau"
PTAU_URL="https://hermez.s3-eu-west-1.amazonaws.com/powersOfTau28_hez_final_15.ptau"
# Hermez ptau SHA-256 (publicly verifiable):
PTAU_SHA256="d87a5df4f4d8ccf87f4fb5e28f0ab499a1c4dd22bd1e19bad9267f6afa48bbf8"

CIRCUITS=("transfer" "withdraw")

FORCE=false
VERBOSE=false
for arg in "$@"; do
  case "$arg" in
    --force)   FORCE=true ;;
    --verbose) VERBOSE=true ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log()     { echo -e "${BOLD}${BLUE}[setup]${RESET} $*"; }
ok()      { echo -e "${GREEN}  ✓${RESET} $*"; }
skip()    { echo -e "${YELLOW}  →${RESET} $* (already exists, skipping)"; }
warn()    { echo -e "${YELLOW}[warn]${RESET} $*"; }
die()     { echo -e "${RED}[error]${RESET} $*" >&2; exit 1; }

exists_and_nonempty() { [[ -f "$1" && -s "$1" ]]; }

need_step() {
  # Return 0 (run step) if --force or output file doesn't exist
  local outfile="$1"
  if $FORCE; then return 0; fi
  exists_and_nonempty "$outfile" && return 1 || return 0
}

run_snarkjs() {
  if $VERBOSE; then
    npx snarkjs "$@"
  else
    npx snarkjs "$@" 2>&1 | tail -5
  fi
}

verify_sha256() {
  local file="$1" expected="$2"
  if command -v shasum &>/dev/null; then
    local actual; actual=$(shasum -a 256 "$file" | awk '{print $1}')
  elif command -v sha256sum &>/dev/null; then
    local actual; actual=$(sha256sum "$file" | awk '{print $1}')
  else
    warn "sha256 tool not found, skipping ptau integrity check"
    return 0
  fi
  if [[ "$actual" != "$expected" ]]; then
    die "ptau SHA-256 mismatch!\n  Expected: $expected\n  Got:      $actual\nDelete $file and retry."
  fi
  ok "ptau SHA-256 verified"
}

# ---------------------------------------------------------------------------
# 0. Pre-flight checks
# ---------------------------------------------------------------------------

log "Pre-flight checks"

command -v node &>/dev/null  || die "node not found. Install Node.js >= 18."
command -v npx  &>/dev/null  || die "npx not found. Install Node.js >= 18."

# Check snarkjs
if ! npx snarkjs --version &>/dev/null; then
  die "snarkjs not found. Run: npm install -g snarkjs OR add to local package.json."
fi
SNARKJS_VER=$(npx snarkjs --version 2>&1 | head -1)
ok "snarkjs $SNARKJS_VER"

# Check build artifacts exist
for circuit in "${CIRCUITS[@]}"; do
  r1cs="$CIRCUITS_BUILD/$circuit/$circuit.r1cs"
  exists_and_nonempty "$r1cs" \
    || die "Missing compiled circuit: $r1cs\n  Run: node scripts/compile_circuits.js"
  ok "Found $circuit.r1cs"
done

# Create output directories
mkdir -p "$SETUP_DIR"
mkdir -p "$SRC_DIR/interfaces"

echo ""

# ---------------------------------------------------------------------------
# 1. Powers of Tau (Universal, curve-specific, circuit-agnostic)
# ---------------------------------------------------------------------------

log "Step 1 — Powers of Tau (bn128, 2^15)"

if need_step "$PTAU_FILE"; then
  log "Downloading ptau from Hermez (~50 MB)..."
  if command -v curl &>/dev/null; then
    curl -L --progress-bar -o "$PTAU_FILE" "$PTAU_URL"
  elif command -v wget &>/dev/null; then
    wget --show-progress -O "$PTAU_FILE" "$PTAU_URL"
  else
    die "Neither curl nor wget found. Install one and retry."
  fi
  ok "Downloaded: $PTAU_FILE"
else
  skip "$PTAU_FILE"
fi

verify_sha256 "$PTAU_FILE" "$PTAU_SHA256"
echo ""

# ---------------------------------------------------------------------------
# 2 & 3. Phase 2 setup — one per circuit
# ---------------------------------------------------------------------------

for circuit in "${CIRCUITS[@]}"; do
  log "Phase 2 — $circuit circuit"

  R1CS="$CIRCUITS_BUILD/$circuit/$circuit.r1cs"
  ZKEY_0="$SETUP_DIR/${circuit}_0000.zkey"
  ZKEY_FINAL="$SETUP_DIR/${circuit}_final.zkey"
  VKEY="$SETUP_DIR/${circuit}_verification_key.json"

  # --- 2a. Groth16 setup (generates initial zkey from r1cs + ptau) ----------
  if need_step "$ZKEY_0"; then
    log "  groth16 setup → ${circuit}_0000.zkey"
    run_snarkjs groth16 setup "$R1CS" "$PTAU_FILE" "$ZKEY_0"
    ok "  Created ${circuit}_0000.zkey"
  else
    skip "  ${circuit}_0000.zkey"
  fi

  # --- 2b. Contribute randomness (single dev contribution) ------------------
  # In production: replace with multi-party ceremony using:
  #   snarkjs zkey contribute <prev.zkey> <next.zkey> --name="Contributor Name"
  if need_step "$ZKEY_FINAL"; then
    log "  Contributing randomness → ${circuit}_final.zkey"
    # Use /dev/urandom entropy for the contribution
    ENTROPY=$(LC_ALL=C tr -dc 'a-zA-Z0-9' </dev/urandom 2>/dev/null | head -c 64 || true)
    if [[ -z "$ENTROPY" ]]; then
      ENTROPY="zktoken-dev-setup-$(date +%s)-$$"
      warn "Using timestamp entropy (dev only — NOT suitable for production)"
    fi
    echo "$ENTROPY" | npx snarkjs zkey contribute \
      "$ZKEY_0" "$ZKEY_FINAL" \
      --name="zktoken-dev-${circuit}-$(date +%Y%m%d)" \
      -v 2>&1 | (grep -E "(contribution|hash|reading)" || true)
    ok "  Created ${circuit}_final.zkey"
  else
    skip "  ${circuit}_final.zkey"
  fi

  # --- 2c. Verify the final zkey is well-formed ----------------------------
  log "  Verifying ${circuit}_final.zkey..."
  npx snarkjs zkey verify "$R1CS" "$PTAU_FILE" "$ZKEY_FINAL" \
    2>&1 | grep -E "^(ZKey Ok|ZKey ERROR|snarkJS)" | head -3
  ok "  ${circuit}_final.zkey verified"

  # --- 2d. Export verification key -----------------------------------------
  if need_step "$VKEY"; then
    log "  Exporting verification key → ${circuit}_verification_key.json"
    run_snarkjs zkey export verificationkey "$ZKEY_FINAL" "$VKEY"
    ok "  Created ${circuit}_verification_key.json"
  else
    skip "  ${circuit}_verification_key.json"
  fi

  echo ""
done

# ---------------------------------------------------------------------------
# 4. Generate Solidity verifiers
# ---------------------------------------------------------------------------

log "Step 4 — Generating Solidity verifier contracts → src/"

for circuit in "${CIRCUITS[@]}"; do
  ZKEY_FINAL="$SETUP_DIR/${circuit}_final.zkey"
  # Capitalise first letter for Solidity contract name
  CAPITAL="${circuit^}"
  SOL_FILE="$SRC_DIR/Groth16Verifier${CAPITAL}.sol"

  if need_step "$SOL_FILE"; then
    log "  Exporting ${circuit} → $SOL_FILE"
    npx snarkjs zkey export solidityverifier "$ZKEY_FINAL" "$SOL_FILE"

    # Patch the auto-generated pragma to match our foundry.toml Solidity 0.8.24
    sed -i.bak 's/pragma solidity .*/pragma solidity ^0.8.20;/' "$SOL_FILE" && rm -f "${SOL_FILE}.bak"

    # Rename the contract to avoid collision when both are compiled together
    sed -i.bak "s/contract Groth16Verifier /contract Groth16Verifier${CAPITAL} /" "$SOL_FILE" && rm -f "${SOL_FILE}.bak"

    ok "  $SOL_FILE"
  else
    skip "  $SOL_FILE"
  fi
done

echo ""

# ---------------------------------------------------------------------------
# 5. Summary
# ---------------------------------------------------------------------------

echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  Trusted setup complete!${RESET}"
echo -e "${BOLD}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo "  Artifacts:"
for circuit in "${CIRCUITS[@]}"; do
  CAPITAL="${circuit^}"
  echo "    circuits/trusted_setup/${circuit}_final.zkey"
  echo "    circuits/trusted_setup/${circuit}_verification_key.json"
  echo "    src/Groth16Verifier${CAPITAL}.sol"
done
echo ""
echo "  Next steps:"
echo "    1. Review src/Groth16Verifier*.sol (auto-generated)"
echo "    2. Deploy contracts:   forge script script/Deploy.s.sol --rpc-url fuji --broadcast"
echo "    3. Generate proofs:    cd client && npm run prove"
echo ""
echo -e "${YELLOW}  ⚠  PRODUCTION WARNING${RESET}"
echo "     This ceremony used a single contributor. For mainnet deployment,"
echo "     run a proper MPC ceremony with multiple independent contributors."
echo "     See: https://github.com/iden3/snarkjs#7-prepare-phase-2"
echo ""
