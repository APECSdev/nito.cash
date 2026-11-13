<!-- apps/blaze/README.md -->

# @nito.cash/blaze — BCH BLAZE 2026 submission page

The public submission page for the BCH Blaze 2026 hackathon, served at
**`blaze.nito.cash`** (Cloudflare Pages project `blaze-nito-cash`).

- Static files, no build step, no dependencies, no external requests
  (inline CSS/JS only): `index.html` (landing) and `deck.html` — a **mock
  Widget Factory deck** (7 slides, event-template structure) standing in
  until the published Google Slides deck copy replaces it (then re-point
  the Deck links in `BlazeBanner.vue` + `index.html`).
- Carries the three Mainnet-Track banner elements required by the event brief:
  the Widget Factory presentation link, the source-repo link, and the
  EMBER2026 CashTokens donation address (Community Choice voting), plus
  verified on-chain chipnet evidence links.
- Deployed by CI (`.github/workflows/ci.yml`, `deploy` job) via Wrangler
  Direct Upload — same pattern as the web wallet (`nitocash`) and docs
  (`nito-cash-docs`). The `blaze.nito.cash` custom-domain binding on the
  Pages project is a one-time Cloudflare-dashboard step.

## One-time project setup (required before the first CI deploy)

CI's non-interactive wrangler does NOT auto-create missing Pages projects —
it fails with `Project not found … [code: 8000007]` (this is what has been
breaking the docs deploy since the `nito-cash-docs` project was deleted on
or around 2026-10-27). Create the projects once, from a machine with
Cloudflare auth:

```bash
npx wrangler login
npx wrangler pages project create blaze-nito-cash --production-branch=master
npx wrangler pages project create nito-cash-docs   --production-branch=master   # if restoring docs
```

Then re-run the failed CI `deploy` job (Actions → ci → Re-run failed jobs) —
no new push needed. Finally bind the custom domains (one-time, dashboard):
project → **Custom domains** → Set up a custom domain → `blaze.nito.cash`
(and `docs.nito.cash` for the docs project) — Cloudflare auto-adds the CNAME
and certificate for same-account zones.

Manual deploy (from a machine with Cloudflare auth):

```bash
wrangler pages deploy apps/blaze --project-name=blaze-nito-cash
```
