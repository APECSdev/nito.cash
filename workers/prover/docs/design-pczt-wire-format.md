# DESIGN — PCZT wire format for `/prove` (spend proofs)

**Status:** draft v1 for review (wasm-prover team + evonext.app team)
**Supersedes:** nothing; new. Companion to `docs/reply-evonext-spend-proofs-v2.md` (§3 sketched this; this document pins it).
**Rule:** every width/order below is traceable to the pinned fork
(`dashpay/orchard`, checkout `38ac9c1`) or to this repo's README. Items that are
implementation decisions are marked **DECISION** and pinned by this doc.

---

## 1. Scope

One new wasm export, `prove_pczt(request_ptr: *const u8, request_len: usize) -> u32`,
serves all three spend types (shielded transfer / unshield / withdrawal). The
transition-type split lives in the client's builder choice; the Worker is
transition-agnostic (see reply v2 §3).

The wire format serializes the fork's PCZT structures field-by-field
(`src/pczt.rs:55-296`, `src/pczt/parse.rs`). There is no serde on these types;
both sides speak this format.

## 2. Conventions

1. **Single flat buffer.** Fixed field widths; repeating actions; no pointers,
   no offsets, no TLV. Rationale: our existing C ABI passes fixed-size scalars
   and returns wasm-owned memory via pointer/len accessors (`src/lib.rs`
   exports); the PCZT's optionality is expressed with 1-byte presence flags,
   which keeps the format frame-computable.
2. **All multi-byte integers are little-endian** (matches the sighash
   `extra_data` layouts in `rs-dpp/.../shielded/sighash.rs:93-139`).
3. **Presence flag byte** precedes every optional field: `0x00` = absent,
   `0x01` = present + payload follows. Any other value is a format error.
4. **Memo: `DashMemo` pinned.** `enc_ciphertext` is **104 bytes**
   (36-byte memo; per README's existing action layout). The wasm crate is
   compiled against `M = DashMemo`; a wire format without a memo-size tag is
   therefore unambiguous. If a second memo size ever ships, bump `version`.
5. **Version byte first.** `version = 1`. Any other value → `ERR_VERSION`
   (see §7), never a best-effort parse.

## 3. Request format (v1) — also the response format

The response is the same structure with `zkproof` present (§5). One format,
one parser, one error table.

### 3.0 Byte order at a glance (answering evonext's review question)

The frame is strictly linear — header, then actions, then trailer:

1. **Header (45 bytes, once, before everything):** `version u8`,
   `action_count u16`, `flags u8`, `value_sum` (`magnitude u64` +
   `is_negative u8`), `anchor 32`.
2. **Action array (`action_count` × 1845 bytes):** each action begins with
   `cv_net 32` and `rcv` (flag + 32) — these two are **per-action**, not
   bundle-level — followed by the spend section (1410) and the output
   section (370).
3. **Trailer (≥2 bytes, after all actions):** `zkproof` (flag; when set:
   `u32` length + bytes), then `bsk` (flag, must be 0 in v1).

`zip32_derivation` and `proprietary`: **must be omitted**, not
"accepted-empty." Their flag bytes must be `0x00`; any other value is
rejected with `ERR_FIELD_UNSUPPORTED` (code 5). Rationale: they are unused by
every role this protocol runs, and a mandatory-zero flag keeps the format
forward-compatible (v2 can flip the flag to carry the field without
renumbering anything after it).

### 3.1 Header — 45 bytes

| offset | size | field | source / rule |
|---|---|---|---|
| 0 | 1 | `version` = 1 | §2.5 |
| 1 | 2 | `action_count` (u16 LE) | count of action blocks |
| 3 | 1 | `flags` (bundle flags byte) | `Flags::from_byte` (`pczt/parse.rs:37`) |
| 4 | 8 | `value_sum` magnitude (u64 LE) | `Bundle::parse` takes `(magnitude, is_negative)` (`pczt/parse.rs:29-33`) |
| 12 | 1 | `value_sum.is_negative` (u8: 0 or 1) | same |
| 13 | 32 | `anchor` | `Anchor::from_bytes` (`pczt/parse.rs:35-37`) |

### 3.2 Action block — 1845 bytes, repeated `action_count` times

Field order follows `Action::parse` (fork `pczt/parse.rs:63-99`): the
per-action `cv_net` and `rcv`, then the Spend section, then the Output section.

**Action prefix (65 bytes)**

| size | field | source |
|---|---|---|
| 32 | `cv_net` | `parse.rs:81-83` |
| 1 + 32 | `rcv` (flag + bytes) | `parse.rs:85-91`; **required for proving** (`pczt/prover.rs:73-77`, `MissingValueCommitTrapdoor`) |

**Spend section (1410 bytes)** — field order per `Spend::parse`
(`pczt/parse.rs:105-118`):

| size | field | source / rule |
|---|---|---|
| 32 | `nullifier` | `parse.rs:120-122` |
| 32 | `rk` | `parse.rs:124-125` |
| 1 + 64 | `spend_auth_sig` (flag + sig) | `parse.rs:127` |
| 1 + 43 | `recipient` (flag + bytes) | `parse.rs:129-136`; required for proving (`prover.rs` `MissingRecipient`) |
| 1 + 8 | `value` (flag + u64 LE) | required for proving (`MissingValue`) |
| 1 + 32 | `rho` (flag + bytes) | required for proving (`MissingRho`) |
| 1 + 32 | `rseed` (flag + bytes) | required for proving (`MissingRandomSeed`) |
| 1 + 96 | `fvk` (flag + bytes) | required for proving (`MissingFullViewingKey`) |
| 1 + 4 + 1024 | `witness`: flag + `position` (u32 LE) + 32 × 32-byte path nodes | `parse.rs:114`, `NOTE_COMMITMENT_TREE_DEPTH = 32`; required for proving (`MissingWitness`) |
| 1 + 32 | `alpha` (flag + bytes) | required for proving (`MissingSpendAuthRandomizer`) |
| 1 | `dummy_sk` flag — **must be `0x00` in v1** | `pczt.rs:203-208`; server rejects `1` with `ERR_FIELD_UNSUPPORTED` |
| 1 | `zip32_derivation` flag — **must be `0x00` in v1** | optional in fork; unused by any role we run |
| 1 | `proprietary` flag — **must be `0x00` in v1** | `BTreeMap` field, unused |

**Output section (370 bytes)** — field order per `Output::parse`
(`pczt/parse.rs:214-227`):

| size | field | source / rule |
|---|---|---|
| 32 | `cmx` | `parse.rs:228-230` |
| 32 | `ephemeral_key` | `parse.rs:238-242` |
| 104 | `enc_ciphertext` | `NoteBytes::from_slice` (`parse.rs:232-233`); 104 = DashMemo pin (§2.4) |
| 80 | `out_ciphertext` | `parse.rs:234-237` |
| 1 + 43 | `recipient` (flag + bytes) | required for proving (`MissingRecipient`) |
| 1 + 8 | `value` (flag + u64 LE) | required for proving (`MissingValue`) |
| 1 + 32 | `rseed` (flag + bytes) | required for proving (`MissingRandomSeed`) |
| 1 + 32 | `ock` (flag + bytes) | **optional** even for proving — outputs added with OVK policy "None" legitimately omit it (`pczt.rs:271-276`) |
| 1 | `user_address` flag — **must be `0x00` in v1** | `String` field, unused |
| 1 | `zip32_derivation` flag — **must be `0x00` in v1** | as above |
| 1 | `proprietary` flag — **must be `0x00` in v1** | as above |

### 3.3 Trailer (2 bytes minimum)

| size | field | rule |
|---|---|---|
| 1 | `zkproof` flag; if `1`: u32 LE length + bytes | request: usually absent (client proves server-side); response: always present (§5) |
| 1 | `bsk` flag — **must be `0x00` in v1** | `bsk` is derived by `io_finalizer`, client-side; server never needs it (`pczt/io_finalizer.rs:19-47`) |

### 3.4 Sizing

- Header 45 + action blocks 1845 × N + trailer ≥ 2.
- Example: 1 real spend + 1 dummy + 2 outputs = 2 actions → **3,737 bytes**.
- `action_count` is u16 (fork has no max); practical per-request limits are the
  Worker's memory ceiling, to be measured (handoff v2 §5.4) — the wire format
  does not impose one.

## 4. What the Worker does with the request

1. Parse: `Bundle::parse(actions, flags, value_sum, anchor, zkproof=None, bsk=None)`
   (`pczt/parse.rs:29-56`), with each action via `Action::parse` /
   `Spend::parse` / `Output::parse`.
2. `create_proof(pk, rng)` (`pczt/prover.rs:18-89`) — the only prover role.
3. Serialize the mutated bundle back (public getters, `pczt.rs:55-56`
   `#[getset(get = "pub")]`) with `zkproof` present → response.

The Worker computes **no sighash and no signatures**. The proof binds the
circuit instances built from the parsed fields themselves (`prover.rs:71-89`),
so no additional integrity check is required — a tampered field either changes
what is proven or fails to parse.

**DECISION — required-field policy:** the fork's prover is the authority on
which fields it needs (`ProverError::Missing*`). The server therefore does not
pre-validate presence beyond parsing; missing fields surface as
`ERR_PROVER_*` codes (§7). This keeps the ABI aligned with the fork instead of
duplicating its validation.

## 5. Response format (v1)

Identical to §3 with two differences:

- `zkproof` present (flag `1`, length-prefixed bytes).
- Client then runs, entirely locally and in this order:
  1. `io_finalizer::finalize_io(sighash, rng)` — derives `bsk` from `rcv`s,
     verifies bsk/bvk consistency, signs the dummy spends via `dummy_sk`
     (`io_finalizer.rs:19-58`).
  2. `tx_extractor::extract()` — requires every `spend_auth_sig` present and
     canonical proof size (`tx_extractor.rs:31-60`).
  3. `apply_binding_signature(sighash)` → `Bundle<Authorized>` (`tx_extractor.rs:216-229`).
  4. `serialize_authorized_bundle` (rs-dpp, `builder/mod.rs:108`) → broadcast.

## 6. Protocol sequence (recap from reply v2, with the commitment path pinned)

Client-side, in order — all public APIs, verified:

1. `Builder::build_for_pczt(rng)` → `(pczt::Bundle, BundleMetadata)`
   (`src/builder.rs:743-746`). **Note: this consumes the Builder**, so the
   regular unauthorized bundle is NOT available afterwards.
2. **Commitment path — DECISION:** the client computes the bundle commitment
   from the PCZT itself via `tx_extractor::extract_effects()` →
   `Bundle<EffectsOnly, i64, DashMemo>` → `.commitment()`
   (`tx_extractor.rs:20-26`; `bundle.rs:411-423` states `commitment()` is
   available on any bundle authorization; `bundle.rs:457-465` is the public
   `from_parts` for EffectsOnly). This preserves the consensus-critical
   ordering: commitment → sighash → signature, all before or independent of
   the proof.
3. Platform sighash: `SHA-256("DashPlatformSighash" || commitment || extra_data)`
   with the §2.1 v1-reply layouts (empty for transfer; the documented layouts
   for unshield/withdrawal).
4. Sign real spends: `Action::sign(sighash, ask, rng)` (`pczt/signer.rs:17-41`,
   fail-closed on `rk` mismatch); dummy actions are left unsigned for now.
5. **`io_finalizer::finalize_io(sighash, rng)` — FIRST run, pre-send**
   (`io_finalizer.rs:19-58`): signs the dummy spends using their `dummy_sk`
   (which it then **clears** — `pczt.rs:206`), derives `bsk` from the `rcv`
   sum, and verifies bsk/bvk consistency. After this the client holds no
   `dummy_sk` and every action is signed — which is exactly what the v1 wire
   format assumes (no `dummy_sk` field, all `spend_auth_sig`s present).
6. Serialize to wire (`pczt_to_wire`) → send (§3) → receive response (§5).
7. **`finalize_io(sighash, rng)` — SECOND run, post-response**: `bsk` does not
   ride the wire (forbidden in v1) because it is fully derivable from the
   `rcv` values that DO ride the wire; re-running `finalize_io` recomputes it
   deterministically and verifies bsk/bvk again. Nothing is signed here: every
   `dummy_sk` is `None`, so the loop over actions is a no-op.
8. `tx_extractor::extract()` → requires every `spend_auth_sig` + canonical
   proof size (`tx_extractor.rs:31-60`) → `apply_binding_signature(sighash)`
   → `Bundle<Authorized>` → `serialize_authorized_bundle` → broadcast.

(Was open item 1) The auth-path node order is **leaf-to-root**: `auth_path[0]`
combines at `l = 0`, the leaf layer (`tree.rs:147-160`); the round-trip test
below asserts the commitment survives the wire byte-for-byte.

## 7. Error codes

Returned by `prove_pczt` (u32: 1 = success, otherwise the code). A human
message is available via the existing `err_ptr()`/`err_len()` exports
(`src/lib.rs:142-148`).

| code | name | maps to |
|---|---|---|
| 0 | `ERR_OK` (unused; success returns 1) | — |
| 2 | `ERR_VERSION` | §2.5 |
| 3 | `ERR_TRUNCATED` | buffer shorter than the format requires |
| 4 | `ERR_BAD_FLAG_BYTE` | presence flag ∉ {0,1} |
| 5 | `ERR_FIELD_UNSUPPORTED` | dummy_sk / zip32 / user_address / proprietary / bsk present in v1 |
| 6 | `ERR_EXCESS_BYTES` | trailing bytes after the trailer (frame is exact-length) |
| 7 | `ERR_INVALID_ANCHOR` | `ParseError::InvalidAnchor` |
| 8 | `ERR_INVALID_BSK` | `ParseError::InvalidBindingSignatureSigningKey` |
| 9 | `ERR_INVALID_DUMMY_SK` | `ParseError::InvalidDummySpendingKey` |
| 10 | `ERR_INVALID_ENC_CIPHERTEXT` | `ParseError::InvalidEncCiphertext` |
| 11 | `ERR_INVALID_CMX` | `ParseError::InvalidExtractedNoteCommitment` |
| 12 | `ERR_INVALID_FVK` | `ParseError::InvalidFullViewingKey` |
| 13 | `ERR_INVALID_NULLIFIER` | `ParseError::InvalidNullifier` |
| 14 | `ERR_INVALID_OUT_CIPHERTEXT` | `ParseError::InvalidOutCiphertext` (unreachable via fixed-width wire; kept for 1:1 parity) |
| 15 | `ERR_INVALID_RK` | `ParseError::InvalidRandomizedKey` |
| 16 | `ERR_INVALID_RSEED` | `ParseError::InvalidRandomSeed` |
| 17 | `ERR_INVALID_RECIPIENT` | `ParseError::InvalidRecipient` |
| 18 | `ERR_INVALID_RHO` | `ParseError::InvalidRho` |
| 19 | `ERR_INVALID_ALPHA` | `ParseError::InvalidSpendAuthRandomizer` |
| 20 | `ERR_INVALID_CV_NET` | `ParseError::InvalidValueCommitment` |
| 21 | `ERR_INVALID_RCV` | `ParseError::InvalidValueCommitTrapdoor` |
| 22 | `ERR_INVALID_WITNESS` | `ParseError::InvalidWitness` |
| 23 | `ERR_INVALID_ZIP32` | `ParseError::InvalidZip32Derivation` |
| 24 | `ERR_MISSING_RHO` | `ParseError::MissingRho` (rho required whenever rseed is set) |
| 25 | `ERR_BAD_FLAGS` | `ParseError::UnexpectedFlagBitsSet` |
| 26 | `ERR_BAD_VALUE_SUM` | `ValueSum::from_magnitude_sign` overflow (`bundle.rs` `BalanceError` path) |
| 27 | `ERR_NO_ACTIONS` | empty action list (fork returns `None` bundle) |
| 100-107 | `ERR_PROVER_MISSING_*` | one code per `ProverError::Missing*` variant, in fork enum order: FVK(100), RandomSeed(101), Recipient(102), Rho(103), SpendAuthRandomizer(104), Value(105), ValueCommitTrapdoor(106), Witness(107) |
| 108 | `ERR_PROVER_INVALID_SPEND_NOTE` | `ProverError::InvalidSpendNote` |
| 109 | `ERR_PROVER_INVALID_OUTPUT_NOTE` | `ProverError::InvalidOutputNote` |
| 110 | `ERR_PROVER_RHO_MISMATCH` | `ProverError::RhoMismatch` |
| 111 | `ERR_PROVER_WRONG_FVK` | `ProverError::WrongFvkForNote` |
| 112 | `ERR_PROVER_IDENTITY_RK` | `ProverError::IdentityRk` |
| 113 | `ERR_PROVER_FAILED` | `ProverError::ProofFailed` (Halo 2) |
| 200 | `ERR_PANIC` | `catch_unwind` guard (existing pattern, `src/lib.rs:233-243`) |
| 201 | `ERR_BAD_POINTER` | null pointer / length 0 with content expected |

**RESOLVED (was open item 2):** every `ParseError` variant name is confirmed
against the fork's enum (`pczt/parse.rs:297-341`, 19 variants) and every
`ProverError` variant against `pczt/prover.rs:123-146` (14 variants). Codes
7-25 follow the fork's enum order exactly so the 1:1 mapping is auditable by
reading the two lists side by side. There is no `InvalidOutgoingCipherKey`
variant — the fork wraps `ock` unvalidated — so `ock` has no parse-error code.
**DECISION:** never collapse two fork error variants into one code.

## 8. Security notes (restated for the wire format's consumers)

- The request necessarily carries `fvk` (96 B), note plaintexts (`recipient`,
  `value`, `rho`, `rseed`), `witness`, `alpha`, and `rcv` — all are prover
  requirements (`prover.rs:60-77`). The Worker learns these and nothing
  spend-capable: no `ask` field exists in the format, and `bsk` is forbidden in
  v1 (§3.3).
- `dummy_sk` never crosses the wire; the client strips it after signing, and
  the server rejects it if present (§3.2). The client's own `finalize_io` uses
  its in-memory copy.
- The Signer-rejection rule ("Signers MUST reject PCZTs that contain
  `dummy_sk` values", `pczt.rs:209`) is unaffected: the party that runs
  `finalize_io` (which needs `dummy_sk`) is the same party that stripped it for
  transport.

## 9. Open items

1. ~~**Auth-path node order**~~ **RESOLVED.** `MerklePath::root` indexes the
   auth path with `l = depth-from-leaf` (`orchard fork src/tree.rs:147-160`:
   the fold combines `auth_path[0]` at `l = 0`, the leaf layer). The wire's
   32 × 32-byte array is therefore **leaf-to-root**: `auth_path[0]` is the
   sibling at the leaf layer, `auth_path[31]` the sibling just below the
   root, and `position`'s bit `l` selects the combine side at level `l`.
   The client's `tree.witness()` output (rs-platform-wallet
   `file_store.rs:578-594`) must be stored in this order; its spike already
   exercises this path natively.
2. ~~**Confirm every `ParseError` variant name**~~ **RESOLVED** — see the
   note after the §7 table.
3. ~~evonext review of the §3 layout~~ **ANSWERED** (their reply-to-prover-v2):
   protocol accepted in full; the byte-order clarification is §3.0 above and
   `zip32_derivation`/`proprietary` must be **omitted** (mandatory-zero flag),
   not accepted-empty.
4. The Worker route name: proposal `POST /prove/pczt`, mirroring
   `POST /prove/shield`.
5. **Implementation next step:** convert `WireAction`/`WireSpend`/`WireOutput`
   to the fork's `pczt` types via `Bundle::parse`/`Action::parse`/
   `Spend::parse`/`Output::parse` (all signatures confirmed), wire the
   `prove_pczt` export, and add the fork round-trip test asserted on
   `MerklePath::root()` equality. Repo rules 2-3: that commit must include the
   rebuilt `src/orchard.wasm` and its new sha256.
