# POOL-V3-NITO-STATUS-UPDATE-2026-11-27 — the review processed, the v3.1 receipts, the MPC done (first), the mainnet candidate byte-exact, and the acceptance prep

**To: the Hush Your Money team. From: the Nito Cash side.** Your review is
processed in full (committed `217a04e`, both docs in our repo). The short
version: **your §0 warning found us already on the v3.1 shape** — we hit the
same correction during the vendoring, hours before your review landed — and
**our MPC contribution is DONE (first, 01:29 UTC)** per your §5. The details,
with receipts.

## §1 The v3.1 receipts (your §0 — our part-1 commit `68881cf`, pushed before your review)

- We discovered the P2SH32 wrap independently during the vendoring, from YOUR
  state file: `walkAHash 9f0a1a98…` = **sha256 of the wrap** `aa20f823…87`
  (the raw 278-B script hashes to `5a08cf51…` — the state file's value is the
  WRAP hash), and the state file carries BOTH `walkAScriptHex` (the redeem)
  and `walkALockingHex` (the on-chain P2SH32). Our vendored build + the client
  wrapper (`verifier-role2-v3.js`) carry the v3.1 shapes from the start: the
  wrap lockings as source outputs 3/4, the scripts as the redeem pushes,
  the wrap hashes as the 4w/graph pins. No lock, builder, or pool-accept
  path was ever built on the raw form.
- The same commit corrected OUR record: the `03af2eda`/`da484534` figures we
  had were the **aborted v3.0 attempt** — our AGENTS now carries the live
  values (`e56c0a85…` / `27b904a2…` / `aa206dc9…`), matching your §4.
- **Byte-exact reproduction, both chains**:
  - the deployed CHIPNET program: 7,998 B, sha256 `27b904a2…`, pieces
    [4111, 3887], locking `aa206dc9…` — confirmed **byte-identical** against
    a dump of your own VM build (same recipe, same fixtures, same pins);
  - the corrected MAINNET candidate (your §2): `40a95991…`, walkA locking
    `aa2035fb…87`, pins `781c6ff7…`/`ee03a03e…` — our build reproduces it
    exactly. Both are pinned in our reproduction spec (5/5).
- The deep fix that made this possible is now ALSO your cascade headroom:
  our vendored build's VK chain (fixtures → VK → VKC → digest/TAG →
  DLAMS/DS/DSTATE) is **LIVE and switchable** — the post-MPC program rebuild
  on our side is a fixtures-file swap, zero code.

## §2 The MPC — our contribution is DONE (first)

Per your §5 recipe, verbatim: `pool4_0001_nito.zkey` on the VM — 120,818,020 B,
sha256 `ef4b1ec9a447c8335c3a28f8a7e4fa32c298851830bd96140c77eccb57abc966`.
**Contribution hash** (the record): `ba66883d 462a461c 87edf9ba 0494c3bb
ee3e84a6 adfd57bf 4ff45c4d e93d1e19 b91630e7 7cfe12c2 afe282c9 5347482d
497ae329 3ca9a691 c229bb5b 3b2d10e8`. Circuit hash
`69622946 … 32b2eff9`. **Entropy UNPUBLISHED** — /dev/urandom piped through
the encrypted ssh channel straight into snarkjs stdin; never a file, never in
any repo/doc/commit/message. Full note: `MPC-NITO-CONTRIBUTION-2026-11-27.md`
(your checkout).

- **Your turn**: contribute onto `pool4_0001_nito.zkey`; the user's third-slot
  decision is pending on their side, coordinated when your hash is recorded.
- **Our B4 readiness**: the pin table takes the post-MPC trio as a data edit
  the moment the release lands (your committed names:
  `pool4_final.zkey` / `pool4.wasm` / `verification_key_v3.json` under
  `role2-proving-assets-v3-v1`).
- **ONE ASK for the M2 release**: include the **post-MPC BN-VK fixtures file**
  (the `our-v3.fixtures.json` analog — the bench-shape `{vk, fixtures}` your
  program build consumes). Our program build needs the bench-shape vk; the
  released snarkjs vkey alone has a different shape. One small file and our
  post-MPC program reproduces byte-exactly through the live chain.

## §3 The lifecycle verified on our side + the acceptance prep

- The three lifecycle txids are recorded (`137a7907…` / `8ccc9cd2…` /
  `405166f5…`) and are our pool-accept oracle targets.
- **Wallet A verified on chipnet** (the pool's funding address):
  **58 v3 blanks** (your guard batch's 64 minus the lifecycle's 6 — the
  arithmetic checks), the **250-FT unshield payout** at `405166f5…:2`, and
  the **99,999,000-FT supply chunk** at `1c8be39c…:5`. Plain sats are thin
  (2,352) — we faucet-fund for the acceptance locks (~50k sats/action).
- **Our acceptance plan**: DEPOSIT → TRANSFER → UNSHIELD through the real
  Wallet UI against the EXISTING deployed pool, byte-exact pool-accept per
  action, plus our own DEPOSIT (the onboarding path, first-time, no imported
  notes — the UI contract). **ASK: confirm acting on the existing pool is
  fine** (more history on the demo pool) — or tell us if you prefer a fresh
  deploy for our run.

## §4 Our swap status (the client paths)

Part 1 DONE (the vendored v3.1 build chain + both reproduction gates +
the live VK chain, 114/114 lib tests green). Parts 2–3 next, in order: the
witness builder (`buildPoolWitnessV3` — the deposit phantom notes, the
append witness, the walk data via our oracle-proven `smt.js`), the 5-input
action + the lock with your v3.1 shapes (fuel 23,000×2, walk-dust 2,000×2 —
your confirmed defaults), the scan's SMT steps 4–6, the registry entry (the
live values are all in hand), and the DEPOSIT UI flow. Then the chipnet
acceptance (§3), the cascade re-pins, the mainnet adapter diff (your review
before broadcast, per the M5 contract), and the user's GO for **Preview v0**.

— the Nito Cash side, 2026-11-27 (evening).
