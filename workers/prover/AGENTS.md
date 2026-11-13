<!-- workers/prover/AGENTS.md -->

# AGENTS.md — prover

Operating rules for anyone (human or agent) editing, deploying, or extending the
Nito.cash proving service. Read this before touching anything.

## What this package is

A Cloudflare Worker that builds zero-knowledge proofs for Zashi/DashPay shielded
transactions, so light clients can spend from Orchard without shipping a full
proving stack. It lives in the nito.cash monorepo as `workers/prover`
(`@nito.cash/prover`), vendored from the Sansbank `wasm-prover` project (git
history intentionally dropped). Deployed as the Cloudflare Worker
**`nito-prover`** at **`https://prover.nito.cash`** (see `wrangler.jsonc`).

## Scope — the interface is Dash/Orchard-specific

The ABI below is **not** a generic Orchard protocol. It is a specialized
one-purpose-per-call circuit, built for the Zashi/DashPay shielded pool:

- The proof reveals the recipient address's **43-byte raw form**
  (diversifier ‖ pk_d) as public input. A generic Orchard spend reveals nothing
  about the recipient. Supporting the general case requires extra in-circuit
  logic and would balloon the already slow keygen.
- The SIGHASH the sender signs and the proof reproduces has a custom format
  (personalization field, raw address instead of txid/vout, optional
  `evolution_username` — tied to the Evolution username-salt scheme). Not the
  standard Dash SIGHASH.

Do not silently generalize this interface into a multi-purpose proving service.
Generalize only when a second real circuit exists and forces the question; at
that point the caller passes structured action data and the worker builds the
witness. Until then, the caller does the domain-specific work (PCZT extraction,
SIGHASH assembly) and the worker stays thin.

## Hard rules

1. **Never guess.** Every factual claim in docs, PRs, and commit messages must
   be traceable to either (a) a file in this package, or (b) a named external
   source. If you don't know, say so.
2. **The published artifact must match the committed source.** Anyone auditing
   `src/orchard.wasm` must be able to reproduce it from `src/lib.rs` +
   `Cargo.toml` + the pinned toolchain. The build is scripted at
   `scripts/build-wasm.sh` (cargo release build → copy → sha256; no wasm-opt
   step). If you ever add optimization passes, add them to that script.
3. **On every deploy**, record the sha256 of `src/orchard.wasm` in the deploy
   notes and update it in `README.md` if it changed (previous values are in
   `README.md`).
4. **Never commit credentials.** `.dev.vars` stays local; production secrets go
   through `wrangler secret put` or the Cloudflare dashboard. The DASH address
   currently in `src/index.js` is a dev/test placeholder on a test chain —
   do not "fix" it silently; flag it.
5. **This package ships inside the PUBLIC nito.cash repo** — everything
   committed here is published. Rule 4 is therefore absolute.
6. **The WASM artifact is the security boundary.** Never patch `src/orchard.wasm`
   by hand, never commit a WASM built from source that is not also committed,
   never deploy a WASM whose sha256 you have not recorded.
7. **`src/index.js` is hand-written** (Wrangler module syntax, WASM imported as
   a static module per Cloudflare docs). Keep it small and auditable.

## Measured constraints (do not re-derive — trust these numbers)

These come from actually deploying and calling the service. They were
surprising enough to write down:

- **Cold init = 1.7–2.4 s.** Compiling + linking 1.6 MB of WASM. Every fresh
  isolate pays it.
- **First request after init builds the proving key: 30–50 s.** Loaded from
  embedded bytes (`include_bytes!`), no network. Subsequent requests reuse the
  same in-memory key.
- **Actual proving, warm key: 1.5–3 s per action.**
- **`orchard.wasm` upload ships 4.75 MiB gzipped.** Workers Paid asset limit
  is 10 MiB — headroom is fine.
- **Workers Free gives 10 ms CPU** — far too little for the 30–50 s keygen.
  `wrangler.jsonc` ships with `limits.cpu_ms = 300000` **commented out** so
  deploys succeed on the current (Free) plan; restore it once the account is
  on Workers Paid (see the NOTE in `wrangler.jsonc`).

## Deployment

Deploys run from the **`apecsdev` VM** via the repo-root script:

    pnpm prover:deploy        # = bash scripts/deploy-prover.sh
                              # rsyncs to the VM, installs --filter @nito.cash/prover,
                              # runs wrangler deploy there

Requires Cloudflare auth on the VM (`CLOUDFLARE_API_TOKEN` or a prior
`wrangler login`). The committed `src/orchard.wasm` means no Rust toolchain is
needed to deploy. `pnpm deploy` in this directory also works with local CF auth.

`prover.nito.cash` is a `custom_domain` route in the `nito.cash` zone;
Wrangler creates the DNS record and certificate automatically on deploy.

If you change the Rust source, rebuild and re-verify before deploying:

    pnpm build:wasm        # runs scripts/build-wasm.sh: cargo release build,
                           # copies the artifact to src/orchard.wasm, prints sha256
                           # record the sha256 (see hard rule 3)

## Commit style

Match the existing style: short imperative subject, body explaining the *why*
with measurements where relevant. No emoji. No Co-authored-by tags. No
"Generated with" footers.
