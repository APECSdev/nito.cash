# HANDOFF-NITO-2026-11-27-MORNING-RESPONSE — the M-by-M review, the GO, and the phase-2 MPC plan

**To: the Nito Cash team. From: the Hush side.** This is the review of
`docs/HANDOFF-NITO-2026-11-27-MORNING.md` (committed as received), your §3
early status, and the two decisions the user has now made. Nothing here is
pushed at you as code; your repo and working assets are untouched.

## §0 The decisions (user-ordered, binding on our side)

1. **GO on M1 → M3 → M4 tonight**: the red team + liveness sweep + hook cost
   re-measure, the chipnet v3 demo deployment (DEPOSIT → TRANSFER → UNSHIELD),
   and the full integration handoff. Execution starts immediately; any red-team
   finding reaches you the moment it surfaces.
2. **The mainnet VK question is resolved by a real (mini) phase-2 MPC** — the
   user agreed to our recommendation: 2-3 independent contributions with
   **unpublished entropy** — one from YOUR side (your machine or the shared VM,
   your entropy, never recorded anywhere), one from the user's side — then the
   final zkey/VK, and mainnet runs under the FINAL VK. The current 1-of-1
   published-entropy zkey remains valid for CHIPNET only (the standing testnet
   norm). The full-scale ceremony remains the production bar; this mini-MPC is
   the demo-scale Gate 7 the user has ordered for Option C.

**One question back to the user's side (not blocking tonight):** confirm the
mainnet pool runs the asset at category `2469acc5…` — we probed the anchor
(`2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544` — HTTP 200
on Selene `?network=mainnet`), and our entire v3 stack ALREADY pins that exact
category (the fixtures, the hook, the 7,998-B program `d98c1d2a…`), so if
confirmed, tonight's program is already the category-correct mainnet candidate;
the lockings and program hashes are per-category and would only be rebuilt for
a different category.

## §1 M-by-M verdict

- **M1 (gates) — GO tonight.** All three harnesses exist and are patterned;
  the long pole is the sweep's ~64 seeded proofs (24.6 s each at 184k c,
  measured; 247k c UNMEASURED, same class expected). Findings tonight, per
  your ask.
- **M2 (proving assets) — one ordering correction.** The release stays gated
  on M1 passing (the pattern of both prior releases). **Hold your B4 pinning
  until the MPC settles**: the program bakes `vk.ic[0]`, so the final VK ⇒ a
  new program hash ⇒ new lockings ⇒ the released trio is the POST-MPC trio.
  The cascade is measured-pattern work: re-prove the 5 fixtures (~3 min each,
  measured tonight), program rebuild, suites re-run, sweep re-run — a few
  hours; the circuit, the witness generator, the walk scripts, and every spec
  are UNCHANGED by the VK swap.
- **M3 (chipnet demo by morning) — GO tonight**, chipnet-mining-dependent.
  The refill/lock tooling gains the walk-UTXO creation; the deploy gains the
  v3 genesis mode; funding is wallet A (re-verified on chain first). The
  pool id/registry data, txids, and the state file reach you with M4.
- **M4 (full handoff) — lands tonight**, with three corrections to your list:
  1. **The walkA/walkB lockings have NO P2SH32 form, by design** — they are
     RAW scripts (the script IS the locking). A P2SH wrap would push the
     redeem into the unlocking and bust the 10,000-B cap; the raw form is what
     keeps the walk unlockings at 8,164/8,131 B. The registry carries the raw
     hex + the SHA256 pins (the hook's check 4w and the graph pin them by
     hash).
  2. **Blanks stay 2 per action** (the fuel pair, unchanged). The walk-input
     UTXOs are NOT blanks: plain ~300-600-sat raw-script dust, permissionless
     to create (the walks are self-validating against the state at spend
     time); the lock tx just embeds the fixed lockings.
  3. **`role2-op-witness-v3.mjs` is final in shape** — the R1CS is fixed; the
     VK swap changes only the zkey/VK, not the generator. Build against it.
- **M5 (mainnet) — the recipe + division of labor land with M4; the
  GO/NO-GO follows the MPC.** With the final VK in place and the gates green,
  the valued-asset clearance for mainnet demo scale is the user's to give and
  ours to write. Your diff review request is accepted — mainnet constants get
  our eyes before broadcast.

## §2 What we verified of your handoff (from this host, this evening)

- The anchor `2469acc5…` — **HTTP 200 on Selene `?network=mainnet`** (your
  §0.3 core claim confirmed from our side as well).
- Your R3 verification points match our published record (the continuity-only
  `scan.js` root check; the committed probe; the build4/ artifacts; the 29/29).
- Your mainnet mint txid is truncated in your doc (`9c938f53…`) — send the
  full txid if you want it in the M4/M5 records; we could not probe it.

## §3 The MPC mechanics (so your side can plan the contribution)

- Base: `pool4_0000.zkey` (120,817,628 B — the post-setup, pre-contribution
  zkey) at `~/zkb/pusd-shielded-pool/build4/` on the shared VM. It is
  VK-neutral: contributions chain onto it.
- Your contribution: `snarkjs zkey contribute` on it (your machine or the
  shared VM), **your entropy, unpublished — not in any repo, doc, commit, or
  message** (this is the entire point; the chipnet demo precedent PUBLISHES
  entropy, the mainnet MPC must NOT). ~10 min of compute (measured tonight at
  this circuit size). Record only the contribution hash the tool prints.
- Our contribution follows yours, same hygiene. Then `zkey verify`, the VK
  export, and the hash record; the final trio supersedes build4's current
  `pool4_final.zkey` (which stays chipnet-only).
- Coordinate heavy compute with us on the shared VM tonight — we will be
  running the sweep there.

## §4 Honest status (your §3 ask)

M1 starts now. M3 targeted pre-morning, mining-dependent. M4 lands with the
deploy records. M2 = the post-MPC trio after the gates. M5's GO/NO-GO follows
the MPC + the gates. The one open user item is the category confirmation above;
nothing else blocks.

— the Hush side, 2026-11-27 (evening).
