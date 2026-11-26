# Concierge — video-demo handoff (2026-11-26)

**Purpose:** record the Concierge video demo. The remaining "MOCKUP" badges/ribbons/toasts
are gone — every visible label now states the real status (Live / Preview / Soon). The
role-2 shielded pool is LIVE (the browser acceptance passed: SHIELD `1ca58773…` →
TRANSFER `50644d00…` → UNSHIELD `f52008f4…`), so the Earn suite can be shown as a real
deployment.

## 1. Status matrix (what the demo shows)

| Tab | Element | Status | Notes |
|---|---|---|---|
| Desk | landing ribbon | **Live desk** | was "Mockup" |
| Desk | 03 CashShuffle | **LIVE** (opt-in relay) | protocol core + NIP-59/NIP-44 v2 + NIP-42 AUTH + the round runner; the local round + the live relay section |
| Desk | 02 CashFusion | **DESIGN PREVIEW** | the round-table simulation; "design preview · no relay contacted" |
| Desk | 01 Quantumroot | **PREVIEW** | the orchestration simulation |
| Persona | CashCode | **LIVE** | the master-seed derivation + the Fulcrum RPA scan; resolve any `name#disc` |
| Persona | CashID | **LIVE** | the challenge → the tweaked-key signature |
| Persona | Register | **PREVIEW / soon** | the commitment + profile OP_RETURN derived; the broadcast awaits the covenant |
| Persona | Nostr publish | **PREVIEW / soon** | the `nostr_seed` derivation shown; the publish awaits |
| Earn | ribbon | **Pool live** | was "Mockup" |
| Earn | 01a Shielded Pool | **LIVE** | the acceptance txids; the measured research figures |
| Earn | "In this wallet" | **LIVE** | the shield/transfer/unshield flows in the Wallet view |
| Earn | 05 Hush Ceremony | design preview | the ceremony page's own `[demo]` figures |
| Earn | interest counter | local demo | preserved verbatim |
| Spend | ribbon | **Paste-drop live** | was "Mockup" |
| Spend | paste-drop | **LIVE** | the bch-rpa CashCode note parse → the Send prefill |
| Spend | 03 Shielded Addresses | design preview | the scheme dossier |
| Spend | 04 CoinJoin | design preview | the research dossier |

## 2. The label changes (exact)

- `Lobby.vue`: ribbon `Mockup` → `Live desk`; the plaque "Both services are mockups…" →
  "CashShuffle runs live over Nostr; the other doors are previews…"; the CashShuffle card
  `Protocol core live · transport next` → `Live · NIP-42 relay opt-in`; the CashFusion
  `Mockup · no relay contacted` → `Design preview · no relay contacted`; the round table
  `Mockup` → `Design preview`; the toasts re-worded.
- `Quantumroot.vue`: `Mockup` → `Preview` (the badge + the notice + the toasts).
- `Earn.vue`: ribbon `Mockup` → `Pool live`; the plaque + the house rules re-worded; the
  "In this wallet" text now says the flows are live (the acceptance txids); the toasts
  `mockup` → `preview`/`demo`.
- `Spend.vue`: ribbon `Mockup` → `Paste-drop live`; the house rules re-worded; the toasts
  `mockup` → `preview`.
- `Persona.vue`: the header comment now says CashCode/CashID LIVE + the rest PREVIEW; the
  `REGISTER — MOCK` / `NOSTR — MOCK` comments → `PREVIEW`.

Labels/toasts only — 1:1 logic parity. The `concierge-*` specs updated to the new
strings (57/57 in the five Concierge suites; 73 files / 684 tests full-suite green; the
build clean).

## 3. The video-demo script (click-through)

1. `#/concierge` — the Desk landing ("Live desk"): the three doors.
2. Desk → **03 CashShuffle** ("Protocol live"): the phase rail, Open round → Announce →
   Shuffle → Sign → Broadcast; then Blame #5 (the abort); then the live relay section
   (Connect → Join → the phases) — the opt-in, NIP-42 AUTH.
3. Desk → **02 CashFusion** ("Nostr only"): the six-phase itinerary + the round-table
   simulation (Request a round) + the dossier.
4. Desk → **01 Quantumroot** ("Developer preview"): the orchestration preview.
5. **Persona**: the CashCode card (resolve `Kallisti#7B9A` — the live fixture
   `8267bff0…`, block 978459); the CashID card (paste a `cashid:…` challenge → Sign);
   the Register preview (the commitment + OP_RETURN) + the Nostr preview.
6. **Earn** ("Pool live"): suite 01a — the vault ledger (the live txids SHIELD
   `1ca58773…` → TRANSFER `50644d00…` → UNSHIELD `f52008f4…`), the house register, the
   "In this wallet" note, the canonical links; the Hush Ceremony suite.
7. **Spend** ("Paste-drop live"): paste a CashCode note → the parse → the Send prefill;
   the two suite dossiers.
8. The Wallet view (`#/wallets/nito-cash`) — optional: the role-2 pool card (the blanks /
   the vending price) + the live Shield/Transfer/Unshield flows.

Recording recipe: the portable Chrome on the apecsdev VM
(`~/apps/chrome-portable/opt/google/chrome/chrome`) or the dev host's
`/usr/bin/google-chrome` against a locally served `dist-vite` (the
`scripts/visual-baseline.mjs` server pattern; the `NOTES/concierge-desk-demo/serve.mjs`
helper).

## 4. What is left to complete the Concierge (the real features)

1. **Desk — CashFusion protocol.** The design is final (Nostr only; NIP-59 + NIP-44 v2;
   the self-elected coordinator; the six phases; `MIN_PARTICIPANTS=5`; kind-22230
   discovery design-only). Not implemented: the CashFusion round runner (the CashShuffle
   one exists), the fusion transaction builder, the G4 mainnet gate. The existing
   CashFusion pool is explicitly NOT supported.
2. **Desk — Quantumroot.** The orchestration design (LM-OTS vaults, the 400+ address
   sweep). Not implemented: the vault scripts, the sweep builder, the funding.
3. **Desk — the real multi-peer CashShuffle round.** The transport + the runner are live,
   but a real 5-party round needs the daemons deployed on `blackhost` (Hush-owned host
   sign-off; the M1–M4 cores are implemented and tested, nothing deployed).
4. **Persona — the registration covenant.** The CashScript artifact (the Genesis 177 B /
   Identity 197 B / Migration Guard 109 B / ticket 165 B), the pre-broadcast VM gate, the
   deploy; then the Register button goes live.
5. **Persona — the Nostr binding.** The `nostr_seed = HMAC-SHA512(bip39_seed,
   "CashAccounts/Nostr" ‖ categoryId)` derivation + the kind-0 profile publish; the
   library module exists (`lib/cashaccount/nostr.js`).
6. **Earn — the PUSD Stability Pool.** The actual Earn product (deposit PUSD, earn the
   liquidation proceeds); the Vault Desk is the research display. Then the AnyHedge lend
   side.
7. **Spend — CardsRelay.** The card-payment rail; the shielded-addresses scheme (topic
   03) and the CoinJoin (topic 04) implementations.

## 5. Verification

- The label pass: the five Concierge suites 57/57; the full suite 73 files / 684 tests
  green (the coverage gate included); the `vite build` clean.
- The role-2 pool: the browser acceptance passed (the three txids above); the registry
  `chipnet-pusd-role2` is `walletProverCompatible: true` / `status: 'live'`; CI green.
- The CashShuffle: the protocol + transport + NIP-42 specs green (the 7 transport specs).

## 6. Open items / blockers

- The `blackhost` daemon deployment (Hush) — the real multi-peer round.
- The production relay set + `NOSTR_AUTH_POLICY` (currently the opt-in relays).
- The Persona covenant artifact (the build-host compile + the VM gate).
- The video assets (the recording + the captions).
