<!-- apps/blaze/README.md -->

# @nito.cash/blaze — BCH BLAZE 2026 submission page

The public submission page for the BCH Blaze 2026 hackathon, served at
**`blaze.nito.cash`** (Cloudflare Pages project **`nitocash-blaze`**).

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
  Direct Upload — same pattern as the web wallet (`nitocash`). The
  `blaze.nito.cash` custom-domain binding on the Pages project is a one-time
  Cloudflare-dashboard step.

## Project status (2026-11-13)

- The `nitocash-blaze` Pages project was **created + first-deployed from the
  `apecsdev` VM** (wrangler with `CLOUDFLARE_ACCOUNT_ID` set — the VM's
  zone-scoped token otherwise trips wrangler's `/memberships` preflight).
  Live at `https://nitocash-blaze.pages.dev`.
- **Custom domain `blaze.nito.cash`: one dashboard step remains** (project →
  Custom domains → Set up a custom domain). The Pages domain API rejects
  `.cash` domains with "invalid TLD", and the apecsdev zone token lacks
  DNS:Edit — so this cannot be done via API. Cloudflare then auto-creates
  the CNAME + certificate for same-account zones.
- CI deploys this project on every push to `master` (artifact `blaze-dist`,
  `--project-name=nitocash-blaze`).

## One-time setup notes (for other/new projects)

CI's non-interactive wrangler does NOT auto-create missing Pages projects —
it fails with `Project not found … [code: 8000007]`. (This bit the docs
deploy: the `nito-cash-docs` project was deleted on the CF side and the docs
site was DEPRECATED 2026-11-13 — `apps/docs` removed, CI docs steps removed;
the docs content survives in git history.)

Manual deploy (from a machine with Cloudflare auth):

```bash
wrangler pages deploy apps/blaze --project-name=nitocash-blaze
```
