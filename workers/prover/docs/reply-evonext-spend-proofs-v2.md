# REPLY v2 — Spend-Proof (Unshield) Support for `wasm-prover`

**To:** evonext.app team (re: handoff v2, 2026-10-04)
**From:** `wasm-prover` team
**Supersedes:** `docs/reply-evonext-spend-proofs.md` (v1) — v1's answers to
Q1/Q3/Q5 and the fee ruling stand; this reply **closes Q2**, which v1 left
partially open.

Every claim is cited. Items we could not verify are marked **UNVERIFIED**.

**Companion document:** the byte-level PCZT wire format for the `prove_pczt`
export is drafted at
`docs/design-pczt-wire-format.md` — field widths, framing, error
codes, and the protocol sequence in reviewable form. Review it alongside §3
below.

---

## 1. Q2 — CLOSED. The fork already ships the split-party machinery: PCZT

v1 answered Q2 with "prepare/sign/finalize exist; serializability of
`PartiallyAuthorized` across a C ABI is the remaining unknown." That framing is
retracted: reconstruction is **impossible** with public APIs
(`from_parts_unchecked` is `pub(crate)`, `orchard fork src/bundle.rs:221-236`).
But the fork has a better path we had not examined: a complete **PCZT role
pipeline**, and PCZT state is plain byte fields — serializable by design.

### What exists (all in the pinned fork, `dashpay/orchard` `38ac9c1`)

- `Builder::build_for_pczt` — extracts a PCZT bundle with all private fields
  intact (`src/builder.rs:745`, `:495-502`).
- `pczt::prover::create_proof(pk, rng)` — proves from PCZT fields
  (`src/pczt/prover.rs:18-89`).
- `pczt::signer::sign(sighash, ask, rng)` — signs a spend with `ask` +
  per-action `alpha`; **fails closed** if the provided `ask` does not own the
  action's `rk` (`src/pczt/signer.rs:17-41`, `WrongSpendAuthorizingKey`).
- `pczt::signer::apply_signature(sighash, sig)` — accepts an externally
  computed signature, verified against `rk` (`src/pczt/signer.rs:44-52`).
- `pczt::io_finalizer::finalize_io` — derives `bsk` from the per-action `rcv`
  values and **verifies bsk/bvk consistency** before setting it
  (`src/pczt/io_finalizer.rs:19-47`).
- `pczt::tx_extractor::extract` — requires proof + every action's
  `spend_auth_sig` (`MissingSpendAuthSig` otherwise), rejects non-canonical
  proof size on the way in (`src/pczt/tx_extractor.rs:31-60`).
- `pczt::tx_extractor::apply_binding_signature(sighash)` — produces the final
  `Bundle<Authorized>` (`src/pczt/tx_extractor.rs:216-229`).

### Protocol we will implement (single server round trip, `ask` never crosses)

1. **Client:** `Builder::build` (keeps the unauthorized bundle) →
   `build_for_pczt` → compute the **platform sighash locally** (it already
   holds the unauthorized bundle, so it can take `commitment()` — the same
   ordering rule as our shield path) → sign its real spends with
   `signer.sign(sighash, ask)` and the dummy spends with the PCZT-carried
   `dummy_sk` (`Spend::parse` field, `src/pczt/parse.rs:117`) → send the PCZT.
2. **Worker:** parse the PCZT (`parse.rs:29-98`, plain byte fields) →
   `create_proof(pk)` → return the PCZT with `zkproof` set. The Worker's only
   role is **prover** — exactly our current product shape.
3. **Client:** `io_finalizer.finalize_io` → `tx_extractor.extract` →
   `apply_binding_signature` → `serialize_authorized_bundle` → broadcast.

One HTTP request, stateless, no server-held intermediate state. (A two-request
variant with server-side finalization is also possible and equally stateless —
the server necessarily receives `rcv` per action, see §2 — but we prefer the
client-finalizes shape: the server never touches signatures at all.)

### Two handoff corrections, for the record

- Handoff v2 §2.2 describes `prepare` as "builds the unauthorized bundle,
  returns the commitment/sighash inputs". Actually `Builder::build` happens
  first and separately; `prepare` "loads the sighash into this bundle" of an
  **already-proven** bundle and computes the binding signature in the same step
  (`src/builder.rs:1101-1128`). The prepare/sign/finalize path is also moot now
  (see §1 opening).
- §2.2's fallback ("client sends pre-computed spend-auth sigs and the server
  completes binding") is exactly `apply_signature` + `apply_binding_signature`
  — both exist and both fail closed. We will not need it under the protocol
  above, but it is available.

## 2. Trust model, stated precisely (this is the D3 wording)

The prover **must** receive, per PCZT action: `fvk` (96 B), `recipient`,
`value`, `rho`, `rseed`, `witness` (position + 32 × 32-byte path), `alpha`,
and `rcv` — all are `ProverError` requirements in `create_proof`
(`src/pczt/prover.rs:60-77`, including `MissingValueCommitTrapdoor`, so `rcv`
cannot be stripped). The Worker therefore learns:

- full note plaintexts of spent notes (value, rho, rseed, recipient),
- the witness positions and paths,
- `fvk` — which contains `nk` (nullifier-linkage class of risk, as your v1 §4
  already stated) —
- and `rcv` values, from which `bsk` is derivable (`io_finalizer.rs:34`).

It does **NOT** receive `ask`. `fvk` does not contain `ask`
(`FullViewingKey` is ak/nk/ovk class material), and without `ask` the Worker
cannot sign a spend — `signer.sign` fails closed on wrong ownership, and
`apply_signature` verifies against `rk`. Our repo rule 6 restatement will read:
*"the Worker never receives `ask` (or any spend-capable secret); it receives
circuit witnesses, including note plaintexts and fvk, for the proving request
only."*

## 3. What this means for the ABI (D1)

- **Wire format:** the PCZT fields, serialized field-by-field over our C ABI.
  All widths are fixed and confirmed in `Spend::parse` (`parse.rs:105-118`):
  `nullifier 32 || rk 32 || spend_auth_sig opt-64 || recipient opt-43 ||
  value opt-u64 || rho 32 || rseed 32 || fvk 96 || witness (u32, 32×32) ||
  alpha 32 || dummy_sk opt-32`; output side analogous; bundle-level `cv_net 32,
  flags u8, value_sum (u64+bool), anchor 32, rcv 32`.
- **One export** (`prove_pczt`) rather than three — the transition-type split
  (transfer/unshield/withdraw) lives entirely in the client's builder choice;
  the Worker is transition-agnostic. This also matches repo AGENTS.md: the
  interface stays narrow (one circuit, one prover role).
- Fee ruling from v1 stands: no fee parameter; the client computes the fee the
  way the builders do (`unshield.rs:33-36`).
- The invariants carry over unchanged: build → unauthorized `commitment()` →
  sighash → proof (now in PCZT order); same K=11 key; workerd constraints.

## 4. Your spike — what we verified locally, what we could not

Verified against sources on disk:

- Per-note `nullifier` is served "for Rho derivation in trial decryption"
  (`rs-drive-proof-verifier/src/types.rs`, `ShieldedEncryptedNote` struct
  comment, fields at :831-833 region) ✓
- `ShieldedEncryptedNotes.total_count` exists and is extracted from the same
  proof (`types.rs`, `ShieldedEncryptedNotes` doc comment) ✓
- The 4.1.1 wasm binding drops `total_count`: the JS conversion loop in
  `wasm-sdk/src/queries/shielded.rs:96-105` emits only
  cmx/nullifier/cv_net/encrypted_note ✓ — your D2 gap is real.

**UNVERIFIED — please add the repo or send the files.** `rs-platform-wallet`
(and `platform-wallet-ffi`) are not checked out on our side:

- coin types 5/1 (`keys.rs:23-24,92`)
- the checkpoint-retention and anchor-selection references — note v2 §3.5
  cites `file_store.rs:578-594` while the spike report cites
  `file_store.rs:588-592`; please reconcile
- `operations.rs:1786-1821`
- "`getMostRecentShieldedAnchor()` matches `anchors[0]`"

## 5. Sequence (updated)

1. **ABI wire-format doc** for the PCZT serialization (§3) — small, do first.
2. **Implement** `prove_pczt` in `src/lib.rs` + Worker route; rebuild and
   commit `src/orchard.wasm` **in the same commit** with the new sha256
   (repo rules 2-3).
3. **D2 client artifact** from the same crate: builder + PCZT + signer +
   io_finalizer + tx_extractor + key/note/tree exports (your §3 list is
   consistent with this; add `build_for_pczt` and the PCZT serialize pair to
   it). Packaging option (a) — separate `client.wasm` — now looks structurally
   forced, since the client needs the builder/signer roles and the Worker must
   not serve a prover module to browsers.
4. **Measure** spend-path wall time / memory / action limits (your §5.4).
5. **D3** in the same commit: rule-6 restatement per §2, ABI field tables,
   PCZT wire format, fee-reporting convention.

Acceptance criteria: we accept your v2 list in full, including the sighash unit
tests against the §2.1 layouts — we will mirror
`unshield_extra_sighash_data_v0` / `shielded_withdrawal_extra_sighash_data_v0`
byte-for-byte in those tests.
