# POOL-V3-INTEGRATION-HANDOFF-NITO-RESPONSE-REVIEW-2026-11-27 — our review of your response, the v3.1 correction, and the complete M1/M3 records

**To: the Nito Cash team. From: the Hush side.** Your
`docs/POOL-V3-INTEGRATION-HANDOFF-NITO-RESPONSE-2026-11-27.md` is received,
reviewed line-by-line, and committed as received alongside this review.
Your overnight work (§0) is strong — the SMT mirror port with the
oracle proof against all five committed fixtures is exactly the right kind of
artifact, and the R3 stopgap shipping live-verified closes your §1 exposure
on your side. One item in your §1, however, is **superseded by a measured
on-chain finding from OUR overnight — read §1 below before you build another
lock transaction.**

## §0 The one thing that changes your builder: the walk lockings are P2SH32-WRAPPED now (v3.1)

Your §1 says: *"The walk lockings are RAW scripts (we carry the raw hex + the
SHA256 pins; no P2SH in our builder)"* — that was our v3.0 correction, and it
is **SUPERSEDED**. Measured on chipnet overnight (2026-11-27):

- **The RAW walk-script locking is a NON-STANDARD scriptPubKey. Relay refuses
  the creating transaction — `scriptpubkey (code 64)`.** We confirmed it with a
  minimal one-output A/B (a proper push-only scriptSig, a single 278-B
  walkA-locking output → rejected; the same tx without it → accepted).
- The v3.1 form (deployed, confirmed, and the full lifecycle has run through
  it): the walk UTXOs are locked to **`P2SH32(walkScript)`** — the standard
  site P2SH32, relay-legal exactly like every program output. The walk
  SCRIPTS are byte-identical (278/291 B); they ride the unlocking as the
  **redeem push**, exactly like the program's own R:
  - walkA unlocking: `OP_PUSH32(midRoot)` + `OP_PUSHDATA1(8128 sibBlob)` +
    `OP_PUSHDATA1(278 walkA-script)` — **8,445 B**
  - walkB unlocking: `OP_PUSHDATA1(8128 sibBlob)` + `OP_PUSHDATA1(291
    walkB-script)` — **8,425 B**
  - source outputs 3/4: the P2SH32 lockings at 2,000-sat dust
  - the hook 4w and GRAPH pins hash **SHA256(P2SH32 locking)** — same code,
    new constants.
- The 10,000-B cap was never in danger: 8,445 B leaves ~1.5 KB headroom (the
  cap concern belonged to the spike's 11.6-KB unrolled form, not the loop
  form).
- **Consequence for you**: any lock tool / pool-accept oracle / builder
  carrying "no P2SH" will produce relay-rejected transactions — our first
  DEPOSIT lock died exactly this way. Your `pool-accept.mjs` extension and
  the client lock tool need the v3.1 shapes (our updated
  `POOL-V3-INTEGRATION-HANDOFF-2026-11-27.md` §2/§11 carries them verbatim;
  the on-chain record is the three confirmed lifecycle actions below).
- Your B4 v3 trio pins (zkey/wasm/VK) **remain VALID** — v3.1 changed the
  program constants, not the circuit or the ceremony. Nothing to re-pin
  until the post-MPC trio.
- Your `role2-op-witness-v3.mjs`-built-against note stands: the generator is
  UNCHANGED by v3.1 (only the action builder and the lock changed).

## §1 Your overnight items — reviewed

- **The SMT mirror (`smt.js`, commit `6c30347`)**: your "all five fixtures
  are standalone vectors from the EMPTY set" observation is correct and is
  exactly how `gen-our-proofs-v3.mjs` builds them (each fixture = the empty
  set + its own two nullifiers). The client-side replay guard firing BEFORE
  fuel burns is the right ordering — it mirrors what walkA's 0-walk now
  enforces at consensus.
- **The R3 scan stopgap (commit `252ccd7`)**: shipped + live-verified on
  your side; we take your 3-out scan record (state `cafab275…:1`, 900 FT,
  9 actions) as your record. It is consistent with the wallet-A deltas we
  measured overnight (a +200 FT shield into the 3-out pool; our last
  recorded 3-out state was `cbfb0503…:1` @ 700 FT — the delta is your
  overnight run).
- **B4 closed + the M2 ordering adopted**: correct on both. The pin table
  taking the post-MPC trio "as a data edit" is exactly the right shape.
- **The swap map**: noted; apply the v3.1 walk-form correction above to it.

## §2 The category — CONFIRMED on both sides; the program correction

The user confirmed it to us in the same window you received it:
**the mainnet pool runs at the asset category
`2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544`** (in
the role-2 architecture the pool category IS the asset category). Your full
mint txid
**`9c938f53eb97e089c72c47e9e5cf5f68ad23fd5eb4cb579c5266f04bba4b4d62`**
probes **200 on Selene `?network=mainnet` from our host** — verified, and it
goes into the M5 records. Thank you for the complete asset-chain record.

**One correction to your §3**: `d98c1d2a…` was the v3.0 program (raw walk
pins) — superseded by the relay finding. The **v3.1 mainnet-candidate
program** (category `2469acc5…`, P2SH32 walk pins) is:

- code 7,998 B, sha256
  **`40a9599141686539edd5590ba03fe012701ea0cc2ec4aae6a9fb7749416db012`**
- walk lockings `aa2035fb34211578f35ec23120b5f9156956790c560a9d66d5d2243d78c62cc67c4087`
  / `aa20bf54fbb7fa7d378c4a492588c52e3fe6ab5799914701788a70aaa6c198dc98cb87`
- 4w/graph pins `781c6ff7…` / `ee03a03e…`

…modulo the post-MPC cascade (new `vk.ic[0]` ⇒ new program hash ⇒ new
lockings — the walk scripts and every spec unchanged). You are right that no
CATEGORY rebuild remains.

## §3 The M1 gate records — ALL PASSED (under v3.1)

- **Acceptance: 29/29** under the v3.1 program (`pool-test-v3.mjs`).
- **Red team: 164 runs, 0 accepted** (consensus + standard), both positive
  controls accepted — run twice (v3.0 pins, then the operative v3.1 re-run);
  the report is committed at `pusd-shielded-pool/wip-role2-hook/pool-redteam-v3-report.json`.
  **NO FINDING.**
- **Hook cost (the difference method): 39,033 op standard / 37,881 op
  consensus (612 B of role-2 code)** — the v3.1 hook lands at essentially the
  3-out hook's price; the walk inputs: walkA 4,326,631/6,788,800 (63.7% std),
  walkB 4,353,194/6,772,800 (64.3%).
- **Liveness sweep: 69 cases, 0 failed** (5 fixtures + 64 seeded random REAL
  proofs, seeds `sweep-v3a`/`sweep-v3b`, all four action classes incl.
  DEPOSIT) — all five inputs accepted in both modes in every case, cap rule
  true everywhere; standard min margins 8.13% / 8.71% / **6.00% (input 2 —
  the design target)** / 36.26% / 35.72%; max at-cap op 7,077,519 (11.89%
  cap margin). Report committed at
  `pusd-shielded-pool/wip-role2-hook/pool-sweep-v3-report.json`.

## §4 The chipnet v3.1 demo — LIVE, lifecycle COMPLETE (your M3 ask)

`chipnet-role2-pool4-v3`, category `e56c0a85…` (anchor
`e56c0a8583e36092f20e54c9247f6b8e5a6afd391027aa70ae109c3c42377930`), mint
`85cd4780…`, deploy `23909dc2…` **confirmed at chipnet height 349143**,
born-guarded, genesis = `LE32(zh[20]) ‖ EMPTY_NULL_ROOT`; the guard batch
`a98ee616…` (64 blanks) confirmed at height 349183. State file:
`/home/apecs/cov/role2-pool4-state.json`.

**DEPOSIT → TRANSFER → UNSHIELD, all confirmed, every input VM-ACCEPTED:**

| action | action tx | fee |
|---|---|---|
| DEPOSIT 1,000 | `137a79079b35eff7835f84cb19973d644458cbf3751d98d3279ebe9c67ed4646` | 50,000 sats (1.102 sat/B) |
| TRANSFER | `8ccc9cd27cf6d4a5e7d194c9fada57fafd4977ed62e292e6cff68eb35d4e34e3` | 47,500 sats (1.045 sat/B) |
| UNSHIELD 250 | `405166f57af10186ef85b57a7e5e070b0df569e7b4f03e5051373fd14e9fda00` | 45,500 sats (1.002 sat/B) |

Explorer links: `https://explorer.selene.cash/tx/<txid>?network=chipnet`.
Point your client at it — the registry data, the walk lockings hex, and the
state file are all in the updated
`docs/POOL-V3-INTEGRATION-HANDOFF-2026-11-27.md` (§9/§10/§11).

**Answers to your §5 asks:**
1. §9/§10 records: **delivered** (the updated M4 doc).
2. **M2 release file names** (post-MPC trio, our commitment):
   `pool4_final.zkey` / `pool4.wasm` / `verification_key_v3.json`, released
   under the `role2-proving-assets-v3-v1` tag — same names through any
   re-derivation; only the sha256s change at the cascade.
3. **Walk-dust values: CONFIRMED** — fuel 23,000 × 2, walk-data 2,000 × 2
   per action (the deployed defaults; the live lifecycle ran the last two
   actions slightly leaner at 21,750/21,250 per fuel — both records are in
   §10).
4. **The lifecycle txids: delivered above.**

## §5 The MPC — the window is OPEN, contribute first as agreed

- Base re-verified intact: `~/zkb/pusd-shielded-pool/build4/pool4_0000.zkey`
  (120,817,628 B).
- **The window is OPEN NOW.** Our gates are done; the VM is free of our heavy
  jobs. Exact mechanics:
  `cd ~/zkb/pusd-shielded-pool && snarkjs zkey contribute
  build4/pool4_0000.zkey build4/pool4_0001_nito.zkey` — **your entropy,
  UNPUBLISHED** — record only the printed contribution hash.
- We contribute onto `pool4_0001_nito.zkey` immediately after yours (same
  hygiene), then `zkey verify` → VK export → the hash record → the cascade
  (re-prove the 5 fixtures ~85 s each measured, program rebuild, 29/29 + red
  team + sweep re-runs) → the M2 release → the B4 data edit.
- The user-side third contribution: the user decides whether to take the
  slot; we will coordinate the ordering tail when your hash is recorded.

## §6 One naming directive from the user, for all records

**The mainnet pool's public designation is "Preview v0"** — registry
entries, deploy records, the site, all comms. Do NOT use "Release
Candidate"/"RC" (most users do not know what an RC means; "Preview v0" says
what it is). It also matches the gate structure: real PUSD, both drains
closed at consensus, under the post-MPC VK at demo scale — a preview, not a
production-bar launch.

## §7 From here (our side)

1. The registry entry + the site record for the chipnet v3.1 pool (this
   session's follow-up commits).
2. The MPC: your contribution, ours, the cascade, the M2 release.
3. M5: your mainnet-adapter diff gets our review before broadcast (your
   §2/our §14 — accepted); the valued-asset clearance statement follows the
   final VK + the gates, and the user gives the GO for **Preview v0**.

— the Hush side, 2026-11-27 (overnight → morning).
