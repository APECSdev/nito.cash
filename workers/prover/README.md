# Sansbank DAO — Shielded Prover Service (`wasm-prover`)

**Repository:** `sansbankdao/wasm-prover` (**PRIVATE**). Deployed as the
Cloudflare Worker **`wasm-prover`** at **`https://prover.sansbank.dev`**.

Extracted from `dashpoint-api/apps/prover` with history preserved. The old
`dashpoint-prover` Worker was **retired**; this is the only prover.

This service is **DAO-wide**: it serves all of Sansbank DAO. It was NOT named
`dashpoint-prover` for that reason. The name is wide; the interface is not — the
ABI below is Dash/Orchard-specific, and it should only be generalized when a
second real circuit needs it.

## What this is

`shield_from_asset_lock` moves funds from an L1 (Dash Core) asset lock into the
L2 (Dash Platform) **shielded** pool. Producing the transition requires a Halo 2
zero-knowledge proof over Orchard. That proof is the only thing this service
does on the shield path.

On the **spend path** (`POST /prove/pczt`, D1 of the EvoNext spend-proof work,
`docs/reply-evonext-spend-proofs-v2.md`), the service is a pure **PCZT
Prover**: the browser builds and signs the PCZT
(`build_for_pczt` → `Action::sign` → `finalize_io`, all pre-send) and this
service runs only `create_proof` over it — no sighash computation, no
signatures, no spend-capable secret in either direction. The three spend
transitions (shielded transfer / unshield / withdrawal) all ride this one
endpoint; the transition-type split lives in the client's builder choice.

The browser keeps the asset-lock private key and assembles and broadcasts the
final state transition. The server never sees `ask` (the spend authorizing key)
or any other spend-capable secret, and never broadcasts. On the shield path it
receives public inputs only; on the spend path it necessarily receives circuit
witnesses — per action, `fvk` (which contains `nk`), note plaintexts, the
Merkle witness, `alpha`, and `rcv` — because the fork prover requires exactly
that (`pczt/prover.rs:60-77`, including `MissingValueCommitTrapdoor`, so `rcv`
cannot be stripped). The implications are documented in
`docs/design-pczt-wire-format.md` §8: `nk` lets the server link future
nullifiers of notes it can see; `rcv` lets it derive `bsk`; neither lets it
sign a spend (`signer::sign` fails closed on `rk` ownership,
`pczt/signer.rs:17-41`).

## Why the server cannot be skipped

From `platform/packages/rs-dpp/src/shielded/builder/mod.rs:190`
(`build_output_only_bundle`) and `:320` (`prove_and_sign_bundle`), the shield path
needs `ProvingKey::build()` from `grovedb_commitment_tree` (the `orchard` fork
`dashpay/orchard`, tag `dashified-0.14.1`). `ProvingKey::build()` runs `Params::new(K)`
+ `keygen_pk` with `K = 11`
(`orchard/src/circuit.rs:75`); there are **no bundled parameters**.

The proof cannot be produced in the browser: no wasm crate enables
`dpp/shielded-client`, and `halo2_proofs-0.3.5/src/multicore.rs:5-13` is a literal
`compile_error!` on `wasm32` without atomics. A server is required.

Precisely where the browser fails, in three separable layers:

1. **Build configuration — fixable.** The browser SDK never asks for the prover.
   `platform/packages/wasm-sdk/Cargo.toml:58-61` depends on the Rust SDK as
   `dash-sdk = { ..., features = ["serde", "core_key_wallet"], default-features = false }`;
   `shielded` is absent, and the `default` list at `:12-19` contains no `shielded`.
   The chain is therefore `wasm-sdk` → no `grovedb-commitment-tree` → no `orchard`
   (`Cargo.lock:3043` lists `orchard` under `grovedb-commitment-tree`). This is a
   feature flag, not a wall.
2. **`multicore` — already defeated.** The `compile_error!` above is why
   `Cargo.toml` here sets `default-features = false, features = ["circuit"]`.
   A browser build would use the same single-threaded workaround.
3. **Budget — the real blocker, and the browser is the WORSE host.** The code is
   portable; the constraint is the host's memory ceiling. This wasm declares
   **no maximum memory** (section flags `0x00`: min 22 pages, no max), so growth
   is bounded by the host, not by the module. Against the Worker's hard 128 MB we
   **measured 99.88 MB peak at the smallest useful bundle (2 actions)** and a
   **hard failure at 7 actions** (`error code: 1102`). A browser tab exposes an
   *unspecified*, browser- and device-dependent ceiling that is plausibly smaller
   on mobile, and it fails by freezing or killing the tab rather than returning a
   status code. So a browser prover would fail at or before the Worker's limit,
   not after it.

What this does NOT claim: the prover has never been run in a browser, and no
browser memory figure was measured. Layer 1 is verified configuration; layer 3 is
a resource argument built from the Worker measurements.

Upstream reaches the same conclusion by a different route: neither iOS nor Dash
Evo Tool ships a JS prover. iOS compiles the Rust SDK with `--features shielded`
into a native arm64 static library
(`platform/packages/swift-sdk/build_ios.sh:221-226`, targets `aarch64-apple-ios`,
`aarch64-apple-ios-sim`, `aarch64-apple-darwin` at `:234,249,264`), and DET calls
the Rust wallet directly. Both prove on-device with a real allocator and threads.

## Where it runs: Cloudflare Workers, Workers Paid

Deployed as **`wasm-prover`** → `https://prover.sansbank.dev`.
Worker startup **13-16 ms**; upload **1.56 MiB** (617 KiB gzip).

### Measured in production, on real Cloudflare

A real proof was generated by the live Worker and then verified through the
SAME code path consensus runs — see "Verification" below.

| Measurement | Value |
|---|---|
| Proof generated | **yes** — `proofLen: 7264`, 2 actions, 64-byte binding signature |
| Wall time, **cold** isolate (pays keygen) | **118 s**, **124 s**, **137 s**, **144 s** |
| Wall time, **warm** isolate (`pkWasCached: true`) | **83 s**, **89 s** |
| Keygen cost | **~30-50 s** |
| Wasm size | **1,571,468 bytes** |
| Peak wasm memory | **99.88 MB** (of the 128 MB limit) |
| Wasm imports | **zero** (instantiates with `{}`) |

### Isolates are reused, but requests are load-balanced across several

This was measured, not assumed, using an `isolateId` label. Four sequential
health checks returned:

```
isolateId=iso-mun0cjyh requestCountInIsolate=2 pkIsCached=true
isolateId=iso-mun0fl8s requestCountInIsolate=1 pkIsCached=false
isolateId=iso-mun0cjyh requestCountInIsolate=4 pkIsCached=true
isolateId=iso-mun0cjyh requestCountInIsolate=5 pkIsCached=true
```

Same isolate id recurring with a rising request count proves **the isolate and
the in-wasm `OnceLock` proving key both survive between requests**. Cloudflare
nonetheless spreads traffic across a small pool, so both cases occur.

`pkIsCached` correlated exactly with how many requests an isolate had already
served: every cold response carried `requestCountInIsolate` 0 or 1, and every
warm response carried 2 or more. So `pkIsCached: false` means "first request to a
fresh isolate", not "caching is broken".

In this session **4 of 17 responses reported `pkIsCached: true`** (the other 13
were cold). Treat "a fresh isolate pays ~30-50 s of keygen" as the normal case
and plan the client timeout for the cold path.

The response `meta.pkWasCached` reports which case a given request hit.

Cloudflare limits (`developers.cloudflare.com/workers/platform/limits/`):
Workers Free = **10 ms** CPU; Workers Paid = **5 min** CPU; memory **128 MB on both**.
`limits.cpu_ms` accepts up to `300000` on Workers Paid.

**Do not run this on the Workers Free plan.** Free gives 10 ms CPU.

## Verification — the bundle passes consensus's own checks

The Worker's output was fed back through the exact verification consensus runs
(`packages/rs-drive-abci/src/execution/validation/state_transition/state_transitions/shielded_common/mod.rs:95-238`):

```
Action::from_parts                       (each action)   OK
Bundle::try_from_parts(Strict)                           OK
bundle_commitment                    4193b4da...e776b3
sighash                              fc971196...626b4d
BatchValidator::validate                                 PASSED
```

`BatchValidator::validate` covers the Halo 2 proof, every spend-auth signature,
and the binding signature. `ProofSizeEnforcement::Strict` additionally rejects a
non-canonical proof length.

This was run both on a locally generated bundle and on one fetched from the
**live production Worker**, with the same result: **BATCH VALIDATION PASSED**.

### The sighash is load-bearing

The binding signature signs
`SHA-256("DashPlatformSighash" || bundle_commitment || extra_data)`
(`platform/packages/rs-dpp/src/shielded/sighash.rs:35`; `extra_data` is empty for
shield). An early probe signed a **zero** sighash. The real one for a
250000-duff bundle is:

```
sighash = fc971196b9f354997e627ffd1cf528a115bbdd0f796a1562ab93ee9317626b4d
```

which differs from `[0u8; 32]`, so the zero-sighash variant would have been
rejected on chain while looking perfectly valid locally. The ordering matters
too: the commitment must be taken from the **unauthorized** bundle, before
`create_proof`.

## Two harness bugs that produced two wrong conclusions

Recorded so they are not rediscovered:

1. **`Date.now()` does not advance during a synchronous workerd loop.** A probe
   using `while (Date.now() - t0 < ms)` spins **forever**; the condition never
   becomes false. Measured `clockAdvancedMs: 0` across 50,000,000 iterations.
   This was misread as "the Worker hangs". Consequence: **never put a clock in a
   busy loop inside workerd**, and treat any `*Ms: 0` field from such a probe as
   meaningless, not as evidence of zero work. Memory deltas and proof length are
   the trustworthy signals. The same effect is visible above: the live Worker
   reports `pkMs: 0` and `buildMs: 0` even though the request demonstrably took
   ~89-144 s. Those two fields are therefore NOT usable for profiling; use wall
   time measured outside the Worker.
2. **`workers.dev` routes do not resolve instantly after deploy.** Hammering a
   freshly deployed Worker ~6 s after `wrangler deploy` yields **error 1042**
   (`HTTP 404`), which looks like a config or auth fault. **Wait ~60 s**, then
   poll, before concluding anything. Error 1042 is not a Cloudflare limit.

## A deploy-blocking constraint

**`crypto.randomUUID()` must not be called in global scope.** workerd rejects the
entire deploy with:

```
Uncaught Error: Disallowed operation called within global scope. ...
  generating random values are not allowed within global scope.
  [code: 10021]
```

The isolate label is therefore derived lazily inside a handler. Any global-scope
I/O, timer, or RNG will block the deploy the same way.

## Protocol

`POST /prove/shield` — request (all public):

```json
{
  "recipient": "<86 hex chars = 43 raw Orchard address bytes>",
  "amount": "100000",
  "memo": "<72 hex chars = 36 bytes, optional>",
  "dummyOutputs": 0
}
```

`recipient` is the **raw** 43 bytes (11-byte diversifier || 32-byte `pk_d`), not
the bech32m string. Decoding bech32m server-side would duplicate logic the
browser and rs-dpp already own, and the raw form is what the circuit consumes.

`GET /health` is deliberately cheap: it reports `sanity`, `pkIsCached`, and the
isolate label WITHOUT building the proving key.

Response is the bundle the browser needs to build the transition — `actions`
(each with `nullifier`, `rk`, `cmx`, `encryptedNote`, `cvNet`, `spendAuthSig`),
`anchor`, `proof`, `bindingSignature`, plus `valueBalance` and `flags`. It is
`OrchardBundleParams` (`platform/packages/rs-dpp/src/shielded/mod.rs:85`) with the
`SerializedBundle` extras (`flags`, `valueBalance`) from
`serialize_authorized_bundle` (`.../builder/mod.rs:108`).

Action layout (408 bytes packed, exposed as named fields):
`nullifier(32) || rk(32) || cmx(32) || encrypted_note(216) || cv_net(32) || spend_auth_sig(64)`,
where `encrypted_note(216) = epk(32) || enc_ciphertext(104) || out_ciphertext(80)`.

`valueBalance` is a **string** because it is an `i64` and exceeds safe-integer
range in general. It is NEGATIVE for a shield (value flowing into the pool).

### JS calling convention

wasm `i64`/`u64` parameters are **`BigInt`** in JavaScript, not `Number`.
Passing a `Number` throws `Cannot convert 100000 to a BigInt`, so `amount` is
passed as `BigInt`. (`usize` parameters, like `prove_pczt`'s length, are
32-bit on wasm32 and therefore `Number`.)

## Protocol — `POST /prove/pczt` (spend path)

Protocol, wire format, error codes, and the full client sequence are specified
in `docs/design-pczt-wire-format.md` and implemented in `src/pczt_wire.rs`.
Summary:

- **Request body:** raw bytes of the wire frame — header (45 B) + action
  blocks (1845 B each) + trailer. Not JSON. Every action must already carry
  its `spend_auth_sig` (the client signs pre-send, including dummies via
  `finalize_io`, which clears `dummy_sk` — so no `dummy_sk` field exists on
  the wire). `bsk` is forbidden (v1): the client re-derives it post-response
  by re-running `finalize_io` over the `rcv` values that DO ride the wire.
- **Response:** JSON `{ response: "<hex of the SAME frame with zkProof set>",
  responseLen, meta: { requestLen, pkWasCached, pkMs, proveMs, ... } }`. The
  frame is byte-identical to the request except for the appended proof.
- **Errors:** the export returns the numeric code from the wire-format table
  (`docs/design-pczt-wire-format.md` §7); the Worker surfaces it as
  `errorCode` plus the human message from `err_ptr`/`err_len` as `detail`.
- The protocol was verified end-to-end natively by
  `fork_round_trip_prove_and_finalize` (`src/pczt_wire.rs`): a real PCZT is
  built, signed, finalized, serialized to wire, proven, re-parsed, and
  finalized again, and the authorized bundle's commitment equals the
  commitment the signatures were made over. Measured: 233-329 s per run,
  dominated by `ProvingKey::build` (K=11) and the Halo 2 prove in
  single-threaded mode.

## Layout

```
wasm-prover/
  Cargo.toml            Rust crate manifest (pins the orchard fork + features)
  package.json          wrangler scripts
  wrangler.jsonc        Worker config: custom domain, limits.cpu_ms, CompiledWasm rule
  README.md             this file
  AGENTS.md             operating rules for this repo
  scripts/build-wasm.sh rebuilds src/orchard.wasm from src/lib.rs
  src/index.js          Worker entry (POST /prove/shield, POST /prove/pczt, GET /health)
  src/lib.rs            the prover: C ABI over orchard
  src/pczt_wire.rs      wire format + PCZT bridge for the spend path (docs/design-pczt-wire-format.md)
  src/orchard.wasm      COMMITTED build artifact (1,642,651 bytes)
```

The wasm is committed so a deploy needs no Rust toolchain. Rebuild with
`pnpm build:wasm` only when `src/lib.rs`, `src/pczt_wire.rs` or `Cargo.toml`
change. Current artifact sha256:
`c3fe244e1391cd4a1133c38f8ffd492bc543d9137237c9bc2ca9e558b39c0e72`.
(Previous: `abe9749ee3c62cc233247cee5e26ed64bf5d6872c08c05f61df7b7b4545d6fc4`
= 1,571,468 bytes, before the PCZT spend path.)

