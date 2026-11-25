<!-- AGENTS.md -->

# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## Project Overview

**Nito.cash** (`package.json` name: `nito.cash`, version `20.4.18`) is a Bitcoin Cash (BCH)
privacy-focused wallet, built as a client-side **Single Page Application (SPA)**. There is no
backend server — the app runs entirely in the browser and talks to the BCH network directly.

- **Repository:** `git@github.com:APECSdev/nito.cash.git`
- **Owner / context:** Submission for the BCH Blaze 2026 hackathon (`https://dorahacks.io/hackathon/bchblaze2026`).
- **Runtime:** Node `v24.18.1` (development/build only; the shipped app is static).

## Tech Stack (current state)

| Concern        | Package / version                          | Notes                                             |
| -------------- | ------------------------------------------ | ------------------------------------------------- |
| Framework      | `vue@3.5.43` (Vue 3)                        | Migrated from Vue 2 (Phase B done).                |
| Build tool     | `vite@8` + `@vitejs/plugin-vue@6`           | **Production build** (replaces webpack/cli-service). Output `apps/web/dist-vite/`. |
| Styling        | `tailwindcss@4` + `@tailwindcss/vite`       | Utility layer; component `<style>` blocks remain until Phase D. |
| State          | `pinia@4.0.3` + `pinia-plugin-persistedstate@4.7.1` | Single store + Vuex-shaped facade (Phase B-half-2). Persisted to cookies (nito)/localStorage. |
| Routing        | `vue-router@4.6.4` (hash mode)              | `createWebHashHistory` — same `#/...` URLs.        |
| i18n           | `vue-i18n@11.4.14` (`legacy: true`)         | Locales in `src/i18n/`.                            |
| Icons          | Global `<svgicon>` plugin (`src/plugins/svgicon.js`) + `src/compiled-icons/` | Replaces `vue-svgicon`; generated files re-pointed via `compiled-icons/register.js`. |
| Errors         | `@sentry/vue@11`                            | GlitchTip (Sentry-protocol) — `src/plugins/glitchtip.js`; tracing at 1%, `attachProps: false` (wallet privacy), BrowserSession integration filtered out. |
| Node polyfill  | `vite-plugin-node-polyfills` + `buffer`     | webpack 4 auto-polyfilled `Buffer`/`process`; Vite needs this for Ledger (+ any Node builtins in blockchain deps). |
| Ledger (HW)    | `@ledgerhq/hw-app-btc@11.6.0`, `@ledgerhq/hw-transport-webusb@6.35.0` | See "Ledger Integration" below. |
| Testing        | **Vitest** `@5.0.4` + `@vue/test-utils@2.5.1` + jsdom | 49 suites / 465 tests; coverage ratchet **89% lines/statements** hard floor (`vitest.config.js:78-81`), 90% TARGET in `codecov.yml` (measured 92.9% after the pool-builder work). Jest + `@vue/cli-plugin-unit-jest` REMOVED (Phase C). |

Full dependency list lives in `package.json`; the authoritative lockfile is `pnpm-lock.yaml`.

## Blockchain Backend — Fulcrum + libauth/scure (Phase F, COMPLETE)

The wallet talks to the BCH network directly (no backend server). The legacy
`window.BITBOX` REST/socket bundle (defunct REST API + `wss://ws.bitcoin.com` socket)
has been **fully removed** — zero `window.BITBOX` usage remains (only doc comments).

| Concern             | Package / module                                    | Notes |
| ------------------- | --------------------------------------------------- | ----- |
| Network provider    | `@electrum-cash/network@4` (Fulcrum/Electrum proto) | `src/lib/bch/provider.js` — `FulcrumCluster`. |
| Keys / HD / signing | `@scure/bip39` + `@scure/bip32` + `@bitauth/libauth` | `src/lib/bch/crypto.js` — all LOCAL. |
| Network defs        | `src/lib/bch/networks.js`                           | mainnet (4 servers/quorum 2) + chipnet (2 servers/quorum 2). |

- **`FulcrumCluster`** connects to ALL of a network's servers and broadcasts every
  request; a response is only accepted once `quorum` servers return an IDENTICAL
  (JSON-serialized) result — no single endpoint is trusted (the user does NOT rely on
  one Fulcrum server). `getCluster(network)` returns a cached, connected cluster.
- **Crypto is local** (never leaves the device): scure bip39 (mnemonic→seed) + bip32
  (`m/44'/145'/0'/0/N`) + libauth (P2PKH CashAddress via `publicKeyToP2pkhCashAddress`,
  Schnorr signing — BIP143-style `SIGHASH_ALL|FORKID`, proven on-chain via a live
  chipnet broadcast). Address parity with bitbox was verified byte-identical (16/16).
- **Chipnet support**: same BCH keys (coin type 145) on both networks; only the
  CashAddress prefix differs (`bitcoincash:` vs `bchtest:`). A Mainnet/Chipnet toggle
  lives in Settings (persisted `profile.net`; full-app reload on switch).
- **Real-time payment notifications** (Receive screen) use server-side-filtered
  `blockchain.address.subscribe` (`blockchain/actions/openConn.js`). The initial-status
  baseline is skipped so Receive doesn't alert on pre-existing history.
- **Fiat ticker** = CoinGecko (`blockchain/getters/getTicker.js`); **explorer** =
  chaingraph.cash. Send path: `wallets/actions/sendCrypto.js` + `getSignedInput.js`.

## Package Management — PNPM ONLY

**This project uses pnpm. Do NOT use npm or yarn.**

- Lockfile: `pnpm-lock.yaml` (committed). There is no `yarn.lock` / `package-lock.json`.
- Install: `pnpm install`
- CI / reproducible install: `pnpm install --frozen-lockfile`
- Add: `pnpm add <pkg>` (runtime) · `pnpm add -D <pkg>` (dev)
- Remove: `pnpm remove <pkg>`
- **Never** hand-edit `pnpm-lock.yaml`. Regenerate it via `pnpm install` after manifest changes.
- A repo-local `.npmrc` sets `blockExoticSubdeps=false` to tolerate a legacy git-based
  transitive dep; leave it in place until the dependency tree is fully modernized.
- `pnpm-workspace.yaml` sets `allowBuilds` (core-js, deasync, ejs, yorkie, esbuild, sharp,
  workerd approved; blake-hash explicitly skipped) so `pnpm install` is deterministic across
  pnpm 10 (warns) and pnpm 11 (errors on ignored build scripts).

### Prune unused dependencies

Remove packages that have **zero** real usage. Before removing, verify with a grep over `src/`
and distinguish *actual imports/calls* from *comment mentions* (e.g. `ipfs`, `moment` were only
referenced in comments and were safe to drop).

## Repository Layout (pnpm monorepo)

This is a pnpm workspace with three packages:

```
apps/
  web/                  @nito.cash/web — the Vue 3 SPA (the Nito.cash wallet), deployed to
                        Cloudflare Pages. All web-app sources/config live here now:
    public/             Static assets + index.html
    src/
      api/              External API helpers (e.g. telr.js)
      assets/           Styles / images
      compiled-icons/   vue-svgicon icon modules (GENERATED — regenerate, don't hand-edit)
      components/       Reusable UI (inputs/, popups/, etc.)
      i18n/             Locale JSON (en-US, de, fr, zh-CN, zh-HK)
      media/            Audio / media assets
      plugins/          Vue plugins (bugsnag.js, i18n.js)
      router/           vue-router routes
      store/            Pinia store (index.js facade + vuex-shim.js) + modules (blockchain,
                        concierge, profile, system, utils, wallets)
      views/            Route-level views (Splash, Setup, Dashboard, Send, Receive, History,
                        Settings, Concierge/*)
      App.vue  main.js
    svg-icons/          Source SVGs for generate-icons
    tests/unit/         Vitest unit tests (41 suites / 373 tests)
    vitest.config.js    Vitest config (jsdom, `@` alias, v8 coverage -> coverage/lcov.info)
    package.json  vite.config.js  vitest.config.js  eslint.config.js
  blaze/                @nito.cash/blaze — the BCH BLAZE 2026 submission page (static
                        index.html + mock deck.html), deployed to Cloudflare Pages as `blaze.nito.cash`.
workers/
  prover/               @nito.cash/prover — Halo 2 / Orchard ZK prover, a Cloudflare Worker
                        (Rust→WASM). Vendored from the Sansbank `wasm-prover` project (history
                        dropped). Deployed to the custom domain `prover.nito.cash`.
    src/index.js        Worker entry (imports src/orchard.wasm as a static module)
    src/lib.rs          Rust crate (cdylib) — the prover
    src/orchard.wasm    Committed build artifact (rebuild via workers/prover/scripts/build-wasm.sh)
    wrangler.jsonc      Worker config (name `nito-prover`, route `prover.nito.cash`)
    Cargo.toml          Rust deps (orchard / halo2 fork, getrandom custom, sha2)
pnpm-workspace.yaml     packages globs + allowBuilds
package.json            private workspace root (delegating scripts via `pnpm --filter`)
scripts/deploy-prover.sh  Deploys workers/prover to Cloudflare via the apecsdev VM
.github/workflows/ci.yml  GitHub Actions CI (build + test + Codecov) and the
                          test-gated Cloudflare Pages deploy (see "CI / CD" below)
```

### Prover deployment (via the apecsdev VM)

Deploys run from the **`apecsdev` VirtualBox VM** (ssh alias `apecsdev` = 127.0.0.1:2222,
user `apecs`; node v24 via nvm, pnpm via corepack). `scripts/deploy-prover.sh` rsyncs the
workspace to `apecsdev:~/apps/nito.cash`, installs only the prover's deps
(`pnpm install --frozen-lockfile --filter @nito.cash/prover`), and runs `wrangler deploy`
there. The committed `workers/prover/src/orchard.wasm` means no Rust toolchain is needed
to deploy. Cloudflare auth on the VM is required (`CLOUDFLARE_API_TOKEN` or a prior
`wrangler login`).

VM resource policy (host has 8 CPUs / 31 GB): **APECS is capped at 4 CPUs / 8 GB RAM**, and
**only ONE VM runs at a time** (the `Sansbank` VM stays powered off while APECS runs, and
vice versa). Do not raise APECS's allocation or run both VMs simultaneously without an
explicit instruction.

### CI / CD (GitHub Actions → Cloudflare Pages)

`.github/workflows/ci.yml` runs on every push to `master` and on PRs, on Node 24 + pnpm 10
(matching Cloudflare's build env). It has two jobs:

1. **`build-test`** — `pnpm install --frozen-lockfile` → `pnpm build` (apps/web) →
   `pnpm test:unit` (Vitest) → upload coverage to **Codecov** (`apps/web/coverage/lcov.info`,
   via `codecov/codecov-action@v4`, secret `CODECOV_TOKEN`) → save `apps/web/dist-vite` as an
   artifact (`web-dist`).
2. **`deploy`** — runs **only** `needs: build-test` succeeds **and** on `push` to `master`
   (PRs never deploy). Downloads `web-dist` and pushes it to Cloudflare Pages **`nitocash`**
   via `cloudflare/wrangler-action@v3` → `wrangler pages deploy dist --project-name=nitocash`
   (**Direct Upload**). Secrets: `CLOUDFLARE_API_TOKEN`; account id `38907316ed118886fa8035039f92056d`.

**Cloudflare Pages does NOT auto-build from git** — the Git integration was disconnected.
Pages only ever receives a pre-built, pre-tested `dist/`, so a failing test or broken build
blocks the deploy. The CF-side "output dir" setting is now moot (Direct Upload bypasses CF's
build config). Production domains `nito.cash` / `www.nito.cash`; deploy previews at
`<hash>.nitocash.pages.dev`.

The **prover Worker** (`workers/prover`) is deployed separately/manually via the `apecsdev` VM
(`pnpm run prover:deploy` = `bash scripts/deploy-prover.sh`), not by this CI workflow.

The **docs site** (`apps/docs`, VitePress, `docs.nito.cash`) was **DEPRECATED 2026-11-13** — the
`nito-cash-docs` Pages project was deleted on the CF side and `apps/docs` was removed from the
repo (content survives in git history); the docs build/deploy CI steps are gone.

The **BLAZE submission page** (`apps/blaze`, static `index.html` + mock `deck.html`) is deployed
the same Direct-Upload way to Pages project **`nitocash-blaze`** (custom domain `blaze.nito.cash` —
the domain binding is a one-time Cloudflare-dashboard step; the Pages domain API rejects `.cash`
with "invalid TLD" and the apecsdev zone token lacks DNS:Edit, so it cannot be done via API).
First deployed manually from the `apecsdev` VM on 2026-11-13 (project created via wrangler with
`CLOUDFLARE_ACCOUNT_ID` set — the VM's zone-scoped token otherwise trips wrangler's /memberships
preflight). It is wired into the CI `deploy` job alongside the web wallet and docs.

### Routes (apps/web/src/router/index.js)

`/` Splash · `/setup` · `/dashboard` · `/send` · `/receive` · `/history` · `/settings` ·
`/concierge` · `/concierge/spend/advanced` · `/wallets/:walletId?` (4-wallet
model; `/connect` redirects to `/dashboard?connect=1` and `/private` to
`/wallets/nito-cash`)

## Commands

| Task            | Command                                              |
| --------------- | ---------------------------------------------------- |
| Install deps    | `pnpm install`                                       |
| Dev server      | `pnpm dev`            (delegates to apps/web `serve`) |
| Build (all)     | `pnpm build`          (→ apps/web `build-for-all`)   |
| Build (nito)    | `pnpm --filter @nito.cash/web run build-for-nito`    |
| Lint            | `pnpm run lint`                                      |
| Unit tests      | `pnpm run test:unit`                                 |
| Regen icons     | `pnpm --filter @nito.cash/web run generate-icons`    |
| Prover deploy   | `pnpm run prover:deploy`                             |

## Build & Verify

After any dependency or source change, verify before pushing:

```bash
pnpm install --frozen-lockfile --ignore-scripts   # lockfile must be in sync
pnpm build                                        # must compile cleanly
pnpm run test:unit                                # unit tests must pass
```

> **CI runs `vitest run --coverage`, not plain `vitest run`** — every test can pass and the
> job still fail on the coverage ratchet. Measured 2026-11-22: a feature commit of ~750
> lines shipped without tests → `376/376 tests passed` but `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`
> from the threshold (run 45028769839). **Commit the tests with the feature** (or in the same
> push), or master goes red and the `deploy` job never runs. The local gate is 89% lines /
> 89% statements (`apps/web/vitest.config.js:78-81`); `codecov.yml` targets 90% ±1%.
>
> **The build host for the web app is the `apecsdev` VM** (ssh alias `apecsdev`, `~/apps/nito.cash`,
> rsynced from the dev host). It has node v24.18.1 + pnpm 11.21.0 and a warm `node_modules`.
> It has a **portable (no-root) Chrome** for the visual gate since 2026-11-22 — see the
> verification notes under Phase D / the Concierge sections.

CI runs `pnpm install --frozen-lockfile`; if `package.json` and `pnpm-lock.yaml` disagree,
the build fails with "The lockfile would have been modified by this install." Always commit an
updated `pnpm-lock.yaml` alongside any `package.json` change. (Cloudflare Pages no longer
builds from source — see "CI / CD" — but CI enforces the same frozen-lockfile guarantee.)

> **Note — lint is a separate step:** the Vite build does not run eslint; `pnpm run lint`
> uses eslint 9 flat config (`apps/web/eslint.config.js`). The app intentionally uses
> `console.*` debug logging, so lint is not wired into (and must not gate) the build.

## Ledger Integration (IN PROGRESS — plan for FULL integration)

Ledger hardware-wallet support is being expanded from a single debug screen into a full feature.

**Current state:** `@ledgerhq/hw-app-btc@11.6.0` + `@ledgerhq/hw-transport-webusb@6.35.0`
(upgraded from `5.13.1`). The only usage is in `src/views/Concierge/Spend/Advanced.vue`
(`ledgerConnect()` calls `getWalletPublicKey` on BCH path `44'/145'/0'/0/0`). This is marked
"FOR DEVELOPMENT PURPOSES ONLY".

**Full-integration plan:**
1. **Transport layer** — WebUSB (`hw-transport-webusb`) for desktop; consider WebHID
   (`@ledgerhq/hw-transport-webhid`) as a fallback for broader browser support.
2. **Connection management** — a dedicated store module/composable that owns the transport
   lifecycle (connect/disconnect/reconnect, device events), replacing the ad-hoc
   `LedgerTransport.create()` call.
3. **Address derivation** — BCH derivation path `44'/145'/...` (BCH coin type = 145). Expose
   receive/change address derivation consistent with the existing `wallets` store.
4. **Balance / UTXO** — fetch UTXOs for Ledger-derived addresses via the existing blockchain
   access layer (`src/lib/bch/provider.js` Fulcrum), not via Ledger's own explorer.
5. **Transaction signing** — build unsigned BCH txs in the app, then sign inputs on-device via
   `btc.signP2PKH`/equivalent; broadcast via the existing send pipeline.
6. **UI** — surfaces for connect, account selection, receive-address display/verify-on-device,
   and send confirmation; integrate into `Send`/`Receive`/`Settings` views.
7. **Error handling** — user-facing states for locked device, wrong app, user rejection
   (`0x6985`), and transport disconnects; route through the existing `displayError`/
   `displayNotification` system store actions.

## In-Flight: Responsive UI (Tablet + Desktop)

The app was designed mobile-first; a responsive pass for **larger screens (Tablet and Desktop)**
is planned as the next workstream. Until then, layouts target a single-column mobile viewport.

## Product Roadmap (post-hackathon)

Items on the **immediate roadmap** (informed by a feature-parity review of the Selene wallet and
the BCH Blaze 2026 submission):

- **Stablecoin mode** — hold incoming BCH as a USD stablecoin (PUSD, and later MUSD) and pay out
  as plain BCH. Builds directly on the shielded-pool work below.
- **WizardConnect** — an HD-wallet-aware BCH dApp-connect standard (the wallet answers dApp
  connection / signing requests). Closely related: **Cauldron in-wallet token swaps** and
  **multi-fiat pricing** (144 currencies).
- **"Coming Soon" stablecoin** — exactly ONE additional stablecoin is signalled as Coming Soon.
  **MUSD** (Moria Protocol, a BCH CashTokens stablecoin) is the recommended pick for technical
  coherence (same chain / same CashTokens standard as PUSD); fUSD (Zano) is the "exploring"
  cross-chain alternative. **Decision pending.**

### Nito Cash — Private Payments (BCH Blaze 2026 submission)

The flagship new feature: the **first shielded pool for ParyonUSD (PUSD) on BCH Chipnet** —
sender, receiver, and amount are all masked. Design decisions locked:

**CURRENT STATE (2026-11-25, role-2 tagged pool — supersedes the 2026-11-23 covenant-at-0 text below, which is history):**

- THE NEW ROLE-2 TAGGED POOL IS LIVE ON CHIPNET. Handoff:
  `../hushyourmoney/docs/POOL-HANDOFF-2026-11-24-NITO-ROLE2-TAGGED.md`; sources
  `../pusd-shielded-pool/wip-role2-hook/` (`STATUS.md`, `REVIEW.md`, `pool-hook.mjs`,
  `pool-deploy-role2.mjs`, `minting-guard.mjs`, `pool-op-role2.mjs`, the tagged reports).
  Category `480e30ff1d3f5f0b6fe9dd2dbe363b1776f61566f29a395628d0b50abd01b9d0`;
  anchor/mint/deploy `480e30ff…`/`5ea499ff…`/`2eaeb97f…`; program P2SH32 `aa203e40…`;
  minting guard `aa2066a2…`; VK `05250429…`; genesis root `551108f6…510f`; lifecycle
  SHIELD `9d9aa97a…` → TRANSFER `5262417b…` → UNSHIELD `e54d19fb…`; gates 20/20
  acceptance, 146/0 red team, 69/0 sweep. The 3-input signature-free shape (fuel 0,
  fuel 1, state 2); the 169-B OP_RETURN carrier; the deposit tags
  `SHA256(nf0_LE ‖ nf1_LE)` as mutable-NFT commitments on BOTH fuel UTXOs; off-chain
  notes; fees prepaid in the fuel; the minting guard (burn/FT-mint consensus-impossible).
- THE OLD `chipnet-pusd-v4` (`0d31da75…`) IS SUPERSEDED. The old verifier was
  WITHDRAWN/REDACTED; the old 7-input `DEPLOYED_PROGRAM`, `walletProverCompatible`,
  `verifier-program`, `build`, `actions` and the old `lib/pool` integration are history.
  Replace them with the role-2 shape.
- NITO ROLE 2 — the nito.cash client is the FINAL APPROVAL. Work items: (1) proving-asset
  swap (`27f6ea03…` → `05250429…`; new `pool.wasm`/`pool_final.zkey`; the witness
  generator drops the 7-input assumptions); (2) 3-input tx builder (the carrier; the
  tags); (3) the wallet-signed lock tx (2 tagged fuel UTXOs; the FT deposit on out0 for
  shields); (4) off-chain notes; (5) blanks; (6) fee hygiene.
- THE OLD NOTES ARE NOT LEFT. The one-time migration is old-pool UNSHIELD (the
  `chipnet-pusd-v4` notes → transparent PUSD, via the old pool's prover/VK/`UNSHIELD`
  path) followed by new-pool SHIELD (transparent PUSD → the role-2 pool). The old notes
  are spent; the new tags/blanks/notes/fees apply. Do not strand the old notes.
- BLANKS MUST BE USER-HELD (AND GENERATED). The guard is the only minter (K per batch;
  the 100M supply frozen); the user's wallet generates the blank addresses/requests;
  the operator runs the guard batch to the user's P2PKH; the user holds the blanks; 2 per
  lock; the operator-held 90 reserve is NOT relied on; the operator cannot censor.
- THE DESK MIXERS. CashShuffle is the preferred mixer (simplicity; browser; the
  CashShuffle-style relay round; onion-blinded; the pool fee privacy). Desktop CashFusion
  TCP+Tor is unreachable from a browser. The Nostr editions are REQUIRED:
  CashShuffle-over-Nostr and CashFusion-over-Nostr (the `hushyourmoney`
  `web/pages/research/coinjoin.vue` wire spec; the NIP-59/44 research). The pool-native
  lock batching composes with the tags. Quantumroot Vaults are separate (saving, not
  payments; distinct from the Transparent Vaults).
- THE WEB-PLATFORM CHIPNET TEST IS THE ACCEPTANCE. The new pool must run
  SHIELD → TRANSFER → UNSHIELD successfully FROM THE WEB PLATFORM on chipnet before it
  is considered working (the browser; the new VK/assets; the new shape; the tags; the
  user-held blanks; the notes; the fees; the scan; the migration; the Nito client final
  approval).

**CURRENT STATE (2026-11-23, covenant-at-0 session — supersedes the NEXT-MISSION /
POOL-V2 / FOLLOW-UP-SESSION text below, which is history):**

- **THE COVENANT-AT-INPUT-0 POOL IS LIVE AND CONFIRMED.** Category/anchor
  `0d31da753c6855b830ea683ac11552404139008bfbfac97801fe30d31a42d664`, mint `a5d251e4…`,
  deploy `efd3314e…`; wallet-originated actions CONFIRMED on chipnet: SHIELD
  `43ca7bca59d35790e104a6c368dd1168a6fceae3eb5efa4d3a5d02ddb9f92e4d` and TRANSFER
  `fdd2981d2ceed10099941b9228f53a59020c2a4039581f98614038de1bf97b8b` (encrypted carrier
  note to a second wallet's delivery point). Both were VM-validated **7/7 inputs on the
  BCH-2026 VM BEFORE broadcast** (the pre-broadcast gate: `shield-e2e.mjs --capture` →
  `eval-captured.mjs` on the apecsdev VM). Shape (the FINAL tx layout, all actions):
  in0 covenant · in1-3 exec0/1/2 · in4 genesis · in5 terminal · in6 funding; out0 continuity
  · out1-3 exec steps · out4 GENESIS · out5 TERMINAL · out6 carrier · out7 change.
- **THE COMPLETE GENERALIZATION = 30 size-preserving source edits across five files**
  (`loader.mjs`, `build.mjs`, `vkx-stages.mjs`, `terminal.mjs`, `genesis.mjs`) plus the
  `genesis-slice.json` program-hash pin. **THE HIDDEN LAYER is `shared.mjs`**: the five
  step inputs ASSEMBLE and EXECUTE a shared program at runtime from the witness-borne
  fragments (function 100), and that assembled program carries ITS OWN layout dispatch —
  a `k < 3` guard, FOURTEEN k-comparison sites (including a first-executor flag and an
  adapter-path gate at `0x17 OP_PICK/OP_ROLL`, both `k==0`-gated — their absence broke
  exec0's GLV leftover invariant at function-ip 1102), and SEVEN `readBoundedInputSlice`
  input indices. No static redeem disassembly reveals this; the fragments are DATA in the
  witnesses. REPRODUCIBLE: `apps/web/scripts/generalize-bench-source.sh` (applies → builds
  → restores via trap). The program is VK-SPECIFIC (`vkx-msm.mjs:30`, FINAL =
  vk.ic[0] − [2^64]G): substitute the wallet vk into the bench pairing-vectors before
  building. Program layout is byte-length-identical to the fixture build (redeems
  574,574,574,6044,4415; fragments 867/982/559; witnesses 6717/6480/6409/7904/8965).
- **THE METHOD THAT WORKED (recorded for future debugging):** bench-first synthetic
  evaluation — the bench's own `produceTransaction` + a synthetic 7-input tx on the BCH-2026
  VM (build host) isolates the program from the wallet entirely; that run failed IDENTICALLY
  to the wallet's real tx, exonerating the wallet port. Trace-bisect (fixture control vs
  generalized value streams) located the final two gates once 4/5 inputs passed. The
  genesis input is PROOF-MARGINAL on op-cost (spare ≈ 125 B ≈ 100k op): the bench's own
  test proof exceeds its budget; wallet-fresh proofs pass — the wallet's minimality rebuild
  loop already retries.
- **REGISTRY/WALLET STATE:** `chipnet-pusd-v4` → `0d31da75…`, `walletProverCompatible: true`;
  `networks.js` chipnet PUSD → `0d31da75…`; `verifier-program-bench.js` (BENCH_PROGRAM) =
  the covenant-at-0 program (`fixtureShape: false`). The FIXTURE-shape pool `2d7cae86…`
  (TRANSFER `8dd3ce63…`) remains confirmed on-chain but its registry entry was consumed by
  this work's iterations (recoverable from commit `b174499`); the broken intermediate
  deployments (`0717e1a1…`, `07a020e9…`, `00081625…`, `135dc9ed…`, `1d3414ac…`,
  `1fafc607…`) are on-chain records with measured failure modes in the registry notes.
- **HANDOFF DELIVERED** to the hushyourmoney team (their checkout):
  `/Workspace/apecsdev/hushyourmoney/docs/POOL-HANDOFF-2026-11-23-NITO-COVENANT0.md` —
  paste-ready pool-registry.json entry (their schema), the v2 walletProverCompatible=false
  correction, all txids, the shape, the hidden-dispatch story, and the acceptance method.
  Commit `61cef0b`.

- **Shielded-to-shielded** transfers; variable-amount notes; **covenant-carried state**
  (`{merkleRoot, nullifierSet}` in a CashToken NFT commitment). **Chipnet ONLY** for the hackathon.
- **Circuit** — a BN254 Groth16 circuit (Circom) with exactly **2 public inputs**
  `[merkleRoot, actionHash]`; all other logical values (nullifiers, new commitments, public
  value, asset category) are private witnesses packed into
  `actionHash = Bits2Num(253)(SHA256(nf0 | nf1 | cm0 | cm1 | publicValueAbs | publicValueSign | assetCategory | newMerkleRoot))`
  (each field 32-byte big-endian, digest truncated to 253 bits) and constrained in-circuit.
  **183,472 constraints** (`build256/pool.r1cs`). ("Option 2" / "Option F" — keeps the
  battle-tested 2-scalar on-chain verifier unchanged instead of rewriting it for 8 public
  inputs.)
- **On-chain verifier** — the `densless-msm` Groth16 verifier from `zk-verifier-bench`, wired to
  OUR verifying key. **Proven on the BCH 2026 VM: PASS (5/5 valid proofs accepted, 9/9 mutated
  public inputs rejected, cross-stage binding BOUND, all 26 maintainer red-team attack runs
  rejected), 35,626 B in ONE standard transaction, relayable under default mempool policy.**
  (Regenerating the red-team for our key required a one-line generality fix to the bench's
  `redteam.mjs`: it assumed the genesis selector is always `OP_0`, but our proofs use selector
  `OP_2`; the fix preserves the raw encoded push bytes. A fixture-dependent generator assumption,
  not a verifier weakness — the verifier accepts any selector. Fix upstreamed as
  [mr-zwets/groth16_cashscript#26](https://github.com/mr-zwets/groth16_cashscript/pull/26)
  — MERGED 2026-10-30 (merge commit `3af2ad8`).)
- **Trusted setup** — Phase 1 (Powers of Tau) reuses an existing attested BN254 ceremony; Phase 2
  (circuit-specific) is our own. A disclosed local **1-of-1** contribution is acceptable for the
  chipnet PoC; a full MPC ceremony is **mandatory before mainnet**.
- **Remaining build** — the BCH **covenant** (CashScript) that holds the PUSD CashTokens + pool
  state is **DONE and deployed** (pusd-shielded-pool repo), with the verifier transaction as a spend
  condition. The full lifecycle is **confirmed on chipnet** on the current **Option B** pool
  (P2SH32 `aa20a458f7…`): DEPLOY+SHIELD `bd72f1f3…` and TRANSFER `b0a488db…` (both block 329722),
  UNSHIELD `e90b9a56…` (block 329736). **Multiple shielded transfers settle in ONE block** — three
  chained TRANSFERs `60fe613e…` / `7d89f877…` / `ebc6e4f9…` confirmed together in block **329764**
  (each ~36.8 KB, no public value moved; b spends a's pool output, c spends b's). The Groth16 proofs
  are **pool-address-agnostic** — bound only to the verifying key + the `[merkleRoot, actionHash]`
  statement, with replay prevented by the on-chain nullifier set / root progression — so the same
  proofs verified on both the original and Option B redeployments (only the verifier-step scaffolding
  is regenerated per deployment via `produceTransaction`; VERIFIER_DIR=`/home/ubuntu/zkb/bench-pusd`).
  NOTE-DETECTION (blocker #2) is DONE wallet-side (2026-11-22): `apps/web/src/lib/pool/{registry,decode,scan}.js` + the
  `pool/scanPool` store action scan a pool's covenant-address history over the existing Fulcrum cluster, order
  actions by the covenant-input outpoint chain, validate each action (recomputed actionHash == proven n1;
  proven-n0 root chain anchored at the registry genesis root), and trial-decrypt NP01 carrier packets
  (`lib/pool/carrier.js`, blocker #1 — the encrypted-note OP_RETURN carrier, NOTE-CARRIER.md in
  pusd-shielded-pool; NO covenant change required, empirically confirmed by the apecsdev-VM eval).
  LIVE-VERIFIED against the real chipnet gate3-demo-pool (SHIELD f5927a0b: pvAbs 1,000,000, 0 carriers,
  all validations pass). The deployed live pools use the 347-byte GENERALIZED covenant (covenant input
  position + verifier-genesis input index are builder choices — decode.js finds both dynamically).
  Remaining: runner-side indexer materials (seed subtree hashes for SPEND witnesses; nullifier-set service,
  on `bch-infra`/runner) and the nito.cash wiring (shield/transfer/unshield UI + client-side WASM proving).
  TX-BUILDER (blocker #3) is DONE wallet-side (2026-11-22, same day): `lib/pool/build.js` assembles the full
  action tx (covenant unlocking in the live 9-push format + 5 verifier-step inputs + Schnorr funding with
  token-bearing source outputs + continuity/payout/carrier/change outputs + fee), `lib/pool/verifier.js` is
  the wallet port of the bench `produceTransaction` runtime (BYTE-EXACT vs the bench vectors; accepts
  snarkjs proofs), `lib/pool/verifier-program.js` carries the deployed program constants extracted from
  the live chain (byte-identical across all 7 live actions), and the registry carries each pool's deployed
  347 B `covenantRedeem`. VM-eval on the apecsdev VM: the wallet-built COVENANT input + the funding inputs
  ACCEPT on the BCH 2026 VM (deployed redeem logic + carrier tolerance + real-proof actionHash binding +
  root binding + conservation). RUNNER-GATED discovery (BLOCKER-3-BUILDER.md in pusd-shielded-pool): the
  deployed pools' verifier-step witness algorithm is a runner worktree revision NOT in the public bench
  main (exec2 fragment 561 B vs 559, different MSM build; the live witness vk_x matches NEITHER vkey we
  hold) — the wallet cannot regenerate the five verifier inputs for the ALREADY-DEPLOYED pools until the
  runner's worktree is recovered; the gate3 "same vkey as the wallet-committed" claim is CORRECTED in the
  registry (NOT wallet-prover-compatible until re-verified; note detection unaffected). The byte-comparison
  harness vs the live witness pushes is built and ready as the acceptance test.
  Blocker-3 CI notes: the bench ground-truth fixtures are COMMITTED at `apps/web/tests/fixtures/pool/`
  (bench vectors steps, both fixture sets, the eval proofs, the live gate3 covenant fixture — 96 KB;
  specs resolve them via `import.meta.url`, NEVER absolute paths); the vectors byte-exact test is PINNED to
  fixture 0 (the generating proof — the 5-fixture sweep saturated CI's 2-core runner enough to trip the
  timing-marginal DISCOVERY test). Blocker #4 is DONE (commit 7b70bf2, 2026-11-22; suite 51 files / 503
  tests, coverage 92.93% stmts / 92.95% lines; VM-verified + pushed, CI deploys):
  · WIRING: `lib/pool/actions.js` (the action orchestrator — witness tree assembled from the SCAN's ordered
    actions + registry `genesisLeaves`/`genesisLeafCount`, never the own-notes-only store list; EXACTLY two
    in-notes, own largest-first filled from registry `bootstrapNotes`; funding from ONE account address
    via `getUtxosWithTokens` — Fulcrum token fields are `token_data.category`/`token_data.amount` — and
    foreign-category token UTXOs are NEVER spent (the builder only returns pool-category + BCH change);
    prove → verify vs the committed vkey → buildActionTx → broadcast, with onStage progress for the UI);
    store `pool/submitPoolAction` (scanPool's return now also carries the raw engine result; displayError
    + rethrow on every path); Wallet.vue real flows + the wallet's own DELIVERY POINT display/copy.
  · GATE: registry `walletProverCompatible` (BOTH deployed pools false per the vkey correction) +
    `getProverPool()` — UI + store gate on it. A Path-A deployment under the wallet-committed key flips
    ONE flag and the flows light up with no further code change.
  · ASSETS: GitHub Release `proving-assets-v1` (pool.wasm + pool_final.zkey + verification_key.json,
    sha256 in the notes). LINEAGE VERIFIED on the VM: snarkjs `zKey.exportVerificationKey(pool_final.zkey)`
    reproduces the committed verification_key.json BYTE-FOR-BYTE (groth16/bn128/nPublic 2) — our own
    runner-independent keypair. GitHub release assets send NO access-control-allow-origin (verified), so
    the prover Worker now proxies them at `prover.nito.cash/assets/<name>` with CORS * + 24h cache
    (pinned names; live-verified, version 9ff7d644); prover.js `*_URL` defaults point at the Worker
    mirror, relative paths stay the local-dev override. `toBenchVk` (actions.js) bridges the two vkey
    shapes (snarkjs JSON vs bench objects — SAME key, byte-identical, asserted in tests); build.js's
    `@param vk` doc corrected accordingly.
  · prover:deploy FIX: `~/.cloudflare/token.env` assigns WITHOUT export — wrangler never saw the token;
    the script now exports it explicitly (also: NO backticks inside its double-quoted ssh block — the
    local shell command-substitutes them into the remote script).
  · The pool-actions spec MOCKS build.js ON PURPOSE: a fixture proof pairs only with its own
    publicSignals (the Groth16 pairing sanity check), so real-builder ground truth stays in pool-build.spec;
    the orchestration spec pins the wiring (exact assembled buildActionTx params incl. vk = bench shape).
  NEXT MISSION — DONE-AND-LIVE RESTATEMENT: the Path-A pool above was the mission and it is DEPLOYED
  (chipnet-pusd-v2, see the POOL-V2 section below). The NEXT session's mission is RECORDING THE ENTIRE
  END-TO-END FLOW (the user's directive, 2026-11-22): run shield → transfer → unshield LIVE through the
  wallet UI against chipnet-pusd-v2 and capture it (screenshots/video + txids). Everything is in place:
  the pool is confirmed, the wallet flows are enabled (walletProverCompatible: true), the funding PUSD
  (100M fungible) sits at the chipnet mint key (bchtest:qpt2lckk…, deploy output 6 of 53014fd4 —
  spendable via the .secrets mint key), and the proving assets are distributed (GitHub Release
  proving-assets-v1 + the prover.nito.cash/assets/* mirror). Two wallets = two delivery points for a
  cross-wallet TRANSFER (the recipient's delivery point is displayed on the Nito Cash wallet panel).
  NOTE: the old pools' balances stay runner-gated forever otherwise (their vkey's zkey is the lost
  worktree's — Groth16 vkey→zkey is one-way; BLOCKER-3-BUILDER.md:49-50).
  FOLLOW-UP SESSION (2026-11-22, later): RUNNER-KEY RECOVERY + the scripthash fix.
  · FOUND ON the apecsdev VM (~/zkb — the full runner-layout build env, dated Nov 13): the
    deployed pools' TRUE keypair — build/pool_final.zkey (97,716,000 B, sha256 4a4e2543…) +
    build/verification_key.json (= tests/fixtures/pool/deployed-vkey.json, sha256 05250429…),
    pairing-VERIFIED on the VM (zKey.exportVerificationKey reproduces the vkey byte-for-byte);
    the Phase-2 entropy is STORED at build/demo-entropy.txt (c490ce06a2f3… — a reproducible
    demo-solo-1of1). Two independent proofs it is the pools' key: its IC points are EMBEDDED in
    the deployed on-chain program (LE), and its vk_x for each live (n0, n1) appears byte-exact in
    the live genesis witnesses (fields 4/5, LE) of BOTH chipnet gate3 f5927a0b and mainnet 4fda8a8b.
  · ACCEPTANCE (apps/web/scripts/pool-accept.mjs — the byte-comparison gate): FAIL. The key alone
    does NOT unblock step regeneration: the runner's witness-ENCODING revision (a different MSM
    build) is NOT on the VM — ~/zkb/groth16_cashscript + ~/zkb/zk-verifier-bench are PUBLIC main
    (0 ahead / 0 behind) plus a 1-byte OP_5→OP_7 terminal tweak. snarkjs canonical verify rejects
    the live proof under the recovered key in ALL 28 sign/limb variants (the deployed verifier
    consumes a TRANSFORMED proof representation — the port's P_minus fields[3]=-a.y convention
    etc.), and the port's own pairing check fails likewise; the live push-0 is the same 14 fields
    in NATURAL order LITTLE-ENDIAN vs the port's reordered big-endian layout. walletProverCompatible
    STAYS FALSE on both pools (two independent gates now: the encoding generator + the unpublished
    seed-leaf values — seed256.json is NOT on the VM).
  · FULCRUM BUG FIXED: poolAddress()'s hashType-bit CashAddress form (`bitcoincash::p…`) is
    REJECTED by Fulcrum ("Invalid address" — verified live on mainnet + chipnet), so the shipped
    scan + getLivePoolState paths were dead at runtime. All pool history queries now go by
    SCRIPHASH (provider getScripthashHistory + registry poolScripthash; the live-verified gate3
    scripthash 438d2142…9119 is asserted in the scan spec).
  · NO new setup was run: the recovered key supersedes it for the deployed pools (a fresh
    Phase-2 would fork the lineage AGAIN for no gain); a Phase-2 MPC remains the mainnet trust
    upgrade, separate from recovery.
  POOL-V2 DEPLOYED (2026-11-22, third session — THE RUNNER-INDEPENDENT POOL IS LIVE ON CHIPNET):
  · apps/web/scripts/deploy-pool.mjs deployed chipnet-pusd-v2 end-to-end: anchor
    050b5934…504a9 (= THE NEW CATEGORY), mint a3e90020…decc02 (genesis minting NFT + 100M
    fungible), deploy 53014fd4…766da (pool UTXO with the seeded-root state NFT + the 5 WALLET
    step UTXOs). All three broadcast-accepted; result txids == computed txids.
  · The pool pins the WALLET-COMMITTED keypair (proving-assets-v1 lineage) + WALLET_PROGRAM
    (the committed bench vectors — the port reproduces them byte-exactly; a lockstep test
    asserts the constants). registry.js: the pool is the FIRST chipnet entry,
    walletProverCompatible: true, with PUBLIC genesisLeaves + bootstrapNotes (2 dummy notes,
    value 0, nk=1, deterministic rho/r) — the shield/transfer/unshield flows are LIVE.
    networks.js chipnet PUSD → 050b5934… (the 8c73ff… TX-P3 stand-in superseded — no
    wallet-compatible pool ever tracked it). build.js is per-pool programs now
    (pool.stepLockings + pool.program; gate3/mainnet carry the deployed found-key program).
  · GENESIS RULES DISCOVERED LIVE (all in HANDOFF-POOL-V2.md for the hushyourmoney sync):
    (1) the genesis category anchor must be spent as vin[0] at VOUT 0 — vout 1 is rejected
    with bad-txns-token-invalid-category; (2) genesis NFTs are minting-capable with EMPTY
    commitments (the pool's mutable state NFT is created by SPENDING the minting NFT); (3)
    the min-relay-fee probe must measure the SIGNED size (100 B placeholder unlockings);
    (4) BCH txid = DSHA of the FULL SIGNED tx, and libauth hash256 is already the double.
  · The gate3/mainnet pools STAY runner-gated (their witness-encoding generator revision is
    not on the VM — ~/zkb is public main + a 1-byte OP_7 tweak; pool-accept.mjs is the gate).
    The recovered keypair (deployed-vkey.json) remains on record for them.
  · **CORRECTION 2026-11-23 — chipnet-pusd-v2 IS UNSPENDABLE AS DEPLOYED** (`walletProverCompatible`
    flipped back to false). Its step program is the BENCH's FIVE-INPUT variant: the terminal redeem
    pins `OP_TXINPUTCOUNT == 5` and `OP_INPUTINDEX == 4` (WALLET redeems[4] instructions 1548-1558)
    and the exec/genesis redeems read INPUT 3 as the genesis witness (redeems[0] instr. 33-34:
    `OP_3 OP_INPUTBYTECODE`). The wallet's builder emits EIGHT inputs (covenant 0, exec0..2 1..3,
    genesis 4, terminal 5, funding 6+), so no action can satisfy the scripts whatever the proof.
    Evidence on a REAL action (36,997 B, 8-in/8-out) under the BCH-2026 VM (apecsdev `~/zkb/tools`,
    `createVirtualMachineBch2026`): input 0 (covenant) PASSES; inputs 1-3 `OP_SPLIT invalid index
    (item 219, split 867)`; inputs 4-5 `OP_VERIFY`; the network returned
    `mandatory-script-verify-flag-failed (Invalid OP_SPLIT range)`. The WORKING deployed program is
    the GENERALIZED variant (DEPLOYED_PROGRAM redeem 4 @1549-1557: `OP_TXINPUTCOUNT >= 5`,
    terminal at index 5). FIX = generate a GENERALIZED program under the WALLET vk
    (`~/zkb/groth16_cashscript/chunked/bn254/densless-*-recovered` is the generator family; the
    exact variant that produced gate3 is still the missing runner revision) and redeploy.
    The port itself is NOT implicated: `produceVerifierInputs` reproduces the bench vectors
    byte-exactly, and the fixture proofs produce the same push profile as a real action.
    Also fixed this session: `decode.js` `txidHexOf` reversed libauth's already-display-order
    outpoint hash (commit e5602b0) — the scan chain link and build.js's self-check were dead.
  · GENERALIZED CONTRACT WORKS — 9/10 INPUTS (2026-11-23, fifth session):
    A REAL 37,282 B shield tx (10 inputs) built by the wallet's OWN pipeline against
    DEPLOYED_PROGRAM UNMODIFIED, evaluated on the BCH-2026 VM:
      vin0 covenant ok | vin1-3 exec ok | vin4 genesis ok | vin6-9 funding ok
      vin5 terminal FAIL@ip1747.
    This is the "inputs 1-5 with a covenant at 0" contract WORKING: the covenant, all
    three exec steps, the genesis and every funding input accept. The exec failures
    seen earlier in this session were entirely caused by mixing the deployed scripts
    with the wallet's 559-byte fragment (deployed = 561). DEPLOYED_PROGRAM must be
    used WHOLE: its scripts AND its own 867/982/561 fragments.
    TERMINAL (the only remaining failure): ip is an INSTRUCTION INDEX, not a byte
    offset. The failing site is instruction ~1746-1748 of redeems[4]:
    `push(32)=47fd7cd8… (p) NEGATE OP_1 DIV OP_8 PICK …` — the modular-arithmetic
    reduction over 32-byte field elements. The stack there holds four 32-byte items.
    So the remaining delta is in the VALUES the wallet's produceWitness emits for the
    terminal witness (its modular representation), not in the script layout.
    HARNESS FAITHFULNESS (learned the hard way): the terminal REQUIRES the real
    transaction's outputs (token conservation). A synthetic tx makes even the
    CONFIRMED gate3 action f5927a0b… fail the terminal (ip1557), and a synthetic tx
    also makes the confirmed action fail if its terminal is paired with another
    transaction's genesis. NEVER evaluate the terminal outside a real, self-
    consistent action transaction.
  · DECISIVE FINDING (2026-11-23, fifth session — supersedes the porting theory):
    THE VERIFIER SCRIPTS ARE POSITIONALLY BOUND. Evaluated on the BCH-2026 VM, the
    COMMITTED bench vector (bench-vectors-steps.json) passes exec0/1/2 + genesis in a
    5-INPUT tx with the steps at inputs 0-4, and fails IMMEDIATELY (exec at ip3,
    genesis at ip1497) the moment the steps sit at inputs 1-5 or 4-8. The runner's
    deployed program is the GENERALIZED contract that works at inputs 1-5; the
    wallet-committed WALLET_PROGRAM is the FIXTURE contract that only ever worked in
    a synthetic 5-input tx with no covenant and no funding. They are different
    CONTRACTS, not two revisions of one — which is exactly why chipnet-pusd-v2
    (deployed under WALLET_PROGRAM) is unspendable.
    MEASURED RESULT with DEPLOYED_PROGRAM UNMODIFIED (its scripts AND its own
    867/982/561 fragments) + the WALLET's witness builder and the wallet-committed
    key, evaluated in a real-action shape (steps at 1-5, 8 inputs):
      exec0 ok | exec1 ok | exec2 ok | genesis ok | terminal FAIL@ip1557.
    4 of 5 verifier steps PASS. The earlier exec failures were CAUSED BY MIXING the
    deployed scripts with the wallet's 559-byte fragment (the deployed exec embeds
    561) — a mismatch introduced by the LCS construction, not a property of the
    deployed program. NEVER mix scripts and fragments across programs.
    REMAINING: the terminal (deployed redeems[4], 4158 B). It reads the genesis's
    448-byte header from INPUT 4 (`OP_4 OP_INPUTBYTECODE OP_3 OP_SPLIT NIP
    <448> OP_SPLIT DROP`, ip1555-1565). NOTE the fixture's OWN terminal also fails in
    a synthetic 5-input tx (ip1556), so a synthetic harness is NOT faithful for the
    terminal — it must be tested in a REAL action (covenant + token outputs).
  · REVERSE-ENGINEERING STATE (2026-11-23, fourth session — read before continuing):
    The wallet port now PASSES the deployed program on 7 of 8 inputs (covenant, exec0-2, genesis,
    funding — BCH-2026 VM, real shield tx). The ONLY remaining failure is the TERMINAL's residue
    chain (c^LAMBDA == raw·w). Verified facts that SCOPE the remaining work:
    (1) The live gate3 header layout IS the bench convention (A=slots2/3, vkx=4/5, C=6/7, B=8..11,
    14×32-byte LE fields; the on-chain n0/n1 from genesis bytes 1825/1792 are confirmed by the
    recovered-IC vkx reproducing slots 4/5 EXACTLY).
    (2) BUT the live gate3 proof extracted from its own ACCEPTED witness does NOT satisfy the
    standard Groth16 equation e(A,B)=e(α,β)·e(vkx,γ)·e(C,δ) under the recovered vkey — snarkjs
    rejects it too, across 64 sign/limb conventions. The deployed revision therefore transforms
    the proof points UPSTREAM (its c/cInv/selector/raw differ from the port's), not just the
    terminal encoding. The port matches the OLD bench (byte-exact vectors) — the deployed pools
    were made by a NEWER revision.
    (3) The runner's generator is CONFIRMED NOT on the VM: all six chunked/bn254 generator dirs
    were built and none emits the deployed shape (deployed redeems 364/364/364/5909/4158; current
    densless-msm emits 574/574/574/6044/4415 — a later refactor; the deployed shape matches the
    OLD committed vectors + tweaks: terminal +1B, frag2 +2B, genesis same length but 1914 B differ).
    The old "1-byte OP_5→OP_7 tweak" note was WRONG — the terminal differs in 830 B, genesis 1914 B.
    (4) The path: reproduce the deployed script's raw computation (the miller-event chain in the
    deployed genesis/terminal bytecode — full bytes in verifier-program.js, annotated Rosetta =
    the public bench sources) using the LIVE gate3 witness as a pass/fail oracle, then match the
    port's c/cInv/terminal values to it; re-gate 8/8 on the 2026 VM before any deployment.
    OR: obtain the runner's worktree from the HushYourMoney side (HANDOFF-POOL-V2.md is the
    coordination vehicle) — one ask, exact artifact.
  · E2E wallets (generated + funded 2026-11-23, NOTES/pool-e2e-demo-wallets.md): A
    `bchtest:qzzu85xnl99u534d9z40yu7c494hknppx5lu29gl8t` (tx 15481b45…), B
    `bchtest:qza5uut0cg0aan2g8jetn68zrrmssvanluzm364c4d` (tx e232c91a…) — 20,000,000 tPUSD +
    200,000 sats each. Funding tool: `apps/web/scripts/send-tpusd.mjs`.
  · HANDOFF-POOL-V2.md carries the hushyourmoney pool-registry.json entry block (their tree
    was mid-reorg — the handoff doc, not their repo, is the coordination vehicle).
  · FOR THE RECORDING SESSION: the end-to-end flow to capture is (1) SHIELD — fund a wallet's account
    with PUSD from the mint key's 100M (a plain send from the .secrets key), then Shield N base units
    through the Wallet UI (the first action spends the two PUBLIC bootstrap seed notes — anyone can
    bootstrap); (2) TRANSFER — a second wallet (second browser profile / second entropy) shares its
    delivery point, the first wallet Transfers to it (carrier note delivered on-chain, receiver's scan
    detects it); (3) UNSHIELD — withdraw back to transparent. Verify each op via the pool scripthash
    history + decodePoolAction (the scan validates actionHash + root continuity end-to-end). Expect
    ~20s per action (client-side Groth16 proving; assets fetch from prover.nito.cash with CORS *).
    VM Chrome: ~/apps/chrome-portable (the visual-baseline recipe). Suggested capture set: the Nito
    Cash panel (delivery point + balance), each action's progress + result, the pool's chaingraph
    page, and the second wallet receiving the transfer note.
  WARNING: the dev-host
  `apps/web/node_modules` is STALE (predates the `@sentry/vue` commit b529e76) — the glitchtip spec fails
  LOCALLY until a frozen reinstall (needs the IPv4-forcing pnpm-11 workaround below); CI installs fresh and
  is green (6197668, deployed).
  The **local encrypted note store is DONE**
  (`apps/web/src/lib/pool/seal.js`: AES-256-GCM via WebCrypto, key = sha256 of domain-separated
  wallet entropy; `pool.notes` is a runtime-only mirror excluded from persistence via
  `omit: ['pool.notes']` in the root store's persistedstate config; only the ciphertext
  `pool.sealed` and public `pool.leaves` persist; `pool/unlockPool` runs fire-and-forget at
  boot in `main.js`).
  The **chipnet stand-in CashToken for the LIVE pool is MINTED** (PUSD is
  mainnet-only): category (display/BE)
  `8c73ff150fbc5d1599d2de187c3382c5926cc5c9c2621cdc2cac1fc14cd93144`
  (on-chain/LE `4431d94cc11fac2cdc1c62c2c9c56c92c582337c18ded299155dbc0f15ff738c`),
  100M fungible units + minting NFT, genesis/mint tx
  `3fd526e9cc5119cd11ef76615ad0c9e1b6187910aeaae1ed178b48c96897656b` (block 328731,
  self-minted with the TX-P3/G3/B3 deployment); mint key (test-only, no value) in
  `/Workspace/apecsdev/.secrets/pusd-shielded-pool-chipnet-mint.json`; full details in pusd-shielded-pool
  `CHIPNET.md`. (An earlier faucet-minted token, category
  `479aeebabc682ddb90a3671bffd2a0bd918737de13f19a92231ed36a8580cc11`, genesis
  `4257dbfb68540cc9afcf569da8e651790c82d3951bdff88f5232a372760ba977` block 328616,
  was a preliminary stand-in — SUPERSEDED, the deployed pool does not enforce it.) Two Fulcrum protocol caveats discovered (critical for the wallet wiring):
  (1) `blockchain.address.listunspent`/`get_balance` HIDE token-bearing UTXOs unless the
  second param `include_tokens` (or `tokens_only`) is passed; (2) spending a token-bearing
  UTXO requires the source output's token prefix to be covered by the sighash (libauth:
  set `sourceOutputs[i].token`), else the input fails NULLFAIL at broadcast.
- **Heavy compute** (circuit compile, Groth16 setup, proving, benchmarks) runs ONLY on the
  dedicated `bch-infra` VPS — never on the dev host.

## Vue 3 Migration (phased) — A–C and E DONE; Phase D in progress

Plan: **Vue 3 + Vite + Pinia + vue-router 4 + vue-i18n 11 + Vitest + Tailwind v4**, executed in
verifiable phases. A (toolchain bridge), B (runtime flip + Vite as production), B-half-2 (Pinia),
C (Vitest), and E (legacy removal) are **done and live**. Phase D is in progress (dedicated
section below).

- **Phase B (done) — runtime flip + Vite as the production build.** `vue@3.5.43`,
  `vue-router@4.6.4` (`createWebHashHistory`), `vue-i18n@11.4.14` (`legacy: true`), error
  reporting via `@sentry/vue` -> GlitchTip (`Sentry.init({ app })`, see `src/plugins/glitchtip.js`). `vue-svgicon` replaced by
  `src/plugins/svgicon.js` (global `<svgicon>`) + `src/compiled-icons/register.js` shim
  (generated `compiled-icons/*.js` re-point at the shim; the `<svgicon>` call sites are
  unchanged). `vite.config.js`: `@vitejs/plugin-vue` + `vite-plugin-node-polyfills`
  (`Buffer`/`process`/`global` for Ledger and Node-style deps); it still shims `process.env`
  for the Vuex-shaped store + `App.vue`. Output: `apps/web/dist-vite/`; CI uploads it,
  Cloudflare Pages deploys it.
- **Phase B-half-2 (done) — Vuex → Pinia via a compatibility layer.** A single Pinia store
  (`defineStore('main')`, `apps/web/src/store/index.js`) whose `state()` is the union of each
  module's `state` under its module key; a **`StoreCompatPlugin`** builds a Vuex-shaped
  **facade** over it — `state.<module>.<key>`, `getters['<module>/<name>']`, `dispatch`/`commit`
  with namespaced + `{ root: true }` + local resolution — so the **50 store sub-files and 12
  components are unchanged** (same `(state, getters, rootState, rootGetters)` /
  `({commit, dispatch})` signatures and `mapGetters/mapActions/mapState` calls). Components'
  `import { ... } from 'vuex'` is **aliased to `src/store/vuex-shim.js`** (exact-match regex
  `/^vuex$/` in `vite.config.js` + `vitest.config.js`). The facade is cached on
  **`globalThis.__nito_store_facade__`** (NOT a module `let`) because Vitest/Vite can load
  `@/store` in more than one realm; built idempotently by `ensureStoreFacade(useStore())` in
  `main.js`. Persistence is `pinia-plugin-persistedstate@4.7.1` replicating the original
  `vuex-persistedstate` exactly (key `vuex`, JSON, `nito`→secure `.nito.cash` cookie, else
  localStorage). `system` is the GLOBAL (non-namespaced) module — namespacing is detected via
  `namespaced === true`. Live action/mutation lookup lets tests stub actions through the facade
  (`Import.spec.js` pattern). An idiomatic-Pinia rewrite (dropping the shim) remains optional
  cleanup, not required for correctness.
- **Phase C (done) — Vitest.** 41 suites / 373 tests on Vitest `@5.0.4` + `@vue/test-utils@2.5.1`
  (jsdom, `vitest.config.js`); coverage (JS + Vue SFCs) lcov → `apps/web/coverage/lcov.info`, 90% line gate. VTU v2
  conventions: `props` (not `propsData`), `exists()`, `global.{plugins,stubs}`,
  `findAllComponents`, `vi.fn/mock`; popup specs un-stub `Popup` via `global.stubs`
  (shallowMount stubs a `Popup` parent and drops its slot).
- **Phase D — CSS → Tailwind. IN PROGRESS** — see the dedicated section below.
- **Phase E (done) — legacy toolchain removed.** `vue.config.js`, `babel.config.js`,
  `jest.config.js`, the Babel plugins, `@vue/cli-*`, the eslint-6 stack, `@vue/test-utils@1`,
  `vuex`, and `core-js` are all gone; lint uses eslint 9 flat config
  (`apps/web/eslint.config.js`).

> **Runtime-verification method (used for Phase B):** `puppeteer-core` + system `/usr/bin/google-chrome`
> against a locally-served `dist-vite/`, asserting `#app` mounts with zero `pageerror`s and that splash/
> setup/settings render their `<svgicon>`s. Reusable; see commit `3914c66` / `bf408db` history.

> **Env note (this dev box):** the host has **no IPv6 route**, and pnpm/npm (Node fetch/undici)
> prefer IPv6 and hang. Workaround used for installs: run a **Node-based pnpm 11** with
> `NODE_OPTIONS="--require ~/.local/force-ipv4.cjs"` (a preload forcing `dns.lookup` family=4).
> The default `~/.bun/bin/pnpm` is bun-bundled and ignores `NODE_OPTIONS`; use the nvm Node
> (`~/.nvm/versions/node/v24.18.1/bin`) + `node ~/.local/pnpm11-dist/package/bin/pnpm.cjs`.
> CI/Cloudflare have working IPv6/IPv4 and are unaffected.

## Phase D — CSS → Tailwind (IN PROGRESS)

Component-by-component conversion of scoped/global CSS to Tailwind utilities. **Verified
pixel-perfect after every batch** with the visual harness (below); **1:1 logic parity required**
(preserve `display` values, state/marker classes, media-query behavior — not just "looks the same").

**Theming (`@theme inline`)** — `apps/web/src/assets/tailwind.css`. The app themes via **47 CSS
custom properties** redefined under `.app.dark` (133 `var(--*)` usages). A naive conversion to
static colors would freeze the theme. The `@theme inline` block maps each token to its `var(--*)`
reference (`--color-primary: var(--primary)`, `--color-fg: var(--fg)`, `--color-input-border`, …),
so utilities like `bg-primary` / `text-fg` / `border-input-border` resolve through the variables and
follow the runtime theme switch. `inline` is required (substitutes the `var()` reference instead of
copying a resolved value). Do NOT add `--font-sans` to `@theme` (it changes preflight's default
font). Custom variants: `@custom-variant short (max-height:600px)` (10× reused) and `xs-mobile
(max-width:520px)`; one-off device queries use arbitrary variants.

**Cascade-layer rule (the crux)** — Tailwind v4 emits utilities in `@layer utilities`; App.vue's
global stylesheet must NOT be unlayered or it always beats utilities. Setup that works (commit
`af333be`):
1. App.vue's global `<style>` is wrapped in `@layer base { … }` (utilities can now override it).
2. `src/assets/tailwind.css` is imported **FIRST in `main.js`** (before App.vue), so preflight lands
   earlier in `@layer base` than App.vue's globals — App.vue's own rules (global `h6`, `footer`, …)
   then win same-specificity ties against preflight, preserving the original rendering.
3. `hr { border: 0 }` added to App.vue: preflight's `hr{border-top}` otherwise leaks through (the `*`
   reset loses to `hr` on specificity once both are in `base`).
- Caveat: `text-xs` sets `font-size` AND `line-height`; use `text-[12px]` when the original only set
  `font-size`. Arbitrary values (`p-5`=20px, `rounded-t-[20px]`) map cleanly otherwise.

**Visual-regression harness** — `apps/web/scripts/visual-baseline.mjs` (dev-only; baseline PNGs are
gitignored). Run from `apps/web`:
```bash
timeout 160 node_modules/.bin/vite build && node scripts/visual-baseline.mjs capture   # baseline
# …edit a component…
timeout 160 node_modules/.bin/vite build && node scripts/visual-baseline.mjs compare   # 0.000% required
```
It serves `dist-vite/`, screenshots 6 routes (setup/dashboard/send/receive/history/settings) ×
light/dark in headless Chrome, and pixel-diffs (pixelmatch, threshold 0.1, max 0.1% drift). Made
deterministic by: aborting every non-`127.0.0.1:5400` request (ticker/balances render as empty),
disabling CSS animations, stubbing `requestAnimationFrame`, and navigating **directly** to each route
(Splash's 3s `router.replace` timer is never cleared on `beforeDestroy` and would otherwise hijack
navigation). Dark mode toggles `document.body.classList` only (matches `Settings.vue` real behavior).
Re-capture the baseline whenever the committed CSS intentionally changes.

**Footer.vue (done)** — first conversion. Root `<footer>` collides with the global `footer` rule, so
the layer fix was a prerequisite. Preserved `display:flex` (non-tooltip) vs `display:block` (tooltip)
and the `tooltip` marker class (its unit test asserts it). Popup footers (`Transaction.vue`, etc.)
still inherit the global `footer{padding:20px}` base — that global rule stays until every consumer is
converted.

**Batches 1–3 (done)** — B1: `Modal.vue` (fully-conditional `hideHeader` height), `Animation.vue`,
`Notification.vue` (`@:click` typo preserved); Spinner kept as plain CSS (its `@keyframes` + 8
`nth-child` rules are genuinely CSS territory). B2: `Tabs.vue` (`flex` nav + `before:` underline with
a fully-conditional `active`/width ternary). B3: `Button.vue` + `Address`/`Dropdown`/`Toggle` inputs.
Button's base + 7 variants + the `max-height:600px` override + hovers moved to a fully-conditional
`buttonClasses` computed (`classObject` markers kept; ONLY the `button.double + button.double` sibling
stays as scoped CSS — a sibling relationship genuinely needs CSS). Dropdown (self-contained scoped
styles) + Toggle (`.toggle.disabled .knob.active` override via an `active && !disabled` knob
conditional) converted. Interactive states not exercised by the harness (Dropdown open menu, Toggle
knob) were verified with a computed-style probe. **Still open:** App.vue's global `input, textarea`
base rule (4 consumers: Amount, Address, Send, Spend) + `Amount.vue` + the views/popups — deferred to
a dedicated follow-up that converts all consumers together.

## BLAZE 2026 Submission — State (as of 2026-11-14)

**Submitted to DoraHacks on 2026-11-14.** Judging 11-23→27, winners 11-28.
Live artifacts verified at submission: nito.cash · blaze.nito.cash (+/deck,
/deck.pdf) · nitocash-blaze.pages.dev. Full session history in
`NOTES/blaze2026.md` (gitignored) — read it before touching WC code.

**Shipped in the 2026-11-14 sessions (all pushed, CI green, prod verified):**
- UI facelift batch: contrast overhaul (WCAG-audited, tokens `--fg-muted`/
  `--warning-text`, dark `--primary` darkened), BlazeBanner → floating
  bottom-right overlay (`.blaze-layer`, z-900, under modal), Splash →
  animated Lottie rocketman (faithful SVG conversion via
  `apps/web/scripts/convert-rocketman.mjs` — 0.64% pixel diff vs the
  original SVG; Setup hero uses the same animation), `.app` scrollable
  (vertical), deep-link QR fix (watch `immediate: true`).
- **FIXED — every app Lottie was silently dead since the Vite migration**:
  dynamic JSON imports hand lottie-web a frozen namespace; its data mutation
  throws. `Animation.vue` unwraps `.default`.
- Mainnet Fulcrum cluster = 3 verified-alive servers (imaginary.cash ×2,
  blackie.c3-soft.com; dead bch.loping.net REMOVED; quorum 2-of-3).
  `FulcrumCluster.request()` is self-healing: idempotent connect() sweep
  before every dispatch + one full reconnect-retry (the electrum client does
  NOT auto-connect on request).

**WizardConnect (external-wallet payments) — dapp side COMPLETE & verified;
blocked on the WALLET-SIDE signers.** The full flow works end-to-end except
the final broadcast: connect ✓ → xpubs ✓ → address derivation ✓ → UTXO scan
✓ (both chains, indexes 0–19 — wallets rotate deposit addresses) → fee ✓ →
tx build ✓ → wire serialization ✓ (tx as HEX + sourceOutputs in the TAGGED
extended-JSON form `<Uint8Array: 0x…>` / `<bigint: Nn>` — the zod schema
also accepts bare hex, but Cashonize's signer parses with its OWN
parseExtendedJson, which needs the tags) → published to relays ✓ → wallet
signs ✓ → response matched ✓. The wallet's signature then FAILS consensus
(NULLFAIL): **Cashonize AND Paytaca sign P2PKH inputs with 64-byte
Schnorr-format signatures that verify under neither ECDSA nor Schnorr over
any plausible preimage** (verified offline vs real chain data — see NOTES
rounds 7–11 + the sigcheck/sigsweep scripts' methodology). This is a
wallet-ecosystem bug, NOT a dapp bug. The user will contact wallet support
the week of 2026-11-17; candidate fixes: upstream report (evidence pack
ready in NOTES), Selene wallet, or a Paytaca/Cashonize fix.

**CORRECTION (2026-11-15, session 20): the round-16 root-cause statement
("P2PKH consensus requires ECDSA/DER") is WRONG.** Schnorr signatures ARE
consensus-valid in plain OP_CHECKSIG on BCH (enabled by the 2019-05
upgrade; still in the current VMs — libauth CHANGELOG:255 +
`instruction-sets/common/crypto.js` opCheckSig's 64-byte branch, used by
bch-2023 and inherited by bch-2025). Verified empirically: the app's OWN
signer (`crypto.js` signP2pkhInput, Schnorr + SIGHASH_ALL|FORKID) verified
TRUE in `createVirtualMachineBCH2023(true)` (vm.verify = true) — so the
"proven on-chain via a live chipnet broadcast" AGENTS claim is consistent.
Consequence: the Cashonize/Paytaca NULLFAIL must be a PREIMAGE/CONTEXT
mismatch (the wallet signs bytes that differ from the broadcast tx's
sighash preimage), not an invalid algorithm. Before filing the upstream
report, field-diff the wallet's returned signedTransaction hex against the
dapp's unsigned bytes (inputs order/count/sequence, locktime, version,
values) — the sigcheck/sigsweep methodology already covers this.

## Screen/function review COMPLETE (2026-11-15, session 20) — P0/P1 fixed + verified

Full review found the app silently bricked since the Vue 3 migration:
- **ALL `<Button>` clicks were dead** (commit 3914c66): `emits: ['click']`
  declared but never emitted → filtered from attrs fallthrough → all 34
  call sites inert (incl. Setup's create-wallet). Removed + regression test.
- **Vue 3 ignores `beforeDestroy`** (5 files): Splash's 3s timer hijacked
  routes after in-app navigation (the old "modal invisible" race), Send's
  camera and Receive's Fulcrum subscriptions never cleaned up → renamed
  `beforeUnmount` everywhere.
- **Send was dead beyond the buttons**: lowercase `unit: 'bits'` never
  matched sendCrypto's uppercase table (every send → "Send amount is too
  small"); the Amount unit dropdown never propagated; `currentBalance`
  guard referenced a nonexistent computed; `sendState` was never driven
  (spinner/done unreachable); invalid receiver failed silently mid-send;
  the fee FIXME (selection vs recomputed fee) was honored.
- History fiat was $0.00 for every tx (marketPrice never fetched); dark
  mode was unreachable (toggle had no handler AND getDarkMode read a
  nonexistent `system.state.dm` — now persisted in `profile.f.dm`);
  destroy() leaked pool.sealed/leaves (now reset via pool/resetPool).
- Verified: apecsdev VM — 129/129 tests + clean vite build + bundle lacks
  the emits declaration; blackhost VPS — headless-Chrome click-through
  (splash → create wallet → switcher → dashboard → send → dark-mode toggle
  → receive → WC deep-link modal; zero functional pageerrors). Commit
  `160e850`.
- P2 review items ALSO completed (same session): Earn's interest interval
  now cleared on unmount; Spend's paste flow completed (parses → Concierge
  popup shows the parsed outputs → confirm prefills Send via `?to=`);
  Transaction popup explorer link is network-aware (chaingraph.cash, was
  hardcoded explorer.bitcoin.com); Popup/Transaction escape handlers are
  now add/removeEventListener (the `document.onkeydown` assignments
  clobbered each other); activateAccounts/activateInputs are documented
  no-ops (they threw on any dispatch); Setup `?scan=` now routes to Send
  (dead 'pay' route) and Send calls initScanData + prefills `?to=`;
  **currency selector is functional** (Dropdown now emits `select`,
  profile.fc persists it, getBalance/History/Amount read it — previously
  the Dropdown never notified its parent AND getBalance hardcoded 'USD');
  **notifications toggle is functional** (persisted flag `f.bn`, requests
  browser permission on enable, openConn spawns a browser notification on
  incoming payments while the tab is hidden; "restart Spark" copy fixed);
  **real backup path exists** — Settings → Wallet → Create SeedVault opens
  a popup with the wallet's 24-word BIP39 recovery phrase (copy button).
- Verified (final): apecsdev — 130/130 tests + clean build; blackhost —
  extended headless-Chrome smoke incl. SeedVault popup, currency switch
  to EUR, notifications toggle; zero pageerrors. Pushed → CI deploys.
- Debug instrumentation is LIVE in the WC flow (funded-UTXO set, unsigned
  hex, signed hex + hash console logs) — remove once the wallet signing is
  fixed. Any new code reading a binding must sit BELOW its declaration (two
  separate self-referential TDZ bugs bit this flow; both prod-only).
- The screen/function review agenda is COMPLETE (see the section above);
  the visual-baseline harness + the overlap auditor + the contrast auditor
  remain the QA gates for future UI work.

## Concierge Desk MOCKUP (2026-11-22) — CashFusion + P2P-over-Nostr

`#/concierge` now opens a **hotel-style front desk** instead of the old placeholder Lobby. The
Lobby tab is renamed **Desk** (`Concierge.vue` `tab: 'Desk'`, `tabs: ['Desk','Earn','Spend']`);
the component stays `views/Concierge/Lobby.vue` so imports/routes are unchanged. Commits
`946cea8` (feature) + `3495839` (tests); CI green on the tip run 45029875758.

**It is a MOCKUP.** Nothing contacts a relay, coordinator or chain; the only side effects are
local `displayNotification` toasts. Every figure is transcribed from published research:

- **Canonical research source: `https://hushyourmoney.com/research/cashfusion`** (topic 02 of the
  5-topic hub; anchors `#six-phases`, `#gate-evidence`, `#boundary`).
- `/research/nostr-fusion` was **retired** by hushyourmoney commit `7b7c417` (608-line page
  deleted, 301 → `/research/cashfusion`, `web/nuxt.config.ts:94`). The local dev server on
  `http://127.0.0.1:3100` serves the CURRENT tree and 301s; **production was still serving the
  old standalone page (HTTP 200) on 2026-11-22** — i.e. production lagged origin there. Do not
  cite the standalone URL as canonical. `/research/nostr-relay` is **404** (it never existed).
- Numbers on the desk (verified byte-identical in the merged page, grep counts ≥1): 5-party
  G3 `10 in / 10 out · 1,760 B · fee 5,000 sats · 10/10 signatures`; 7-party `14/14`; chipnet
  G2b `428 B · 2,000 sats ≈ 4.7 sat/B`; G1 relays `damus.io + nos.lol` (1/2 connected); 80 ms
  publish pacing; MIN_PARTICIPANTS=5; kind-22230 discovery design-only; NIP-42 AUTH missing;
  **G4 (mainnet opt-in beta) NOT built**.
- In-wallet truth: no fusion/Nostr client exists. The only CashFusion mention in `apps/web/src`
  is the `(f) Fusion` ACCOUNT STATUS CODE (`store/modules/wallets/actions/createWallet.js:19`)
  and the TOR TODO at `:34-36`.

**The demo round** ("Request a round") is a fully local timed simulation: 900 ms "asking" →
peers seat one per 400 ms (5 = the design floor; the first/lowest pubkey tags itself
coordinator) → six phases tick at 1300 ms → settles with the measured G3 numbers →
"Reset the demo". `requestState`: `null → 'asking' → 'round' → 'done'`; `roundPhase` starts at
**−1**, so settling needs **7** ticks (−1 → 6). All three timers (`roundTimer`, `peerTimer`,
`phaseTimer`) are cleared in `beforeUnmount` AND `resetRound`.

### THE FLEX-SHRINK COLLAPSE (bit twice — read before adding sections)

The desk `<main>` is a **fixed-height flex column** (`h-[calc(100vh-58px-65px)]` +
`overflow-y-auto`). When its content overflows, flex-shrink squishes the children — and any
child with `overflow-hidden` collapses to its **automatic minimum size of ZERO**. Measured: the
brass plaque and the round table rendered at **2px** (borders only), were invisible, and
`scrollIntoView` could never reach them, which silently produced duplicate screenshots.
**Every direct child section of that `<main>` that uses `overflow-hidden` needs `shrink-0`.**
Post-fix the round table measures 421px (header 54 + seating 116 + phases 249).

### Verification notes for UI work here

- `scripts/visual-baseline.mjs` needs a **system Chrome**. The `apecsdev` VM HAS one since
  2026-11-22 — a **portable, no-root install** (`sudo` there needs a password):
  `wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb` →
  `dpkg -x google-chrome-stable_current_amd64.deb ~/apps/chrome-portable` → binary
  `~/apps/chrome-portable/opt/google/chrome/chrome` (verified 158.0.8127.36, `ldd` reports
  no missing libs on elementary OS 8; the harness already passes `--no-sandbox`). Run the
  gate ON the VM: `pnpm build && cd apps/web &&
  CHROME_BIN=~/apps/chrome-portable/opt/google/chrome/chrome node scripts/visual-baseline.mjs
  capture|compare`. Baseline re-captured 2026-11-22 (22 PNGs, all 11 routes × light/dark)
  after the Desk/Earn/Spend redesigns; `blackhost` still has no Chrome.
  The dev host also has `/usr/bin/google-chrome`; the cross-machine recipe still works:
  **build on the VM**, rsync `apps/web/dist-vite/` back, then drive it locally with
  `puppeteer-core` (present in `apps/web/node_modules`) against a tiny static server —
  a static serve + browser run, **not** a build, so the no-build-on-this-host rule is respected.
- **CSS `text-transform: uppercase` IS reflected in `innerText`.** Screenshot/DOM probes must
  match case-insensitively ("TONIGHT'S ITINERARY" vs "Tonight") or they silently miss sections.
- `document.querySelector('main')` grabs **Notification.vue's `<main>`** first, not the view's.
  Select by content: `[...document.querySelectorAll('main')].find(m => m.innerText.includes(...))`.
- **`scrollIntoView` did not move the scroll container** here; set `main.scrollTop` directly
  (relative to `getBoundingClientRect().top`) and confirm with `document.elementFromPoint`.
- The `Button` stub in tests must declare + render its **`label` PROP** — the real Button
  renders `label`, not slot content, so a slot-only stub shows no button text.

### Demo artifacts (gitignored, local only)

`NOTES/concierge-desk-demo/` — 10 screenshots (phone light/dark × desk/dossier/round/settled
+ one 1280×900 desktop), `README.md` (click-through script + sources), and `serve.mjs`
(`node NOTES/concierge-desk-demo/serve.mjs <distDir> 5493` → `http://127.0.0.1:5493/#/concierge`).
`NOTES` is gitignored (`.gitignore:25`), so these never ship. Live demo: `https://nito.cash/#/concierge`.

### Concurrent-session hazard (2026-11-22)

Other workstreams commit to this same checkout (a `pool/carrier.js` + `pool-carrier.spec.js`
feature landed mid-session as `07cf5f2` / `60c92ca`). **Stage explicit paths only** — never
`git add -A` / `git commit -a` — and re-read `git status` right before committing. `git fetch`
before pushing; a push can be rejected because the other session moved `master`.

## Concierge Earn + Spend MOCKUPs (2026-11-22) — Vault Desk + Courier Desk

The two placeholder tabs are now hotel-style mockups too, under the same contract as the Desk:
every figure is transcribed from published research, nothing contacts a relay/coordinator/chain,
the only side effects are local `displayNotification` toasts, Tailwind-only, `shrink-0` on every
`overflow-hidden` child of the fixed-height flex `<main>`. With the Desk covering topic 02, the
three tabs now transcribe the whole 5-topic hushyourmoney research hub:
Desk = 02 · Earn = 01a + 05 · Spend = 03 + 04.

- **Earn — The Vault Desk** (`views/Concierge/Earn.vue`, suite doors `01a` + `05`): plaque +
  house rules; suite 01a "The Shielded Pool" (status `Chipnet · mainnet demo`) opens the **vault
  ledger** dossier — itinerary SHIELD → TRANSFER → UNSHIELD (all `Confirmed`; 3 chained
  transfers in ONE block 329764), house register (183,472 / 186,007 multi-asset constraints,
  2 public inputs, 35,626 B verifier, 26/26 red-team rejections, 16.967 s proof,
  ~36.8–37.8 KB pool op), DO NOT DISTURB (1-of-1 demo-grade mainnet matrix, no audits yet,
  per-category conservation, no network-layer coverage), "In this wallet" wiring state (note
  library + seal wired; shield/transfer/unshield UI pending), canonical links
  `/research/shielded-pool` + `#evidence`; suite 05 "The Hush Ceremony" (`In design`) links to
  `https://hushyourmoney.com/ceremony` (that page marks its own monitor figures `[demo]`).
  **Preserved verbatim:** the interest counter (`interestInterval` 100 ms, cleared in
  `beforeUnmount`), `interestCore`/`interestRunning`, `addFunds`/`withdrawFunds` (console.log
  kept; mockup toast ADDED), `isInvested`. The placeholder DeFi figures ("4.73%", "$914.20")
  were REPLACED; the counter stays as the honest "house counter" local demo.
- **Spend — The Courier Desk** (`views/Concierge/Spend.vue`, suite doors `03` + `04`): the REAL
  paste-drop (payment processor) stays front and centre — every `handlePastedNote` debug log
  preserved; suites 03 "Shielded Addresses" (`External survey`) opens the **dossier** (scheme rows
  — scan/spend keys `m/44'/145'/0'/2'/…`, tweak `c = SHA256( SHA256(ECDH_x) ‖ outpoint )`,
  `P_stealth = B + c·G`, the scan loop — plus the "where it meets the pool" design direction
  and the topic-1773 report link) and 04 "CoinJoin" (`Live on BCH`) links to `/research/coinjoin`.
  **Preserved verbatim:** the whole paste flow (popup, `acceptNote` → Send `?to=`),
  `shopping`/`giving` (console.log kept; mockup toast ADDED), `hasFunds`, `loadAdvancedSpending`,
  both getter mappings.
- Tests: `tests/unit/concierge-earn-spend.spec.js` — 18 specs (45 suites / 424 tests total,
  91.2% lines) pinning rendering, data-model transcriptions, ledger/dossier toggles, tone maps,
  the preserved interest-counter timer (fake timers: ticks while mounted, stops on unmount) and
  the full paste flow (valid note → popup → Send prefilled; unparseable → error action; no
  address → no navigation). Verified on the apecsdev VM (build + `vitest run --coverage` green)
  + a headless-Chrome DOM probe of the built bundle (34/34 content assertions, ZERO page errors).
- The `TAB_CLICK` screenshots in `scripts/visual-baseline.mjs` (concierge-earn / concierge-spend)
  still switch tabs by button text — the tab names are unchanged, so no harness edit was needed.

### Suite flakes (2026-11-22 carry-over, status)

- `lib-misc.spec.js > lib/bch/discovery > is bounded by DISCOVERY_MAX_BATCHES` does 200 real
  HD derivations (~7.3 s alone) and timed out at the 20 s default under parallel load on the VM.
  Fixed with a **60 s per-test timeout** (`it(..., 60000)` — zero logic change). Passes in
  isolation, on CI, and in the full VM run.
- The `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was
  pending` (from `components-misc.spec.js`, one occurrence) remains **environmental** — not
  app code, passes in isolation and on CI; do not chase it in app sources.
- `pool-carrier.spec.js` (3 failures on one 2026-11-22 VM sync, passed on CI at `60c92ca`)
  did **NOT recur**: 16/16 in isolation + in the full VM suite on the current tree.
- CI-only flake (2026-11-22, resolved): the pool-builder's 5-fixture byte-exact sweep (5 × ~4-8 s
  of noble-curves pairing math) crowded the 2-core CI runner and tripped the DISCOVERY test above.
  Fixed by PINNING the test to fixture 0 (the verified vectors generator) — commit 6197668, CI green.
  Keep heavy multi-second crypto tests off full-suite parallel paths; the ~37 KB noble bn254
  witness computation is the heaviest thing in the suite.

## Conventions & Rules for Agents

- **No guessing.** Verify every claim against the actual files; cite `path:line`. If a fact
  cannot be confirmed, state that explicitly rather than inferring.
- **Minimum-diff, logic-preserving edits.** Keep 1:1 logic parity; do not delete comments,
  FIXMEs, debug blocks, or fallbacks for brevity. Preserve existing blank lines.
- **Don't hand-edit generated/lock files** (`pnpm-lock.yaml`, `src/compiled-icons/*`).
- **Relative base path** — the app is built for static hosting; keep the relative base so it can
  be served from any sub-path (relevant to the Vite `base: './'` config during migration).
- **Secrets** — the GlitchTip DSN lives in `src/plugins/glitchtip.js`; a Sentry/GlitchTip DSN is a
  client-side (public) event-submission identifier — don't rotate/expose it unnecessarily.
