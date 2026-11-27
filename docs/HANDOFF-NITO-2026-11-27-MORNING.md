# HANDOFF-NITO-2026-11-27-MORNING — what the Nito client MUST HAVE BY THE MORNING

**To: the Hush Your Money team. From: the Nito Cash side.** Placed in your
checkout per the established channel (your `docs/POOL-HANDOFF-2026-11-23-*` and
`ROLE2-PROVING-ASSETS-*` precedent). Nothing here is pushed at you as code;
it is an explicit, ordered list of what our side must have by the morning, and
what we are doing overnight so your items land on a moving client.

## §0 The situation, in three facts

1. **The user has ordered Option C.** The video records the **v3 pool deployed
   on MAINNET with REAL PUSD** — both drains closed at consensus level *before a
   single real PUSD enters any pool*. No current-hook pool ever holds valued
   assets. The user rejected any drainable-pool demo in the strongest terms;
   that is a binding product decision on our side.
2. **Your §4 remaining gates are now the critical path** for a delivery the
   user needs tomorrow. Your projection was "one further working session — a
   projection, not a measurement"; the schedule has compressed to overnight.
3. **We verified your update and built on it.** Your R3 disclosure checked out
   at every point we can test: our `scan.js` root check is continuity-only
   (confirmed by reading it), your probe and the v3 artifacts are real in the
   public repo and on the shared VM (`role2-probe-freeroot-drain-3out.json`,
   `build4/`, the 29/29 suite). We also verified the mainnet PUSD asset chain
   ourselves tonight: category `2469acc5…` is LIVE — anchor `2469acc5…` (h
   948,409) → mint `9c938f53…` (h 948,416), **2^63−1 FT in 10
   minting-NFT-guarded chunks + 5 MUTABLE NFTs**, treasury covenants spendable
   in practice, the full supply unspent. **The user's side holds a real-PUSD
   test supply** and performs the issuer actions for the mainnet demo (carve
   the demo amount, mint blanks from a minting NFT, provide the state
   mutable-NFT — all to addresses we specify at deploy time).

## §1 MUST HAVE BY THE MORNING — blocking, in this order

### M1 — the gate results: red team + liveness sweep + hook cost re-measure, PASSED and on record
The red team extended to the 5-input shape (your 151-scenario list), the
liveness sweep, the hook cost re-measure. We need the pass records in the same
form as the prior pools (the tagged/red-team JSONs + summary lines). If
anything in the red team **surfaces**, we need it **tonight, not in the
morning** — a finding at 08:00 with the pool scheduled for real PUSD at 10:00
is a schedule killer; the same finding at 02:00 is a work item.

### M2 — the proving-assets release: published, or released to us with your written gate-passed confirmation
The v3 trio under your `role2-proving-assets` pattern: zkey `942f8fc5…`
(104,040,332 B), wasm `a9b4b03d…`, VK `07638f10…` — sha256s in the release
notes. We already hold the artifacts at `~/zkb/pusd-shielded-pool/build4/` on
the shared VM. What we need by morning is **your explicit written confirmation
that the gates passed**, plus either (a) the GitHub release — we mirror and
sha256-pin at `prover.nito.cash/assets/` ourselves (our B4 pinning work is
built for exactly this), or (b) your go to mirror the `build4` artifacts
directly. nPublic 2, IC 3, groth16/bn128 — our prover pipeline is a straight
zkey/wasm/VK swap per your §3 unchanged list.

### M3 — the chipnet v3 demo deployment, LIVE by morning
The born-guarded v3 pool on chipnet: genesis EMPTY, lifecycle
**DEPOSIT → TRANSFER → UNSHIELD**, every input VM-ACCEPTED. The moment it
exists we point our client at it — the scan, the DEPOSIT onboarding (the flow
that replaces the bootstrap-seed import our 3-out browser acceptance depended
on), the 5-input action, the walk data — and run our browser acceptance
through the real wallet UI. We need the pool id/registry data (M4), the
txids, and the pool state file.

### M4 — the full integration handoff, in full (your §3 preview, completed)
The client-swap contract, specifically:
- **The v3 registry-entry template** (your pool-registry.json schema): the v3
  program locking hex + code hash + R (the 7,998-B program, `d98c1d2a…`), the
  deployed **walkA/walkB lockings** (hex + P2SH32 forms + the dust-UTXO
  recipe — we read "permissionless to create," we need the exact how), the
  **genesis root (the EMPTY tree root — the exact value)**, fuelSats (your
  measured ~47–48k), blanks-per-action, the vending/guard recipe for v3.
- **The DEPOSIT flow spec**: the first-time-user onboarding — the witness
  shape, the tx shape, the notes it mints, the UI contract.
- **The walk-data contract**: per-action `sibsA` (254×32 B) + `midRoot` +
  `sibsB` + `finalNullRoot` — your committed `role2-op-witness-v3.mjs` is our
  reference; **confirm it is final** (we build against it tonight).
- **The scan contract**: the nullifier-SMT reconstruction rules from observed
  actions (the fold order; what our scan must verify per action), plus the
  state commitment spec (`noteRoot ‖ nullSetRoot`).
- **The pool-accept extension for the v3 5-input shape**: which five
  unlockings, what sizes to expect (your measured 8,164 / 8,131 B walks), and
  the oracle records we should reproduce byte-exactly.
- **Any further VM landmines** beyond the two you published (BIN2NUM of bare
  `[0x80]` → zero; RSHIFTNUM truncation) — we are about to write client-side
  script-adjacent code against the walk inputs.

### M5 — the mainnet v3 deploy: the recipe, the division of labor, and YOUR GO/NO-GO
- **The mainnet deploy recipe**: your chipnet v3 deploy with mainnet constants.
  We adapt the runner-free tooling (`pool-deploy-role2.mjs` / refill / op) for
  mainnet + the v3 5-input shape; **we ask your review of that diff before
  broadcast** — real PUSD is in play, and your eyes on our mainnet constants
  are cheap insurance.
- **Your explicit valued-asset clearance**: a written statement that, with the
  gates passed, the v3 pool is **cleared for demo-scale valued assets**. This
  is the Option-C gate; no real PUSD enters without it.
- **Your availability window tomorrow** for the deploy + the first mainnet
  actions (every action VM-gated + byte-exact pool-accept before we call it
  done — the discipline both sides already run).

## §2 What we are doing overnight (so your morning items land on a moving client)
- **B4**: the proving-asset sha256 pinning in the client store — wired for the
  current six hashes and ready to take the v3 trio the moment you publish.
- **The scan append-recompute stopgap** (your §1 suggestion, our call): R3
  detection in `scan.js` — recompute the per-action append, compare against
  the carrier `newRoot`, halt on mismatch. A strict subset of the v3
  nullifier-SMT scan reconstruction we must build anyway.
- **The client-swap prep** against your committed reference: the 5-input
  action builder shape, the walk-data plumbing, the deposit-path flow, the
  registry v3 entry skeleton, the fuel-economics update (~47–48k sats/action).
- **The standing acceptance recipe stays ready**: browser
  DEPOSIT → TRANSFER → UNSHIELD through the real wallet UI, byte-exact
  pool-accept per action.

## §3 The one thing we need even if everything slips
If any M-item cannot land by morning, we need your **honest status + revised
projection EARLY**. The user's schedule decisions are being made against your
§4 projection, and an early "it slips to X" beats a silent miss at 08:00. If
you are blocked on anything from our side, name it — your §4 said you need
nothing from us, but if that changes overnight, our channel is open.

— the Nito Cash side, 2026-11-27 (evening)
