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
| Framework      | `vue@2.6.11` (Vue 2, **EOL**)               | Migration to Vue 3 is IN PROGRESS (see below).    |
| Build tool     | `@vue/cli-service@4.2.3` (webpack 4)        | Being replaced by Vite in the migration.          |
| State          | `vuex@3.1.2` + `vuex-persistedstate@2.7.1`  | Persisted to cookies; msgpack-serialized.          |
| Routing        | `vue-router@3.1.6` (hash mode)              |                                                   |
| i18n           | `vue-i18n@8.16.0`                           | Locales in `src/i18n/`.                            |
| Icons          | `vue-svgicon@3.2.6` + `src/compiled-icons/` | Generated from `svg-icons/` via `generate-icons`. |
| Ledger (HW)    | `@ledgerhq/hw-app-btc@11.6.0`, `@ledgerhq/hw-transport-webusb@6.35.0` | See "Ledger Integration" below. |
| Testing        | `@vue/test-utils@1.0.0-beta.31` + Jest      | `tests/unit/`; being migrated to Vitest.          |

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

> **Caveat — `core-js`:** `@vue/cli-service@4` (Babel) auto-injects `core-js` polyfill imports
> at build time even though no source file imports it directly. Removing `core-js` breaks the
> current Vue-2/webpack build with 62 "core-js/modules/* not found" errors. `core-js` has
> therefore been **kept/restored** and must remain until the Vite migration removes the
> Babel/cli-service toolchain — only then is it safe to drop. (See "Build & Verify".)

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

Deployment (e.g. Cloudflare Pages) runs `pnpm install --frozen-lockfile`; if `package.json`
and `pnpm-lock.yaml` disagree, the deploy fails with "The lockfile would have been modified by
this install." Always commit an updated `pnpm-lock.yaml` alongside any `package.json` change.

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

## In-Flight: Vue 3 Migration

A migration is underway (approved plan): **Vue 3 + Vite + Pinia + vue-router 4 + vue-i18n 11 + Vitest.**
Key mappings: Vuex → Pinia (`mapGetters`/`mapActions` → `mapState`/`mapActions` on Pinia stores),
vue-svgicon → a small global `<svgicon>` plugin, `process.env.VUE_APP_*` → `import.meta.env.VITE_*`,
Jest → Vitest. Until it lands, the codebase above (Vue 2 + cli-service) is the buildable truth.

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
