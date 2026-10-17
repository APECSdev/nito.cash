# Prover — Overview

The **Nito prover** (`@nito.cash/prover`) is a **Halo 2 / Orchard zero-knowledge prover** deployed
as a **Cloudflare Worker** at [`prover.nito.cash`](https://prover.nito.cash).

It is a Rust crate compiled to WASM (`cdylib`), vendored from the Sansbank `wasm-prover` project.
The Worker entry (`src/index.js`) imports the compiled `src/orchard.wasm` as a static module, so
**no Rust toolchain is needed to deploy** — the WASM artifact is committed.

## Layout

```
workers/prover/
  src/index.js      Worker entry (imports src/orchard.wasm as a static module)
  src/lib.rs        Rust crate (cdylib) — the prover
  src/orchard.wasm  Committed build artifact (rebuild via scripts/build-wasm.sh)
  wrangler.jsonc    Worker config (name nito-prover, route prover.nito.cash)
  Cargo.toml        Rust deps (orchard / halo2 fork, getrandom custom, sha2)
```

## Deploy

Deploys run from the **apecsdev VM** (not CI):

```bash
pnpm run prover:deploy   # = bash scripts/deploy-prover.sh
```

The script rsyncs the workspace to the VM, installs only the prover's deps
(`pnpm install --frozen-lockfile --filter @nito.cash/prover`), and runs `wrangler deploy`. The
committed `src/orchard.wasm` means no Rust toolchain is required on the deploy machine.

## Relationship to the PUSD pool

The Orchard prover and the [PUSD shielded pool](/private-payments/overview) are **separate**
zero-knowledge systems. The pool uses a **BN254 Groth16** circuit verified on the BCH VM; the
prover is a **Halo 2 / Orchard** system. They share the goal of bringing private money to Bitcoin
Cash but are independent components.
