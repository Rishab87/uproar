#!/usr/bin/env bash
# Local validator with the UPROAR program preloaded. Ledger lives in .local (gitignored).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
export COPYFILE_DISABLE=1
PROGRAM_ID="$(grep -oE 'declare_id!\("[^"]+' "$ROOT/programs/uproar/src/lib.rs" | cut -d'"' -f2)"
mkdir -p "$ROOT/.local"
exec solana-test-validator \
  --ledger "$ROOT/.local/ledger" \
  --reset \
  --quiet \
  --rpc-port "${UPROAR_RPC_PORT:-8899}" \
  --faucet-port "${UPROAR_FAUCET_PORT:-9900}" \
  --bpf-program "$PROGRAM_ID" "$ROOT/target/deploy/uproar.so"
