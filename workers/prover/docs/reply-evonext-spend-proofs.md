# REPLY — Spend-Proof (Unshield) Support for `wasm-prover`

**To:** evonext.app team (re: `evonapp.app/docs/handoff-wasm-prover-spend-proofs.md`)
**From:** `wasm-prover` team
**Status:** Accepted in principle. Answers below close your questions 1, 3, 5 and
partially 2. **Question 4 (tree/anchor source) is designated the first spike
before any ABI work.**

Every factual claim in this reply is cited to a file and line. Items we could
not verify are explicitly marked **UNVERIFIED**.

---

## 1. Answers to your open questions

### Q1 — `extra_data` for Unshield and ShieldedWithdrawal: ANSWERED

`platform/packages/rs-dpp/src/shielded/sighash.rs` documents all three layouts:

- **shield / shielded_transfer:** `extra_data` is **empty**
  (`sighash.rs:33-34`).
- **ShieldedWithdrawal v0:**
  `output_script || unshielding_amount (u64 LE) || core_fee_per_byte (u32 LE) || pooling (u8)`
  (`sighash.rs:93-105`).
- **Unshield v0:** `output_address || unshielding_amount (u64 LE)`
  (`sighash.rs:134-139`).

Why the layouts matter (same file, `sighash.rs:49-53`): `ShieldedWithdrawal`
has no identity-key signature and no address-witness check, so binding the
transparent fields into the Orchard sighash is what makes the binding signature
authorize them. Both signing and verifying sides must call the same functions
(`sighash.rs:111-113`).

**Roadmap note you missed:** `build_spend_bundle_with`
(`rs-dpp/.../shielded/builder/mod.rs:265-274`) supports an `extra_sighash_data`
closure derived from the **published nullifiers including padding dummies**,
required by `IdentityCreateFromShieldedPool` (identity id =
`double_sha256(sorted published nullifiers)`). None of the three requested
types need it, but any future transition whose extra_data depends on the built
action set must compute it after `Builder::build` and before the sighash — the
machinery already exists (`builder/mod.rs:343-353`).

### Q2 — does `apply_signatures` support a client-supplied signature set? PARTIALLY

No — `apply_signatures` takes `&[SpendAuthorizingKey]`, not signatures
(`orchard fork, src/builder.rs:1135-1153`). **But** it is explicitly a wrapper
over three public steps that do support a split:

- `prepare(rng, sighash)` → `Bundle<InProgress<Proof, PartiallyAuthorized>>`
  (`builder.rs:1105-1109`)
- `sign(rng, ask)` — signs all notes controlled by that key
  (`builder.rs:1154-1165`)
- `finalize()` → `Bundle<Authorized, ...>` — this is where the **binding
  signature** is produced (`builder.rs:1213-1217`)

So a "server proves, client signs" flow is structurally possible. The
remaining unknown, which we will verify during the ABI spike: whether the
`PartiallyAuthorized` state (RedPallas partial-signature internals,
`builder.rs:1072-1093`) can be serialized across a C ABI. **UNVERIFIED.**

One consequence you should factor in now: because `finalize` produces the
binding signature, a split flow means the client does `sign` **and**
`finalize`, so the client needs more than raw signing — it needs to hold the
proven-but-unauthorized bundle state. See §3 on what that implies.

### Q3 — serialization for spend bundles: CONFIRMED, same layout

`serialize_authorized_bundle` (`rs-dpp/.../shielded/builder/mod.rs:108-127`)
emits the identical field set for **every** action, spends and outputs alike:
`nullifier(32) || rk(32) || cmx(32) || encrypted_note(216: epk 32 || enc 104 || out 80) || cv_net(32) || spend_auth_sig(64)`.
There is no spend-only variant that drops `cmx`/`encrypted_note`. Our current
Worker already exposes exactly these named fields plus `flags`, `valueBalance`,
`anchor`, `proof`, `bindingSignature` (our `README.md`, "Protocol" section).

### Q5 — dummy-input strategy: already built into the fork

The fork's `Builder` pads spends/outputs with dummy actions automatically
(`orchard fork src/builder.rs:911-922`), using dummy notes per Zcash spec
§ 4.8.3 (`builder.rs:261-266`), and `rs-dpp` documents that
`BundleType::DEFAULT` pads single-spend bundles with a dummy action
(`rs-dpp/.../builder/mod.rs:268-273`). This is default behaviour we expose, not
a design decision — our current ABI already exposes the analogous
`dummyOutputs` knob for the output path (`src/lib.rs:227-232`).

### Q4 — tree/anchor source: designated first spike, and it is bigger than it looks

Our current shield path hardcodes `Anchor::empty_tree()` with spends disabled —
correct only because funds *enter* the pool (`wasm-prover/src/lib.rs:276-284`).
Every spend path requires a real `Anchor` plus a per-note `MerklePath`
(`rs-dpp/.../builder/mod.rs:69-91`, `SpendableNote`). This means the browser
must maintain a genuine note-commitment tree, which makes Q4 the hardest part
of your D2 — harder than key derivation or note decryption. We propose this be
the first joint spike, before any server ABI work, because its output
determines the D2 packaging decision and the ABI's input format.

---

## 2. Corrections to the handoff

### 2a. The trust-model paragraph (§4) is internally contradictory as written

The handoff states: *"`ak`/`ask` never let it spend (spending requires
`ask`)."* What is true, from source:

- The spend builders take `ask: &SpendAuthorizingKey` directly
  (`rs-dpp/.../builder/unshield.rs:46`, `shielded_transfer.rs:49`,
  `shielded_withdrawal.rs:51`).
- `ask` alone is not sufficient to spend. But **`ask` + note + Merkle path +
  anchor is sufficient** — that is the complete private input set the builders
  take (same signatures).

So the real line is: **the Worker must never receive `ask`.** The
"server signs" variant of Design A hands the Worker spend authority for every
note whose data it sees in flight. Our repository rule 6 ("never holds a
spending key") will be restated in the README with precisely this wording when
the spend ABI lands.

### 2b. UNVERIFIED in the handoff — please send the source

- "Dash coin types: mainnet 5, testnet 1 (`keys.rs:78-81`)" — no `keys.rs`
  exists anywhere under `evonext-mobile` on our side; it presumably lives in
  `platform-wallet-ffi`, which we do not have checked out. Please send the file
  or point us at the repo.
- "each spend action carries both a spend and an output description, so cost
  per action may rise" — in the Orchard circuit every action already carries
  both descriptions structurally; whether *spend* actions measure as more
  expensive is unknown. Agreed to measure; until then, no claim either way.

---

## 3. Position

- **Design A first, client-signing variant only.** The Worker does
  build → commitment → sighash → `create_proof`; the client does
  `sign` + `finalize` per Q2. The `ask`-on-the-wire variant is **rejected**
  (§2a). Practical implication: your D2 must ship the client-side signing step
  from the same crate regardless of packaging option (a) vs (b) — the split
  flow is not optional.
- **ABI shaped for Design B.** Agreed. The same crate already builds
  single-threaded under `wasm32` (our committed `orchard.wasm` is the proof);
  your COOP/COEP headers are confirmed in `evonext.app/public/_headers`. One
  measured-adjacent constraint to plan for, not discover: a synchronous proof
  took **83-144 s wall** on our Worker (README, measured table). In a browser
  that must run in a Web Worker or the tab freezes; your CSP
  (`worker-src 'self' blob:`) permits that.
- On the README's "browser is the worse host": our README already concedes no
  browser figure was measured, and your counter-argument is also unmeasured.
  Neither claim is settled. The single-threaded-first-then-measure plan stands.

## 4. ABI inputs the builders require (drives D1's request format)

From the builder signatures (`rs-dpp/.../builder/{unshield,shielded_transfer,shielded_withdrawal}.rs:40-56`), every spend request must carry, per note:
`Note` + `MerklePath`, and per request: `anchor`, `change_address` (Orchard),
`fvk`, recipient fields, and the transition-specific fields:

- **unshield:** `output_address` (Platform), `unshielding_amount`, memo
- **shielded_transfer:** `recipient` (Orchard), `transfer_amount`, memo
- **shielded_withdrawal:** `output_script`, `core_fee_per_byte`, `pooling`,
  `withdrawal_amount`, memo

Two things worth flagging now:

1. **The unshield fee is not a request parameter.** Consensus charges exactly
   `compute_shielded_unshield_fee` and ignores any surplus
   (`unshield.rs:33-36`); the builders compute fees internally and return the
   applied amount (`-> Result<(StateTransition, Credits), ...>`). Your client
   must not invent a fee field.
2. **BundleType differs from our current path.** Our shield uses
   `BundleType::Transactional` with `SPENDS_DISABLED`
   (`wasm-prover/src/lib.rs:272-277`); the spend builders use
   `BundleType::DEFAULT` with its padding behaviour
   (`rs-dpp/.../builder/mod.rs:280`). The ABI docs will keep these distinct.

## 5. Process commitments (our repository rules)

- Any `src/lib.rs` change ships with a rebuilt, committed `src/orchard.wasm`
  **in the same commit**, plus the new sha256 in the README (repo rules 2-3).
- The rule-6 restatement (§2a) ships in the same commit as the code.
- Your acceptance criteria §5.3-5.4 map onto our README's existing measured
  table and ABI documentation conventions.

## 6. Proposed sequence

1. **Joint spike: Q4.** Determine the note-commitment-tree source and what the
   native path caches between syncs (your Q4), and prototype witness
   construction against `getShieldedPoolState`/`getShieldedAnchors` output.
2. **ABI feasibility check:** serialize `PartiallyAuthorized` across our C ABI,
   or fall back to shipping the signing step in the client artifact (which D2
   requires anyway).
3. **D1 implementation** per §4, with measured memory/time table for the spend
   path (your §5.3).
4. **D2 client artifact** — packaging decision deferred until after the spike,
   per your own framing.
5. **D3 docs/rules update** in the same commit as the code.
