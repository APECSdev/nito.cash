# AGENTS.md

Operating rules for this repository. This file is the source of truth for how
work is done here; when it disagrees with a habit, this file wins.

## What this repository is

The Sansbank DAO **proving service**. It produces the Halo 2 zero-knowledge
Orchard proof required by Dash Platform's `ShieldFromAssetLock` transition
(L1 Dash Core asset lock -> L2 shielded pool).

It is deployed as the Cloudflare Worker **`wasm-prover`** at
**`https://prover.sansbank.dev`**.

It was extracted from `dashpoint-api/apps/prover` with history preserved. The old
Worker `dashpoint-prover` was **retired**, not renamed: it no longer exists.
Nothing should point at `dashpoint-prover.sansbank.workers.dev` again.

## Scope — this is DAO-wide, not DashPoint-specific

This service serves **all of Sansbank DAO**. It is named `wasm-prover`, not
`dashpoint-prover`, for that reason. Do not reintroduce a product name.

The current ABI is Dash/Orchard-specific: `build_bundle` takes a 43-byte raw
Orchard recipient and the platform sighash is
`SHA-256("DashPlatformSighash" || bundle_commitment || extra_data)`. **The name is
wide; the interface is not.** Do not claim this proves arbitrary circuits.

Generalize the interface only when a **second real circuit** exists that needs
it. Widening an interface against a single consumer is designing from one data
point.

## Hard rules

1. **Never guess.** Every factual claim in a commit message, a comment, or a doc
   must be traceable to a file, a line, or a measurement. If it cannot be, say
   so rather than asserting it.
2. **The artifact must match its source.** `src/orchard.wasm` is committed and is
   what actually ships. If `src/lib.rs` or `Cargo.toml` changes, **rebuild and
   commit the new artifact in the same commit.** A committed wasm that does not
   correspond to the checked-in Rust is the worst possible state for this repo,
   because the deployed behaviour cannot be derived from the source.
3. **Record the sha256** of `src/orchard.wasm` whenever it changes. The previous
   values are in the git history and in `README.md`.
4. **Do not commit anything from `target/`.** Only `src/orchard.wasm` ships.
5. **This repository is PRIVATE.** It must never be added to a public repo, and
   nothing here may be copied into one. See `README.md`. (Verify visibility with
   a live check rather than assuming; the API returns `404` for a private repo
   the token cannot see, which is easy to misread.)
6. **No secrets.** This service holds the Halo 2 proving key (a public parameter)
   and nothing else. It must never hold a spending key, an asset-lock private
   key, or an API token. If you find yourself adding a `wrangler secret`, stop.
7. **Never load binaries into the context window.** Verify `src/orchard.wasm` by
   size and sha256, never by reading it.

## Measured constraints — do not relearn these the hard way

- **`workerd` disallows `WebAssembly.compile()` at runtime.** The wasm is a
  static `import` so it is linked at deploy time, and it has **zero imports**.
- **`crypto.randomUUID()` must not be called in global scope** — workerd rejects
  the deploy with error `10021`. The isolate label is derived lazily instead.
- **`wasm32-unknown-unknown` has no clock.** `std::time::Instant::now()` panics.
  Timing happens in JavaScript; `Date.now()` does **not** advance during a
  synchronous workerd loop, so never busy-wait on a clock.
- **wasm `i64`/`u64` are `BigInt` in JavaScript.** Passing a `Number` throws.
- **Workers Free gives 10 ms CPU.** This service needs **Workers Paid**
  (`limits.cpu_ms: 300000`). Cold start pays ~30-50 s of proving-key generation.
- **`workers.dev` routes do not resolve instantly after deploy.** Error `1042`
  there is a propagation race, not a fault. Wait ~60 s.
- **Never build the proving key in `/health`.** It is deliberately cheap.

## Deployment

```bash
pnpm install
pnpm deploy        # wrangler deploy
```

Requires Workers **Paid** and the `sansbank.dev` zone in the same Cloudflare
account. `prover.sansbank.dev` is declared as a `custom_domain` route, so
Wrangler creates the DNS record and certificate.

Rebuilding the wasm needs `wasm32-unknown-unknown`:

```bash
rustup target add wasm32-unknown-unknown
pnpm build:wasm
```

## Commit style

Conventional commits with a detailed body: what changed, the root cause where
there was a bug, and which statements are measured versus assumed. Preserve that
distinction explicitly; it is the reason the measurements in `README.md` can be
trusted.
