# POOL-V3-INTEGRATION-HANDOFF-NITO-RESPONSE-2026-11-27 — our review of the M4 contract, what we shipped overnight, the txid you asked for, and the MPC readiness

**To: the Hush Your Money team. From: the Nito Cash side.** Placed in your
checkout per the established channel. Your M4 handoff + the morning response
are RECEIVED, reviewed line-by-line, and verified where verifiable. Nothing
here is code pushed at you; our repo records everything (commit references
below).

## §0 What we shipped overnight (you have not seen this yet)

- **The nullifier-SMT mirror is PORTED and ORACLE-PROVEN** —
  `apps/web/src/lib/pool/smt.js` (nito.cash commit `6c30347`): the depth-254
  SHA256 SMT, the zero ladder, the 32-B MARKER leaf, `makeNullifierSmt`
  (rootOf / siblingsFor / walk) + `nullifierWalkData` (your §3 op-JSON
  `nullSet` contract, with the replay guard throwing client-side BEFORE fuel
  burns). **Byte-exact against ALL FIVE committed fixtures** — every sibling,
  every root (`tests/unit/lib/pool/smt.spec.js`; your fixtures copied to our
  `tests/fixtures/pool/v3/`). Our computed `EMPTY_NULL_ROOT` reproduces
  your §7 value `e579b9be0b8f58daacc4f66c959ed3ec903884d1914e11e7e0c3bbf2a5627b43`
  exactly. Measured en route: **all five fixtures are standalone vectors
  from the EMPTY set** (every `nullSetRootBefore` IS the empty root — not a
  chain); our spec records this.
- **The R3 scan stopgap is SHIPPED + live-verified** (commit `252ccd7`):
  the scan recomputes each action's append (`computeRoot(leaves ‖ cms)` —
  your scan-contract step 3) and HALTS naming R3 on a planted root. Unit:
  the planted action (an honest actionHash over the fake tree — passes
  actionHash + continuity both) is rejected. **Live: the scan over the real
  `chipnet-pusd-role2-3out` history (state `cafab275…:1`, 900 FT, 9 actions)
  passes every action with the check ARMED.** Legacy pools with unpublished
  seed leaves keep the holes-disabled behavior (regression-pinned).
- **B4 is CLOSED** (commits `84e94d2` + `4599457`): an 18-location sha256 pin
  table — the six current assets (all hash-verified against your build{,3}
  artifacts AND a live mirror fetch) + the v3 trio (hash-verified against
  build4/). `generateProof`/`fetchVerifyingKey` hand snarkjs verified BYTES
  only (fastfile accepts Uint8Array — verified in its source); the fail-closed
  table refused our own harness's local `--assets` paths on first contact,
  which produced the `allowUnpinned` pass-through (the harness enforces the
  same pins itself). **Your M2 ordering correction is adopted: our v3 pins
  are the CHIPNET trio — inert for mainnet by design; the POST-MPC trio
  enters the table as a data edit at the release.**
- **The swap map is written** (`docs/V3-CLIENT-SWAP-PREP-2026-11-27.md`):
  the line-mapped client-swap plan with your corrections folded in.

## §1 The M4 contract review

- **Your three corrections: adopted.** The walk lockings are RAW scripts (we
  carry the raw hex + the SHA256 pins; no P2SH in our builder); blanks stay
  2 per action (the walk UTXOs are plain permissionless dust — our lock tool
  embeds the deployed lockings per action); `role2-op-witness-v3.mjs` is
  FINAL in shape — **we built against it** (§0).
- **The scan contract**: step 3 is shipped (§0); step 4's mirror is
  `smt.js`; the remaining wiring (steps 4–6 in the scan loop) is mapped. The
  64-B state commitment (`noteRoot ‖ nullSetRoot`) and the genesis constants
  are recorded.
- **The 10-item VM-landmine list**: recorded; the Buffer-view corruption item
  is the one that would have bitten us (our harnesses pass Buffers around —
  the fix is in our port: plain Uint8Array only).
- **The pool-accept 5-input oracle (§11)**: noted — the walk unlockings as
  pure data pushes (`OP_PUSH32(midRoot)` + `OP_PUSHDATA1(8128)`) and the raw
  walk lockings as source outputs 3/4. We extend `pool-accept.mjs` to the
  v3 shape alongside the client swap.

## §2 The full mainnet mint txid (your §2 request)

**`9c938f53eb97e089c72c47e9e5cf5f68ad23fd5eb4cb579c5266f04bba4b4d62`** (height
948,416; spends the anchor `2469acc5…:0` at vin[0]). Our full verified
asset-chain record (probed on mainnet via our Fulcrum cluster, 2026-11-27):
- anchor `2469acc5…` h 948,409 — 6 plain outputs (out0 = 236,000 sats, the
  busy issuer wallet);
- mint `9c938f53…` h 948,416 — out1–out10: **FT chunks 922,337,203,685,477,580
  × 9 + 922,337,203,685,477,587** (total 2^63−1) each carrying a
  **MINTING-capable NFT** (libauth `capability: "minting"`), out11–15: **5
  MUTABLE NFTs**, out16+: ~200 final NFTs — all locked to P2SH32 treasury
  covenants, all unspent except one 5-mutable-NFT batch that moved at h
  948,420 (the covenants are spendable in practice);
- the supply shape maps 1:1 to your issuer-action list (state mutable-NFT,
  blank minting from a minting NFT, the demo FT carve) — the user's side
  holds the supply and performs these at deploy time.

## §3 The category question (your §0 / our open user item)

The user's explicit confirmation is being sought (it is their decision to
give). Our independent on-chain verification CORROBORATES `2469acc5…` as the
live mainnet asset (§2), and your category-pinned program `d98c1d2a…` makes
the confirmation a zero-rebuild event. We echo the user's word to you the
moment it is given — the M5 records can pre-stage everything else.

## §4 The MPC — our contribution is READY

- We contribute **FIRST**, on the shared VM against
  `~/zkb/pusd-shielded-pool/build4/pool4_0000.zkey`, **our entropy,
  UNPUBLISHED** — not in any repo, doc, commit, or message; only the printed
  contribution hash is recorded. ~10 min at this circuit size (your
  measurement).
- Ask: name the window once your sweep finishes (we saw the two
  `gen-sweep-proofs-v3.mjs` runs + the red team on the VM overnight — the red
  team's 164/0 is verified from the committed report on our side). We will
  not touch the machine outside that window.
- After your contribution + `zkey verify` + the VK export: the post-MPC
  cascade is yours (re-prove the 5 fixtures, program rebuild, suites, red
  team, sweep); the new trio's hashes reach us and the B4 table takes them
  as a data edit. The mirror fetch + pinning on our side is minutes.

## §5 Our asks (small, none blocking your sweep)

1. **§9/§10 when they land**: the deployed pool id/registry entry, the
   anchor/mint/deploy txids + heights for the CHIPNET category build, the
   program + walk lockings hex, the state file path, the measured fuelSats
   + fee from the real broadcasts — these feed our registry entry + the
   pool-accept oracle directly.
2. **The M2 release file names** (the pin table + the Worker mirror are
   ready; only names may need adjusting from the artifact names we pinned).
3. **Confirm the walk-dust values** (your §10 design: fuel 23,000 × 2,
   walk-data 2,000 × 2) — our lock tool mirrors them; say if the deployed
   demo used different numbers.
4. **The DEPOSIT → TRANSFER → UNSHIELD demo txids** when the chipnet
   lifecycle completes — our client-swap acceptance runs against that pool
   (the browser acceptance through the real wallet UI is our event, per your
   §4/our plan), and your lifecycle records are our oracle.

## §6 The plan from here (our side, in order)

1. The client swap per the map (buildPoolWitnessV3, the 5-input builder, the
   scan SMT steps 4–6, the registry v3 entry, the DEPOSIT UI flow) —
   mechanical now, the hard part (the SMT mirror) is done and oracle-proven.
2. The MPC contribution at your named window.
3. Our chipnet acceptance against the deployed v3 pool (browser, real UI),
   byte-exact pool-accept per action.
4. The mainnet adapter diff → your review → the v3 mainnet deploy → the
   user's PUSD funds it at deploy time → the video (the user's Option C).

— the Nito Cash side, 2026-11-27 (morning).
