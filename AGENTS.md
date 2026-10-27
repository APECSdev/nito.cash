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
| Errors         | `@bugsnag/js@9` + `@bugsnag/plugin-vue@9`   | v9 API (`Bugsnag.start` + `app.use(getPlugin('vue'))`). |
| Node polyfill  | `vite-plugin-node-polyfills` + `buffer`     | webpack 4 auto-polyfilled `Buffer`/`process`; Vite needs this for Ledger (+ any Node builtins in blockchain deps). |
| Ledger (HW)    | `@ledgerhq/hw-app-btc@11.6.0`, `@ledgerhq/hw-transport-webusb@6.35.0` | See "Ledger Integration" below. |
| Testing        | **Vitest** `@5.0.4` + `@vue/test-utils@2.5.1` + jsdom | 17 suites / 86 tests. Jest + `@vue/cli-plugin-unit-jest` REMOVED (Phase C). |

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
    tests/unit/         Vitest unit tests (17 suites / 86 tests)
    vitest.config.js    Vitest config (jsdom, `@` alias, v8 coverage -> coverage/lcov.info)
    package.json  vite.config.js  vitest.config.js  eslint.config.js
  docs/                 @nito.cash/docs — the documentation site (VitePress), deployed to
                        Cloudflare Pages as `docs.nito.cash`. Sources live here:
    .vitepress/         VitePress config (config.mjs) + theme
    *.md                Doc pages (Markdown)
    package.json        docs build/dev scripts (vitepress)
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

The **docs site** (`apps/docs`, VitePress) is deployed to Cloudflare Pages **`docs.nito.cash`**
(project `nito-cash-docs`) the same Direct-Upload way — `pnpm --filter @nito.cash/docs run build` →
`wrangler pages deploy apps/docs/.vitepress/dist --project-name=nito-cash-docs`. It is wired into the
CI `deploy` job alongside the web wallet (or deployable manually from the apecsdev VM).

### Routes (apps/web/src/router/index.js)

`/` Splash · `/setup` · `/dashboard` · `/send` · `/receive` · `/history` · `/settings` ·
`/concierge` · `/concierge/spend/advanced`

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

The flagship new feature: the **first shielded pool for PayonUSD (PUSD) on BCH Chipnet** —
sender, receiver, and amount are all masked. Design decisions locked:

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
  [mr-zwets/groth16_cashscript#26](https://github.com/mr-zwets/groth16_cashscript/pull/26).)
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
  Remaining: Fulcrum + Chaingraph note-detection infra (on the `bch-infra` VPS), then the nito.cash
  wiring (shield/transfer/unshield UI + client-side WASM proving). The **local encrypted note store is DONE**
  (`apps/web/src/lib/pool/seal.js`: AES-256-GCM via WebCrypto, key = sha256 of domain-separated
  wallet entropy; `pool.notes` is a runtime-only mirror excluded from persistence via
  `omit: ['pool.notes']` in the root store's persistedstate config; only the ciphertext
  `pool.sealed` and public `pool.leaves` persist; `pool/unlockPool` runs fire-and-forget at
  boot in `main.js`).
  The **chipnet stand-in CashToken is MINTED** (PUSD is mainnet-only): category
  `479aeebabc682ddb90a3671bffd2a0bd918737de13f19a92231ed36a8580cc11`, 100M fungible
  units + minting NFT, genesis tx `4257dbfb68540cc9afcf569da8e651790c82d3951bdff88f5232a372760ba977`
  (block 328616) via the chipnet.bch.ninja faucet; mint key (test-only, no value) in
  `/Workspace/apecsdev/.secrets/pusd-shielded-pool-chipnet-mint.json`; full details in pusd-shielded-pool
  `README.md`. Two Fulcrum protocol caveats discovered (critical for the wallet wiring):
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
  `vue-router@4.6.4` (`createWebHashHistory`), `vue-i18n@11.4.14` (`legacy: true`), Bugsnag v9
  (`Bugsnag.start` + `app.use(getPlugin('vue'))`). `vue-svgicon` replaced by
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
- **Phase C (done) — Vitest.** 17 suites / 86 tests on Vitest `@5.0.4` + `@vue/test-utils@2.5.1`
  (jsdom, `vitest.config.js`); coverage lcov → `apps/web/coverage/lcov.info`. VTU v2
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

## Conventions & Rules for Agents

- **No guessing.** Verify every claim against the actual files; cite `path:line`. If a fact
  cannot be confirmed, state that explicitly rather than inferring.
- **Minimum-diff, logic-preserving edits.** Keep 1:1 logic parity; do not delete comments,
  FIXMEs, debug blocks, or fallbacks for brevity. Preserve existing blank lines.
- **Don't hand-edit generated/lock files** (`pnpm-lock.yaml`, `src/compiled-icons/*`).
- **Relative base path** — the app is built for static hosting; keep the relative base so it can
  be served from any sub-path (relevant to the Vite `base: './'` config during migration).
- **Secrets** — the Bugsnag API key lives in `src/plugins/bugsnag.js`; treat it as a client-side
  (public) key but don't rotate/expose it unnecessarily.
