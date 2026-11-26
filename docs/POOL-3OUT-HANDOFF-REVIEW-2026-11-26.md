# Review — the Hush 3-out handoff + the three commits in our repo (2026-11-26)

**Re:** `hushyourmoney/docs/POOL-HANDOFF-2026-11-26-NITO-3OUT.md` (commit `616cd38`) and the
three commits it discloses in `APECSdev/nito.cash`: `6ea8077`, `c6ad077`, `8c0d941`.

## Verdict

**The commits are ADOPTED — with two store-path fixes applied on our side.** `6ea8077` (the
3-out client path) and `c6ad077` (the mirror) are correct and verified. `8c0d941`'s Wallet
selector and registry data are welcome and correct, but its central claim — the pool-aware
scan — is **not in the code**: the dispatch passes `{ poolId }` and the `scanPool` action
ignores it, so the scan still runs against the 2-out default. A second blocker (the 3-out
leaf assembly) was never touched. Both are fixed here.

## 1. Verified on our side

- `node scripts/pool-accept.mjs --pool role2-3out --txid ec31a41c` on the apecsdev VM:
  **fuel0 9488 B / fuel1 9490 B / state 8821 B, ALL BYTE-EXACT** against the live 3-out
  UNSHIELD. The ported generator (`src/lib/pool/role2-3out/`, 11 files) is faithful.
- The 3-out assets are live on `prover.nito.cash/assets/`: `pool3.wasm` 3,380,815 B,
  `pool3_final.zkey` 98,190,141 B, `verification_key_3out.json` 3,111 B — matching the
  `role2-proving-assets-3out-v1` release (GitHub API) and the handoff's hashes.
- The 2-out path is preserved: the 169-B carrier, the 8-field `actionHash`, the
  `getDefaultPool` order (`chipnet-pusd-role2` first) and the 2-out program constants are
  untouched; the new code is additive (the `role2-3out/` port, the `*_3OUT` constants, the
  `cm2` branches).
- The suite + build: 73 files / 689 tests green, `vite build` clean (our run, their tree).
- The registry's 3-out entry data (category, program, guard, vending, lifecycle notes) is
  consistent with the chain.

## 2. The two bugs (verified)

### 2.1 `scanPool` ignores `{ poolId }` — the handoff's §2.1 describes a fix that is not there

The pushed `store/modules/pool.js`:

- `submitRole2Action` dispatches `dispatch('scanPool', { poolId: pool.id })` (the `8c0d941`
  hunk).
- `async scanPool({ commit, state, dispatch, rootGetters })` — **no payload parameter** —
  and `const pool = getDefaultPool(network)`.

The payload is dropped; the scan always uses `POOLS[networkId][0]` (the 2-out on chipnet).
A 3-out submission would therefore scan the 2-out chain: the wrong state UTXO, the wrong
action chain, the wrong leaves. The handoff's "`scanPool` gains an optional `{ poolId }`
payload … resolves `getPools(network).find(...)`" does not match the pushed code.

### 2.2 `assembleLeaves` is 2-out-only — the 3-out tree throws

`lib/pool/actions.js`:

```js
const total = (pool.genesisLeafCount || genesisLeaves.length) + (scan.actions.length * 2)
...
leaves[base] = action.args.cm0
leaves[base + 1] = action.args.cm1
```

For the 3-out pool (`genesisLeafCount: 2`, 5 actions, bases 2/5/8/11/14) the array is 12
long and the cm2 positions are never written. Verified with the real registry entry: the
call **THROWS** `pool actions: incomplete leaf list`. The commit's "the store 3-out branch
is wired" is true only for the witness/prover branch, not for the tree the witness is built
from.

The tests passed because the store's proving action is `/* v8 ignore start */` (exercised
only by a real acceptance run) and no unit test covered a 3-out tree.

## 3. The fixes (this tree)

- `scanPool` takes `payload = {}` and resolves `payload.poolId` via
  `getPools(network).find(...)`, falling back to `getDefaultPool(network)` (all pre-selector
  callers unchanged).
- `assembleLeaves` detects the 3-out shape (`pool.outputs === 3` or a 201-B carrier in the
  scan) and appends `cm2` at `base + 2`; the total is `genesis + actions × outs`.
- Tests: `pool-store-scan.spec` — the selected-pool payload + the default fallback (the
  registry mock now provides `getPools`); `pool-actions.spec` — the 3-out tree
  (`[7,8,9,10,11]`, cm2 included). **73 files / 692 tests green; build clean.**

## 4. Remaining before the 3-out browser acceptance

1. The temporary `walletProverCompatible: true` on the 3-out entry (local, per the
   established procedure; commit only on pass).
2. The note import (§3 of the handoff — the 7 live notes; `recordNote` honors `leafIndex`).
3. The acceptance run: 3-out v3 selected → SHIELD → TRANSFER → UNSHIELD.
4. On pass: the registry flip; on any fail: no flip.

## 5. The disclosure (R2-NULLIFIER-DOUBLING)

Acknowledged and recorded in the 3-out registry entry: the nullifier fold permits a
demonstrated full-balance drain on both role-2 pools; **no valued asset may enter any
role-2 pool until the v3 nullifier set ships**. The 3-out acceptance is a chipnet demo
run on demo funds, nothing more.
