<!-- apps/blaze/README.md -->

# @nito.cash/blaze — BCH BLAZE 2026 submission page

The public submission page for the BCH Blaze 2026 hackathon, served at
**`blaze.nito.cash`** (Cloudflare Pages project `blaze-nito-cash`).

- Single static file: `index.html` (no build step, no dependencies, no
  external requests — inline CSS/JS only).
- Carries the three Mainnet-Track banner elements required by the event brief:
  the Widget Factory presentation link, the source-repo link, and the
  EMBER2026 CashTokens donation address (Community Choice voting), plus
  verified on-chain chipnet evidence links.
- Deployed by CI (`.github/workflows/ci.yml`, `deploy` job) via Wrangler
  Direct Upload — same pattern as the web wallet (`nitocash`) and docs
  (`nito-cash-docs`). The `blaze.nito.cash` custom-domain binding on the
  Pages project is a one-time Cloudflare-dashboard step.

Manual deploy (from a machine with Cloudflare auth):

```bash
wrangler pages deploy apps/blaze --project-name=blaze-nito-cash
```
