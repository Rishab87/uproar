#!/usr/bin/env bash
# Deploys the program to a cluster with the keys in ~/.config/solana/uproar.
#   scripts/deploy-program.sh devnet
#   scripts/deploy-program.sh mainnet-beta   (asks for confirmation; use a verifiable build first)
set -euo pipefail
CLUSTER="${1:?usage: deploy-program.sh devnet|mainnet-beta}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
KEYS="$HOME/.config/solana/uproar"
DEPLOYER="$KEYS/deployer.json"
PROGRAM_KEY="$KEYS/program-keypair.json"
SO="$ROOT/target/deploy/uproar.so"
URL="${RPC_URL:-$CLUSTER}"

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEY")"
DECLARED="$(grep -oE 'declare_id!\("[^"]+' "$ROOT/programs/uproar/src/lib.rs" | cut -d'"' -f2)"
[ "$PROGRAM_ID" = "$DECLARED" ] || { echo "program keypair ($PROGRAM_ID) does not match declare_id ($DECLARED)"; exit 1; }

(cd "$ROOT" && cargo build-sbf -- -p uproar >/dev/null)
SIZE=$(stat -f%z "$SO")
NEED=$(solana rent "$SIZE" -u "$URL" --lamports | awk '{print $NF}' | head -1 || true)
BAL=$(solana balance -u "$URL" -k "$DEPLOYER" --lamports | awk '{print $1}')
echo "program $PROGRAM_ID, $SIZE bytes, deployer $(solana-keygen pubkey "$DEPLOYER") holds $BAL lamports"
echo "rent for the program: $(solana rent "$SIZE" -u "$URL" | tail -1). Deploying needs about twice that while the buffer exists."

if [ "$CLUSTER" = "mainnet-beta" ]; then
  echo "MAINNET. This publishes the program and spends real SOL."
  read -r -p "Type the program id to continue: " CONFIRM
  [ "$CONFIRM" = "$PROGRAM_ID" ] || { echo "cancelled"; exit 1; }
fi

solana program deploy "$SO" \
  --program-id "$PROGRAM_KEY" \
  --keypair "$DEPLOYER" \
  --upgrade-authority "$DEPLOYER" \
  -u "$URL" \
  --max-sign-attempts 30 \
  --with-compute-unit-price 1000
solana program show "$PROGRAM_ID" -u "$URL" -k "$DEPLOYER"
