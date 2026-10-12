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
| State          | `vuex@4` + `vuex-persistedstate@4`          | Vue-3-compatible bridge; **Pinia conversion pending** (Phase B-half-2). Persisted to cookies; msgpack-serialized. |
| Routing        | `vue-router@4.6.4` (hash mode)              | `createWebHashHistory` — same `#/...` URLs.        |
| i18n           | `vue-i18n@11.4.14` (`legacy: true`)         | Locales in `src/i18n/`.                            |
| Icons          | Global `<svgicon>` plugin (`src/plugins/svgicon.js`) + `src/compiled-icons/` | Replaces `vue-svgicon`; generated files re-pointed via `compiled-icons/register.js`. |
| Errors         | `@bugsnag/js@9` + `@bugsnag/plugin-vue@9`   | v9 API (`Bugsnag.start` + `app.use(getPlugin('vue'))`). |
| Node polyfill  | `vite-plugin-node-polyfills` + `buffer`     | webpack 4 auto-polyfilled `Buffer`/`process`; Vite needs this for BITBOX + Ledger. |
| Ledger (HW)    | `@ledgerhq/hw-app-btc@11.6.0`, `@ledgerhq/hw-transport-webusb@6.35.0` | See "Ledger Integration" below. |
| Testing        | **PAUSED** — Vitest port is Phase C          | Jest + `@vue/test-utils@1` (Vue 2) are incompatible with the Vue 3 runtime. |

Full dependency list lives in `package.json`; the authoritative lockfile is `pnpm-lock.yaml`.

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
- `pnpm-workspace.yaml` sets `allowBuilds` (core-js, deasync, ejs, yorkie) so `pnpm install`
  is deterministic across pnpm 10 (warns) and pnpm 11 (errors on ignored build scripts).

### Prune unused dependencies

Remove packages that have **zero** real usage. Before removing, verify with a grep over `src/`
and distinguish *actual imports/calls* from *comment mentions* (e.g. `ipfs`, `moment` were only
referenced in comments and were safe to drop). Already removed: `chartist`, `ipfs`, `moment`,
`orbit-db`, `@ledgerhq/hw-app-eth`, `npm`, `crypto-js`.

> **Caveat — `core-js`:** it was a build-time dep of the old `@vue/cli-service@4` (Babel) webpack
> build. **Webpack/cli-service is no longer the production build (Vite is, since Phase B)**, so
> `core-js` is now unused and is a **Phase E removal candidate** along with the rest of the legacy
> toolchain (`vue.config.js`, `babel.config.js`, `jest.config.js`, the Babel plugins, `transpileDependencies`,
> `@vue/cli-*`, `@vue/test-utils@1`, eslint-6 stack). Do not remove piecemeal until Phase E verifies the
> legacy packages have zero remaining references.

## Repository Layout (pnpm monorepo)

This is a pnpm workspace with two packages:

```
apps/
  web/                  @nito.cash/web — the Vue 2 SPA (the Nito.cash wallet), deployed to
                        Cloudflare Pages. All web-app sources/config live here now:
    public/             Static assets + index.html (loads window.BITBOX via public/js/bitbox.js)
    src/
      api/              External API helpers (e.g. telr.js)
      assets/           Styles / images
      compiled-icons/   vue-svgicon icon modules (GENERATED — regenerate, don't hand-edit)
      components/       Reusable UI (inputs/, popups/, etc.)
      i18n/             Locale JSON (en-US, de, fr, zh-CN, zh-HK)
      media/            Audio / media assets
      plugins/          Vue plugins (bugsnag.js, i18n.js)
      router/           vue-router routes
      store/            Vuex store + modules (blockchain, concierge, profile, system, utils, wallets)
      views/            Route-level views (Splash, Setup, Dashboard, Send, Receive, History,
                        Settings, Concierge/*)
      App.vue  main.js
    svg-icons/          Source SVGs for generate-icons
    tests/unit/         Jest unit tests
    package.json  vue.config.js  babel.config.js  jest.config.js  .eslintrc.js
workers/
  prover/               @nito.cash/prover — Halo 2 / Orchard ZK prover, a Cloudflare Worker
                        (Rust→WASM). Vendored from the Sansbank `wasm-prover` project (history
                        dropped). Deployed to the custom domain `prover.nito.cash`.
    src/index.js        Worker entry (imports src/orchard.wasm as a static module)
    src/lib.rs          Rust crate (cdylib) — the prover
    src/orchard.wasm    Committed build artifact (rebuild via scripts/build-wasm.sh)
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
   `pnpm test:unit` (Jest) → upload coverage to **Codecov** (`apps/web/coverage/lcov.info`,
   via `codecov/codecov-action@v5`, secret `CODECOV_TOKEN`) → save `apps/web/dist` as an
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

### Routes (apps/web/src/router/index.js)

`/` Splash · `/setup` · `/dashboard` · `/send` · `/receive` · `/history` · `/settings` ·
`/concierge` · `/concierge/spend/advanced`

## Commands

| Task            | Command                                            |
| --------------- | -------------------------------------------------- |
| Install deps    | `pnpm install`                                     |
| Dev server      | `pnpm run serve`        (sets `VUE_APP_TARGET=all`) |
| Build (all)     | `pnpm run build-for-all`                           |
| Build (nito)    | `pnpm run build-for-nito`                          |
| Lint            | `pnpm run lint`                                    |
| Unit tests      | `pnpm run test:unit`                               |
| Regen icons     | `pnpm run generate-icons`                          |

> There is intentionally **no** plain `build` script; use `build-for-all` or `build-for-nito`.

## Build & Verify

After any dependency or source change, verify before pushing:

```bash
pnpm install --frozen-lockfile --ignore-scripts   # lockfile must be in sync
pnpm run build-for-all                            # must compile cleanly
pnpm run test:unit                                # unit tests must pass
```

CI runs `pnpm install --frozen-lockfile`; if `package.json` and `pnpm-lock.yaml` disagree,
the build fails with "The lockfile would have been modified by this install." Always commit an
updated `pnpm-lock.yaml` alongside any `package.json` change. (Cloudflare Pages no longer
builds from source — see "CI / CD" — but CI enforces the same frozen-lockfile guarantee.)

> **Note — eslint is disabled during builds:** `vue.config.js` sets `lintOnSave: false`. The
> app intentionally uses `console.*` debug logging, and `.eslintrc.js` promotes `no-console`
> to an error when `NODE_ENV=production` (Cloudflare's build env), which failed CI builds.
> Lint remains available as a separate step via `pnpm run lint` rather than gating the build.

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
   access layer (`window.BITBOX`), not via Ledger's own explorer.
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

## Vue 3 Migration (phased) — Phases A & B DONE

Plan: **Vue 3 + Vite + Pinia + vue-router 4 + vue-i18n 11 + Vitest + Tailwind v4**, executed in
verifiable phases. **A (toolchain) and B (runtime flip + Vite-as-production) are DONE and live.**

- **Phase A (done) — toolchain bridge.** `vue@2.6.11 → 2.7.16` then Vite + Tailwind v4 added in
  parallel to webpack (now superseded by Phase B).
- **Phase B (done) — runtime flip + Vite production.** `vue@3.5.43`, `vue-router@4.6.4`
  (`createWebHashHistory`), `vue-i18n@11.4.14` (`legacy: true`), `@bugsnag/js+plugin-vue@9`.
  `main.js` → `createApp`; `router/index.js` → `createRouter`; `plugins/i18n.js` → `createI18n`;
  `plugins/bugsnag.js` → v9 API. **`vue-svgicon` replaced** by `src/plugins/svgicon.js` (global
  `<svgicon>`) + `src/compiled-icons/register.js` shim (generated `compiled-icons/*.js` re-pointed
  at the shim; the 18 `<svgicon>` call sites are unchanged). `Button.vue` declares `emits:['click']`
  so `@click.native` keeps working in Vue 3. `Address.vue` moved to the `modelValue`/`update:modelValue`
  v-model contract. **`vite.config.js`**: `@vitejs/plugin-vue` + `vite-plugin-node-polyfills`
  (`Buffer`/`process`/`global` for BITBOX + Ledger, which webpack 4 used to auto-polyfill).
  **Vite is now the production build** (`pnpm build` → `vite build` → `apps/web/dist-vite/`); CI
  uploads `dist-vite/` and Cloudflare Pages deploys it. Live site confirmed serving the Vue 3 build.

- **Phase B-half-2 (NEXT) — Vuex → Pinia.** The store is currently **Vuex 4** (`createStore`) as a
  Vue-3-compatible bridge so the 50 store sub-files (getters/actions/mutations using the Vuex
  `(state, getters, rootState, rootGetters)` / `({commit})` signatures) work unchanged. Convert all
  6 modules + their sub-files to Pinia `defineStore`, preserving: the short state keys (`as`, `em`,
  `n`, `nm`, `sv`, `a`, `is`, `m`, `f`, `l`, `miv`, `ms`, `q`, `t`), namespacing (5 namespaced
  modules + the deliberately GLOBAL `system` module — `NOTE: We DO NOT namespace...`),
  `vuex-persistedstate` cookie/localStorage behaviour, and the cross-namespace refs
  (`rootGetters['profile/getFlags']` etc. in 5 files). Then rewrite the 12 components'
  `mapGetters`/`mapActions` to idiomatic Pinia `mapState`/`mapActions`.
- **Phase C — Vitest** port of the 17 Jest suites (jsdom canvas/lottie mocks, `@vue/test-utils` v2,
  `@click.native` → Vue 3 equivalent). Restores `pnpm test:unit` + Codecov coverage (currently paused).
- **Phase D — convert scoped CSS → Tailwind** utilities component-by-component.
- **Phase E — remove legacy** (`vue.config.js`, `babel.config.js`, `jest.config.js`, the 4 Babel
  plugins, `transpileDependencies`, `@vue/cli-*`, `@vue/test-utils@1`, eslint-6 stack, core-js).

Key mappings (applied): Vuex → Pinia (`mapGetters`/`mapActions` → `mapState`/`mapActions` on Pinia stores),
vue-svgicon → a small global `<svgicon>` plugin, `process.env.VUE_APP_*` → `import.meta.env.VITE_*`
(vite.config currently shims `process.env` for the still-Vuex store + `App.vue`), Jest → Vitest.

> **Runtime-verification method (used for Phase B):** `puppeteer-core` + system `/usr/bin/google-chrome`
> against a locally-served `dist-vite/`, asserting `#app` mounts with zero `pageerror`s and that splash/
> setup/settings render their `<svgicon>`s. Reusable; see commit `3914c66` / `bf408db` history.

> **Env note (this dev box):** the host has **no IPv6 route**, and pnpm/npm (Node fetch/undici)
> prefer IPv6 and hang. Workaround used for installs: run a **Node-based pnpm 11** with
> `NODE_OPTIONS="--require ~/.local/force-ipv4.cjs"` (a preload forcing `dns.lookup` family=4).
> The default `~/.bun/bin/pnpm` is bun-bundled and ignores `NODE_OPTIONS`; use the nvm Node
> (`~/.nvm/versions/node/v24.18.1/bin`) + `node ~/.local/pnpm11-dist/package/bin/pnpm.cjs`.
> CI/Cloudflare have working IPv6/IPv4 and are unaffected.

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
