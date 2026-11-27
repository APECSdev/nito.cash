# HANDOFF — 2026-11-27 — the next mission: ALL BLOCKERS, then the video

**Read this first in a fresh session, then `AGENTS.md` (the "CURRENT MISSION (2026-11-27)"
section mirrors this document).** The user's order: **resolve every blocker in §3 BEFORE
recording the "working solution" video.** The video is the LAST step.

## 1. State at handoff (verified)

| Item | Value |
|---|---|
| Repo | `/Workspace/apecsdev/nito.cash`, `master`, HEAD `b7e2786`, CI `45920677809` green |
| Sibling | `/Workspace/apecsdev/hushyourmoney`, HEAD `aedfcbd` (the 3-out response + acceptance record) |
| Tests | 693 (691 + 2 known parallel-load flakes; both pass in isolation; CI green) |
| Build | `vite build` clean; coverage above the ratchet |

**The two role-2 pools are LIVE** (both `walletProverCompatible: true` / `status: 'live'`):

- **2-out** `chipnet-pusd-role2` (category `480e30ff…`): the acceptance
  SHIELD `1ca58773…` (348,247) → TRANSFER `50644d00…` (348,249) → UNSHIELD `f52008f4…`
  (348,253). Later actions: `7aee6780…` (348,512, +1,000 FT) and `a722ef3b…` (348,514,
  +1,000 FT) — **the current tip is `a722ef3b…:1`, state 762,400 FT**. A standing lock
  `d95e5b97…` (348,514) sits at the program (see B2). Pool history: 51 entries.
- **3-out** `chipnet-pusd-role2-3out` (category `bc607a96…`): the acceptance
  SHIELD `9b3aac2c…` (348,956) → TRANSFER `abbb3dc7…` (348,960) → UNSHIELD `5a4d6b85…`
  (348,966) — **the tip is `5a4d6b85…:1`, state 788 FT**. The program locking is
  `aa204a6ce339fb62b7b2ebb502c9bf642d3221620e6f5ded619ce8a39110e35182ea87` (the Hush
  handoff §1.1 has a one-char typo: `…10e35882ea87`). History: 17 entries.

**Wallet A** `bchtest:qzzu85xnl99u534d9z40yu7c494hknppx5lu29gl8t`: 72,148 plain sats,
2 blanks (3-out category), 99,999,212 FT (3-out) + 19,986,400 FT (2-out). Mnemonic:
`direct blame later place ready bronze logic race soda toss clerk violin dirt area very
color security physical rubber veteran circle grace treat strike` (demo key — rotate).
Key file `/Workspace/apecsdev/.secrets/wallet-a-role2-demo.json` (mode 600).

**The operator/faucet key** `bchtest:qzmux3gxj7tqqxwjuzxj7vg8vs49qzlnsszagj73z3`
(`76a914b7c3450697960019d2e08d2f3107642a500bf384`), key file
`/Workspace/apecsdev/.secrets/faucet-hot-wallet-with-address.json`.

**Wallet B** (the transfer recipient) `bchtest:qza5uut0cg0aan2g8jetn68zrrmssvanluzm364c4d`,
delivery point `5d281726fb8f424b04f8c71110a3e9fb120ba399c38c9946d6ae72d4d1242a84`.

**Proving assets** (`role2-proving-assets-v1` + `role2-proving-assets-3out-v1`, served at
`https://prover.nito.cash/assets/` with CORS `*`):

| Asset | Bytes | sha256 |
|---|---|---|
| `pool.wasm` (2-out) | 3,376,395 | `8595b43409370c83f371e16408cde85d88382f6fa66f406404071fb38efa7a48` |
| `pool_final.zkey` (2-out) | 97,716,000 | `4a4e2543dbe640de7a59e23cc652b89a50034898757efff22242eafec0f7b7c0` |
| `verification_key.json` (2-out) | 3,111 | `05250429214cd82eac6540459a564c223c2b3f985122fbe5369b2eac7546bd19` |
| `pool3.wasm` (3-out) | 3,380,815 | `c806e561d9466ec25f437d6dfe659ce97e73a3f65359449bcc35deb9c81910fb` |
| `pool3_final.zkey` (3-out) | 98,190,141 | `b0177dbe5bb1bf7e9122a00953a2facd3d05b0405fee6c1a59d0da55cfb81659` |
| `verification_key_3out.json` | 3,111 | `d4ed12eefea550d20fb17b34303fa1446af204b182d58c4807f36944f0d04861` |

**The Concierge** (`views/Concierge/*`): the labels are accurate (the MOCK pass,
`feaaaee`): Desk "Live desk" (CashShuffle live, NIP-42 opt-in), Persona CashCode/CashID
live (register + Nostr = preview), Earn "Pool live" (now both pools), Spend "Paste-drop
live". The click-through script: `docs/CONCIERGE-VIDEO-DEMO-HANDOFF-2026-11-26.md`.

## 2. What was closed since the previous handoff

- The Hush 3-out commits (`6ea8077`, `c6ad077`, `8c0d941`) were reviewed and **adopted**;
  two store-path gaps were fixed on our side (`2928632`): `scanPool` had dropped its
  `{ poolId }` payload (the dispatch passed it; the action ignored it) and `assembleLeaves`
  was 2-out-only (the 3-out tree threw "incomplete leaf list").
- The 3-out browser acceptance PASSED (`b7e2786`): the real Wallet UI, the 7 live notes
  imported, the selector on "3-out v3"; the registry flipped live.
- The harness now polls from node for the broadcast (a single 600 s `waitForFunction`
  trips puppeteer's 180 s protocol timeout during the cold 98 MB zkey download + proof).
- The bootstrap-seed reuse is refused after the genesis (`6669cdd`): `scanPool` passes
  `bootstrapNotes` only when the scan's action chain is empty.

## 3. THE BLOCKERS (the mission)

### B1 — the nullifier-set service (R2-NULLIFIER-DOUBLING)

- **The finding** (Hush, measured 2026-11-26, `hushyourmoney/docs/HANDOFF-2026-11-26-3OUT-NOTES-MANAGEMENT.md`
  §12; recorded in the 3-out registry entry): valid Groth16 proofs that use ONE note as
  BOTH in-notes verify against both deployed VKs — a demonstrated full-balance drain (the
  2-out's 762,400 FT in one action). It was **measured, not broadcast** — the 2-out pool
  still holds 762,400 FT (`a722ef3b…:1`).
- **The root cause**: the program's check 7 only folds `newNull = SHA256(oldNull ‖ nf0 ‖ nf1)`
  (`src/lib/pool/role2/pool-hook.mjs`, `role2-3out/pool-hook.mjs`); there is no
  set-membership check, so the same nullifier pair can be replayed.
- **The fix**: the v3 nullifier set (the earlier handoff's "runner-side indexer materials
  + nullifier-set service" on `bch-infra`/runner; the circuit's public inputs are
  `[merkleRoot, actionHash]` — the set membership needs a circuit/program change).
- **The acceptance**: a drain attempt REJECTED on the BCH-2026 VM (the
  `createVirtualMachineBch2026` gate, `@bitauth/libauth@3.1.0-next.8`) + a real action
  still passing + the nullifier set updated on-chain.
- **Until it ships: NO VALUED ASSET may enter any role-2 pool** (a mainnet gate beside
  the Gate-7 MPC ceremony).

### B2 — the standing locks

| Lock | Pool | Fuel | Tag | Who can act |
|---|---|---|---|---|
| `3db76294aba8fa24ad213520159660fe5280ab0c2430d592f56f9bd434a9a779` | 3-out | 1,000 FT + 30,000 sats | `9b15436a…` = the **public bootstrap tag** (recomputed from `bootstrapNotes`) | **anyone** — we sweep it |
| `d95e5b974c114411338144399646003d5297a074704ac6930acfff8698704bed` | 2-out | 1,000 FT + 30,000 sats | `f7fa6ad1…` (private — the Hush's notes) | the Hush (ask them) |
| `10f26fa38a4f7c506db3cb921fbc31615ab08c5b3dc12a7d645608b322b2fe84` | 3-out | 0 FT + 30,000 sats | `e20f2710…` | stuck (the nullifier lost) |
| `1946084ea07abef655c6f3a55850461726c2252e1ddaf47b2d2528f369450b1c` | 3-out | 0 FT + 30,000 sats | `1ef01ad4…` | stuck |
| `c3e21c7a99116e0205a1d97bffeff8eef9c314c54826532c72296d81ceaad08a` | 3-out | 600 FT + 30,000 sats | `fefbc49f…` | stuck |
| `dff42ddb835c39bf2200a6eef697ec5f256ade4a206d41bd85d904876e3e1c2a` | 3-out | 600 FT + 30,000 sats | `1b2d4fa4…` | stuck |

- **The fix**: a **standing-fuel path** — `submitRole2Action` always builds a fresh lock
  (`src/lib/pool/role2-actions.js`); the builder must accept existing fuel UTXOs. The
  sweep for `3db76294…`: the bootstrap in-notes (the public seeds) + the standing fuel +
  the current state → the out-notes to the wallet (a shield-like action; the 1,000 FT
  deposit rides the fuel0).
- **The acceptance**: the sweep broadcast + the lock spent; the 3-out state gains the
  1,000 FT; the fuel's 30,000 sats minus the fee return.

### B3 — the off-chain note delivery

- **The gap**: both pools' TRANSFER recipient notes are undeliverable. The 169/201-B
  action carrier carries `nf0|nf1|cm0|cm1|(cm2)|newRoot|pv|sign` — no encrypted note.
  The 2-out's 400 FT (the acceptance transfer) and the 3-out's 200 FT transfer are in the
  pool balances but the recipients cannot spend them.
- **The primitives that exist**: `src/lib/pool/carrier.js` (the NP01 encrypted-note
  OP_RETURN packet from the ORIGINAL pool — `NOTE-CARRIER.md` in `pusd-shielded-pool`:
  "NO covenant change required" for the ORIGINAL pool) and `src/lib/pool/seal.js` (the
  local AES-256-GCM note store).
- **The fix**: the role-2 action builder adds the NP01 carrier output (a second OP_RETURN
  or a merged packet); the recipient's `detectReceived` decrypts it; the deployed program
  must TOLERATE the extra output (the role-2 program checks the token outputs; a VM gate
  on the BCH-2026 VM before any broadcast). If the program rejects it, the alternative is
  the note handoff OUTSIDE the tx (the relay/DM path the 2N round will use anyway).
- **The acceptance**: a TRANSFER with the note packet; a second wallet's scan detects +
  decrypts the note; the recipient spends it in a later action.

### B4 — the proving-asset pinning

- **The gap**: `src/lib/pool/prover.js` passes the mirror URLs to snarkjs and verifies no
  bytes; `public/proving/pool_final.zkey` is the OLD `b2398d85…` (97,714,842 B) — the
  wrong-asset trap.
- **The fix**: pre-fetch the six assets, verify the sha256 table in §1, pass the verified
  buffers to snarkjs (or a cached blob), and delete/pin the stale local default.
- **The acceptance**: a unit test with the six hashes + a proof run against the mirror.

### B5 — the 2N round / B6 — the real multi-peer CashShuffle round

- The Hush daemons carry `role2-round.js` + `round-2n.js` (+ their tests); the missing
  pieces are the network loop and the Nito client 2N UI (B5), and the daemon deployment
  for a real 5-party round (B6).
- **Blocked on `blackhost`** (Hush-owned host sign-off; the user directed the delay).

## 4. Recommended order

1. **B2** — the sweep of `3db76294…` (fast; the only live theft risk). Ask the Hush about
   `d95e5b97…` in the same message.
2. **B4** — the pinning (hours; makes every later proof trustworthy).
3. **B1** — the nullifier set (the main engineering block; the mainnet gate).
4. **B3** — the note delivery (after B1; the 2N prerequisite).
5. **B5/B6** — when `blackhost` is online.
6. **The video** — only after all of the above.

## 5. Recipes

**VM (apecsdev)** — the build host for the web app; sync + test + build:

```bash
rsync -az --delete --exclude node_modules --exclude dist-vite --exclude coverage \
  --exclude .git --exclude 'scripts/.*' apps/web/ apecsdev:~/apps/nito.cash/apps/web/
ssh apecsdev 'cd ~/apps/nito.cash/apps/web && export PATH=$HOME/.nvm/versions/node/v24.18.1/bin:$PATH && \
  timeout 1700 node_modules/.bin/vitest run --coverage > /tmp/suite.log 2>&1; echo exit=$?; \
  grep -aE "Test Files|Tests  " /tmp/suite.log | tail -2'
```

**The node byte-exact gates:**

```bash
node scripts/pool-accept.mjs --pool role2     --txid <a 2-out action>
node scripts/pool-accept.mjs --pool role2-3out --txid ec31a41c
```

**The browser acceptance harness** (`scripts/role2-browser-accept.mjs`, the portable
Chrome on the VM: `~/apps/chrome-portable/opt/google/chrome/chrome`):

```bash
ACCEPT_POOL="3-out v3" ACCEPT_NOTES=/tmp/pool3-notes.json ACCEPT_ALL="200,200,112" \
  CHROME_BIN=$HOME/apps/chrome-portable/opt/google/chrome/chrome \
  node scripts/role2-browser-accept.mjs all 0 <64-hex delivery point>
```

`ACCEPT_ALL` overrides the three amounts; `ACCEPT_POOL` clicks the selector; `ACCEPT_NOTES`
imports the notes via `pool/recordNote`. The wait is a node poll loop (2 s, 15 min cap).

**The chipnet faucet** (the `sats` must be a STRING):

```bash
POST https://chipnet.bch.ninja/api/challenge  {"address":"bchtest:…","sats":"100000"}
solve SHA256(payload:nonce) <= target   # BigInt hex compare
POST https://chipnet.bch.ninja/api/claim     {"payload","signature","nonce"}
```

**The live pool queries** (the scripthash history; the 3-out's locking in §1):

```js
// the state tip = the LAST history entry that spends the program locking; its out1 is
// the state (mutable NFT, 10,000 sats). The locks (no covenant input) sit in the same
// history — filter by "does any input spend the program locking".
```

**The 3-out notes** (the 7 live notes, for the harness): the export is at
`/home/apecs/cov/role2-pool3-notes-export.json` on the VM; the handoff §3 of
`POOL-HANDOFF-2026-11-26-NITO-3OUT.md` (hushyourmoney) carries the same JSON. The
imported notes are the Hush's demo keys (their `nk`s, not wallet A's) — wallet A spends
them via the imported `nk` (the circuit checks `nf = Poseidon(nk, rho)` + the
membership), and the OUT-notes are wallet A's own (`selfNote`).

## 6. Caveats

- **The demo keys are public** (wallet A, wallet B, the operator, the Hush's note keys) —
  rotate after the objectives.
- **The bootstrap seeds are public** — refused after the genesis (`6669cdd`); the one
  remaining public lock is `3db76294…` (B2).
- **The old pools' notes are ABANDONED** (`chipnet-pusd-v4`/v2/v3 — the withdrawn
  verifier); no unshield/re-shield migration.
- **The 3-out program is a 1-of-1 demo setup** (`d4ed12ee…`); the Gate-7 public MPC
  ceremony is the mainnet gate beside B1.
- **The 2-out pool's registry note says "final state 760,400"** — historical; the current
  tip is `a722ef3b…` (762,400 FT).
- **The scratch files** in `apps/web/` (`.cmp.mjs .dx.mjs …`) and `scripts/.accept*` are
  untracked dev scratch — leave them.

## 7. The first commands of the next session

```bash
cd /Workspace/apecsdev/nito.cash && git pull && git log --oneline -5
cd /Workspace/apecsdev/hushyourmoney && git pull && git log --oneline -3
# read AGENTS.md (the CURRENT MISSION section) + this document
# verify the state: the two pools' tips + the standing locks (§1, §3 B2)
# start B2: the standing-fuel path + the 3db76294… sweep
```
