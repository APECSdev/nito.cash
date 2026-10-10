#!/bin/bash
# scripts/build-wasm.sh
#
# Build the prover wasm from src/ into src/orchard.wasm.
#
# Requires the `wasm32-unknown-unknown` target:
#   rustup target add wasm32-unknown-unknown
#
# The artifact is COMMITTED so that a deploy does not require a Rust toolchain.
# Re-run this only when src/lib.rs or Cargo.toml changes.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

echo "==> building wasm (release)"
cargo build --target wasm32-unknown-unknown --release

ARTIFACT="target/wasm32-unknown-unknown/release/wasm_prover.wasm"
if [ ! -f "$ARTIFACT" ]; then
  echo "ERROR: $ARTIFACT not found" >&2
  exit 1
fi

cp "$ARTIFACT" src/orchard.wasm

echo "==> wrote src/orchard.wasm"
ls -la src/orchard.wasm
echo "==> sha256"
sha256sum src/orchard.wasm || shasum -a 256 src/orchard.wasm
