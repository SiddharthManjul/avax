#!/usr/bin/env bash
# =============================================================================
# generate_verifier.sh
#
# Re-generates Solidity verifier contracts from existing .zkey files.
# Use this after re-doing the trusted setup ceremony without re-running
# the full setup_ceremony.sh.
#
# Outputs:
#   src/Groth16VerifierTransfer.sol
#   src/Groth16VerifierWithdraw.sol
#
# Usage:
#   bash scripts/generate_verifier.sh              # regenerate both
#   bash scripts/generate_verifier.sh transfer     # regenerate transfer only
#   bash scripts/generate_verifier.sh withdraw     # regenerate withdraw only
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SETUP_DIR="$ROOT/circuits/trusted_setup"
SRC_DIR="$ROOT/src"

# Ensure bun and npm global bins are in PATH
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:$PATH"

# Resolve snarkjs binary
if command -v snarkjs &>/dev/null; then SNARKJS="snarkjs"
else SNARKJS="npx snarkjs"
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

log() { echo -e "${BOLD}${BLUE}[verifier]${RESET} $*"; }
ok()  { echo -e "${GREEN}  ✓${RESET} $*"; }
die() { echo -e "${RED}[error]${RESET} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Determine which circuits to process
# ---------------------------------------------------------------------------

if [[ $# -gt 0 && "$1" != --* ]]; then
  CIRCUITS=("$1")
else
  CIRCUITS=("transfer" "withdraw")
fi

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

command -v ${SNARKJS%% *} &>/dev/null || die "snarkjs not found.\n  Install via: bun i -g snarkjs  OR  npm install -g snarkjs"

mkdir -p "$SRC_DIR/interfaces"

# ---------------------------------------------------------------------------
# Generate
# ---------------------------------------------------------------------------

log "Generating Solidity verifier(s)..."

for circuit in "${CIRCUITS[@]}"; do
  ZKEY="$SETUP_DIR/${circuit}_final.zkey"
  [[ -f "$ZKEY" ]] || die "Missing zkey: $ZKEY\n  Run setup_ceremony.sh first."

  CAPITAL=$(echo "$circuit" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')
  SOL="$SRC_DIR/Groth16Verifier${CAPITAL}.sol"

  log "  $circuit → $SOL"
  $SNARKJS zkey export solidityverifier "$ZKEY" "$SOL" 2>&1 | tail -2

  # Fix pragma (macOS sed requires empty string after -i)
  sed -i '' 's/pragma solidity .*/pragma solidity ^0.8.20;/' "$SOL"
  # Rename contract to avoid collision (two verifiers, one Solidity project)
  sed -i '' "s/contract Groth16Verifier /contract Groth16Verifier${CAPITAL} /" "$SOL"

  ok "  $SOL (contract: Groth16Verifier${CAPITAL})"
done

echo ""
log "Done. Verifier files written to src/:"
for circuit in "${CIRCUITS[@]}"; do
  CAPITAL=$(echo "$circuit" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')
  echo "    src/Groth16Verifier${CAPITAL}.sol"
done
echo ""
echo "  Rebuild contracts:  forge build"
echo "  Run tests:          forge test"
