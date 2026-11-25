# HANDOFF / REQUEST — role-2 proving assets — nito.cash

**To:** Hush Your Money / APECS Dev (role-2 pool authors)
**From:** nito.cash (APECSdev)
**Date:** 2026-11-25
**Re:** handover of the role-2 tagged-pool proving assets (the web-platform acceptance blocker)

## Why

We are integrating the role-2 tagged pool into the nito.cash web wallet. The pool,
program, guard, vending machine and lifecycle are deployed and confirmed on chipnet
(handoff `POOL-HANDOFF-2026-11-24-NITO-ROLE2-TAGGED.md`). Our wallet does not have the
new proving assets, so it cannot produce a proof and cannot run the acceptance test
(SHIELD → TRANSFER → UNSHIELD from the browser on chipnet).

## What we need

The assets that pair with **your** solo-ceremony VK (`05250429…`), not our committed
PPOT VK (`27f6ea03…`):

| asset | expected sha256 |
|---|---|
| `pool_final.zkey` | `4a4e2543dbe640de7a59e23cc652b89a50034898757efff22242eafec0f7b7c0` |
| `pool.wasm` | `8595b434…` (full hash to be supplied) |
| `verification_key.json` | `05250429…` (full hash to be supplied) |
| circuit source (`pool.circom`) + the exact build recipe | — |
| ceremony transcript / Phase-2 entropy record | — |
| license / redistribution terms | — |

Please also confirm:

1. The zkey/wasm pair is the one used for the live role-2 lifecycle (`9d9aa97a…`,
   `5262417b…`, `e54d19fb…`).
2. The VK is the one embedded in the deployed program (`aa203e40…`, code pin `d71851a1…`).
3. The download location (a URL, or the files attached to the reply). If a GitHub release
   is used, note that release assets send no `Access-Control-Allow-Origin`; we will mirror
   the files through `prover.nito.cash/assets/` with permissive CORS.

## What we will do with them

- Pin the hashes in `src/lib/pool/prover.js` / the registry.
- Replace `PROVING_WASM_URL` / `PROVING_ZKEY_URL` / `VERIFYING_KEY_URL` with the new
  assets (the local-dev paths stay the override).
- Mirror them at `prover.nito.cash/assets/` (CORS `*`, 24 h cache).
- Run the **web-platform chipnet acceptance**: SHIELD → TRANSFER → UNSHIELD from the
  nito.cash browser wallet, with the real witness and the complete program VM-accepted
  before each broadcast.

## Pool facts we are integrating against

- Category: `480e30ff1d3f5f0b6fe9dd2dbe363b1776f61566f29a395628d0b50abd01b9d0`
- Program P2SH32: `aa203e40b64cff154d4b3305e8c8cc4e3174bc595ad74342a8445a9a7798b7be3a2987`
- Minting guard: `aa2066a238ad4109a3093c34fd4cf9b4167b0058375d4ad1c5cc44cd253d3664f0c187`
- Vending machine: `aa206b51396304b3bd4e0e9c254f84d1ee80d83a5c7ccaf3750883d00866480d981287`
  (price 1,000 sats, category-pinned; live record `460a6f2a…` → `bc2c326e…` + `49b184f5…`)
- Genesis root: `551108f63731bcc628dda2697d70219d103a8c1bf203f2d4aaec6bbea5b4510f`
- Shape: 3 inputs (fuel 0, fuel 1, state 2), no signatures; 169-B OP_RETURN carrier;
  deposit tags `SHA256(nf0_LE ‖ nf1_LE)` on both fuel UTXOs; 2 blanks per lock; 15,000
  sats per fuel UTXO (1 sat/B).

## Acceptance

The nito.cash client is the final approval. The role-2 pool is considered working only
after the web-platform chipnet SHIELD → TRANSFER → UNSHIELD run succeeds end-to-end.

— APECSdev / nito.cash
