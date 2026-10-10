#!/usr/bin/env bash
# scripts/deploy-prover.sh
#
# Deploy the ZK prover (workers/prover) to Cloudflare via the `apecsdev` VM.
#
# The VM (ssh alias `apecsdev`, 127.0.0.1:2222, user `apecs`) is the deploy
# host: this script rsyncs the workspace there, installs ONLY the prover's
# deps (wrangler), and runs `wrangler deploy` from workers/prover.
#
# No Rust toolchain step is needed: src/orchard.wasm is committed and rsynced.
#
# AUTH: the VM must have Cloudflare credentials for wrangler, either
#   - CLOUDFLARE_API_TOKEN in the environment, or
#   - a prior `wrangler login` on the VM (~/.wrangler config).
# Without one of these, the remote `wrangler deploy` step fails with an
# authentication error.
set -euo pipefail

REMOTE="apecsdev"
REMOTE_DIR="apps/nito.cash"          # under /home/apecs on the VM

echo "==> [1/3] syncing workspace to ${REMOTE}:~/${REMOTE_DIR}"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' --exclude '**/node_modules' \
  --exclude 'apps/web/dist' --exclude 'apps/web/coverage' \
  --exclude 'workers/prover/target' \
  ./ "${REMOTE}:${REMOTE_DIR}/"

echo "==> [2/3] installing prover deps on ${REMOTE} (frozen lockfile, filtered)"
ssh "${REMOTE}" "bash -lc '
  set -euo pipefail
  source ~/.nvm/nvm.sh >/dev/null 2>&1
  cd ~/${REMOTE_DIR}
  pnpm install --frozen-lockfile --filter @nito.cash/prover
'"

echo "==> [3/3] wrangler deploy on ${REMOTE}"
ssh "${REMOTE}" "bash -lc '
  set -euo pipefail
  source ~/.nvm/nvm.sh >/dev/null 2>&1
  cd ~/${REMOTE_DIR}/workers/prover
  pnpm run deploy
'"

echo "==> done: prover deployed via ${REMOTE}"
