# @nito.cash/demo — demo.nito.cash

The public demo portal: a guided, fully-automated walkthrough of the wallet and
a "try it yourself" mode that runs the **real app** in a phone frame.

## How it works

The portal is a small Vite + Vue 3 site. `scripts/copy-app.mjs` copies the
built wallet (`apps/web/dist-vite`) into `dist/app/`, and the portal frames it
**same-origin**. Same-origin is the mechanism: the tour reaches into
`iframe.contentWindow` and uses two seams that already ship in the wallet:

| Seam | Where | What it does |
| ---- | ----- | ------------ |
| `globalThis.__nito_store_facade__` | `apps/web/src/store/index.js:280` | `$store`-compatible facade: commit the profile seed, dispatch `wallets/createWallet` |
| `globalThis.__NITO_MOCK_CLUSTER__[networkId]` | `apps/web/src/lib/bch/provider.js:305` | deterministic mock chain: every balance / history / broadcast call is local |

No app change is required, and no real network call is made by the demo wallet.
The fixture (`src/lib/demo.js`) is the same fixed test seed the walkthrough
video used: 1.6 BCH, three history rows, a no-op broadcast. It has never held
funds.

The copied `index.html` gets `noindex` and its Matomo block removed, so the
framed app does not report into the production analytics site.

## Chapters

`src/lib/tour.js` — Dashboard, Receive, Send, History, Concierge Desk (runs the
local five-party CashFusion simulation), Vault Desk (the shielded-pool
evidence). Each chapter has an autoplay dwell and a Try-mode hint.

## Develop

The portal needs the wallet build next to it:

```bash
pnpm install
pnpm --filter @nito.cash/web build
pnpm --filter @nito.cash/demo build     # vite build + copy-app
pnpm --filter @nito.cash/demo preview   # http://127.0.0.1:4173
```

`pnpm --filter @nito.cash/demo dev` serves the portal, but `/app/` is only
present after `build` (or after copying `apps/web/dist-vite` into
`apps/demo/public/app/` manually).

## Build & deploy

`pnpm build` (root) builds the wallet first; CI then builds the demo and
uploads `apps/demo/dist` as `demo-dist`. The deploy job pushes it to the
Cloudflare Pages project **`nitocash-demo`** (Direct Upload, same as
`nitocash` / `nitocash-blaze`).

Project `nitocash-demo` was created 2026-11-25 (account
`38907316ed118886fa8035039f92056d`); the first deployment is live at
`https://nitocash-demo.pages.dev`.

`demo.nito.cash` is added to the project (status `pending`): the zone needs a
proxied CNAME `demo` → `nitocash-demo.pages.dev`. The apecsdev token can manage
Pages but has no DNS:Edit, so the record is a one-time dashboard step; the
certificate then issues automatically.
