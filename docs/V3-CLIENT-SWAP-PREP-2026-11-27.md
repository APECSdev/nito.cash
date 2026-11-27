# V3-CLIENT-SWAP-PREP-2026-11-27 — what we ported tonight + the line-mapped swap plan

**Purpose:** front-load the Nito client swap so the moment the Hush's full
integration handoff (M4) + proving-assets release (M2) land, the swap is
mechanical. Everything below is verified against their committed sources and
the live VM artifacts (2026-11-27, the overnight session).

## 0. What the Hush shipped that we VERIFIED tonight

- **The v3 chipnet pool is ALREADY DEPLOYED** (M3 in motion ahead of the
  morning deadline): state file `/home/apecs/cov/role2-pool4-state.json`
  (written 2026-11-27T05:14Z) — id `chipnet-role2-pool4-v3`, anchor = category
  `03af2eda…`, mint `934be668…`, deploy `89f0829e…`, **program locking
  `aa207453d271…`** (7,998 B, code sha256 `da484534…`, pieces 4111/3887),
  **walkA 278 B / walkB 291 B lockings IN THE STATE FILE** (hashes
  `81a280e9…` / `6c101864…`), state outpoint `89f0829e…:0`.
- The v3 proving trio, hash-verified against `~/zkb/…/build4/`:
  wasm `a9b4b03d…` (3,641,000 B), zkey `942f8fc5…` (120,818,048 B on disk —
  the handover doc's 104,040,332-B figure disagrees; the HASH is the
  authority), VK `07638f10…`. **The VK note says "CHIPNET-ONLY until the
  mini-MPC settles"** — a mainnet-relevant gate (see §4).
- The 5 v3 proof fixtures (`tests/fixtures/pool/v3/our-v3-proofs.json` in our
  repo, copied from the VM): each record `{ label, proof, publicSignals,
  covenant, nullSet }`; every `nullSet.nullSetRootBefore` IS the EMPTY root
  (the fixtures are standalone vectors from the empty set, NOT a chain —
  measured).
- Their red team (M1) ran to completion on the VM overnight
  (`pool-redteam-v3.mjs` → `pool-redteam-v3-report.json`); the sweep-fixture
  generators were still running at session end.

## 1. DONE tonight (this commit)

- **`src/lib/pool/smt.js`** — the nullifier-SMT mirror, ported from their
  `role2-op-witness-v3.mjs` makeSmt: depth-254 SHA256 SMT, the zero ladder,
  the 32-B MARKER leaf, `makeNullifierSmt` (rootOf / siblingsFor / walk) +
  `nullifierWalkData` (the per-action sibsA/midRoot/sibsB/finalNullRoot
  contract with the replay guard throwing client-side BEFORE fuel burns).
  **Oracle-proven: reproduces ALL 5 committed fixtures' walk records
  BYTE-EXACT** (`tests/unit/lib/pool-smt.spec.js`, 5/5).
- **`prover.js`** — the v3 (pool4) trio added to the B4 pin table (18
  locations now; the v3 constants inert until the v3 registry entry lands;
  mirror filenames follow the M2 release, adjust then if the names differ).
- The fixtures copied into `tests/fixtures/pool/v3/`.

## 2. The swap map (file by file, at handoff)

| File | The v3 change | Source of truth |
|---|---|---|
| `prover.js` | `buildPoolWitnessV3` (pool4): + `isDeposit`, `appendIndex`, `appendSiblings[3][20]` (the DenseAppend frontier paths — the dense-shape assert in JS too), phantom in-notes on deposit (value 0, fresh secrets, membership gated); `nf0 !== nf1` client guard; the 9-field actionHash + 201-B carrier UNCHANGED | `role2-op-witness-v3.mjs` |
| `role2-action.js` | The **5-input** action tx: in3 = walkA dust UTXO at the FIXED deployed walkA locking (unlocking = `midRoot ‖ sibsA`), in4 = walkB (`sibsB`); carrier out0 / state out1 (commitment `newRoot ‖ finalNullRoot`) / payout out2 UNCHANGED | their §3 diagram + `walk-scripts.mjs` |
| `role2-actions.js` | Walk-data plumbing: `nullifierWalkData({ spentKeys, kA, kB })` per action (DONE — smt.js); the spent-set bookkeeping on the store's pool state | smt.js + the op record's `nullSet` |
| `scan.js` | Reconstruct the spent set from observed actions (keys = the carrier nf0/nf1 32-B LE slices), verify each action's walk folds (the records are self-validating); the state commitment's second half = nullSetRoot; the DEPOSIT-action recognition (`isDeposit` in the witness/tx shape). The R3 append check shipped tonight generalizes as-is (genesis EMPTY → the leaf list starts `[]` → check armed from action 0) | smt.js + fixtures |
| `registry.js` | The v3 entry: the DEPLOYED chipnet values are in hand (§0) — locking `aa207453…`, category, walk lockings, genesis root = the EMPTY note tree + `EMPTY_NULL_SET_ROOT` for the null half; TBD at M4: fuelSats (their measured ~47–48k), the vending/guard recipe, `walletProverCompatible` gate | the state file + M4 |
| `store/modules/pool.js` | **DEPOSIT-first-time onboarding** replaces the bootstrap-seed import entirely (no seeds exist); the standing-fuel path stays valid (locks still exist; no bootstrap-TAG locks are possible on v3 — that failure class is gone by construction) | their §3 + our B2 work |
| lock/refill tooling | Two dust UTXOs per action at the fixed walk lockings (permissionless to create — the recipe is an M4 item) | M4 |

## 3. The VM landmines on record (their walk-scripts header)

- `BIN2NUM` of the bare sign byte `[0x80]` decodes as −0 = **zero**;
- `RSHIFTNUM` truncates toward zero for negatives (bit parity flips).
- The v3 walk keys are zero-padded to stay unsigned — our smt.js keys are
  fixed 32-B LE (no bare-byte forms) ✓.

## 4. Open items that MUST come from the Hush (M2/M4/M5)

1. **The proving-assets release (M2)** — the release names + the written
   gate-passed confirmation (the pins are ready; only the mirror filenames
   may need adjusting).
2. **The registry template + fuel economics + the walk-dust recipe + the
   deposit-flow UI contract (M4).**
3. **The valued-asset clearance (M5)** — note their VK record says
   **"CHIPNET-ONLY until the mini-MPC settles"**: a mini-MPC is planned for
   the v3 VK. The user's Option-C order accepts a disclosed non-final pool
   for the mainnet demo — the M5 conversation must settle whether the
   mainnet v3 pool waits for the mini-MPC or ships 1-of-1-disclosed under
   the user's explicit acceptance. **This is the one open decision that can
   move the mainnet date** — ask early.
4. The chipnet demo lifecycle records (DEPOSIT → TRANSFER → UNSHIELD, the
   acceptance target for OUR client swap).
