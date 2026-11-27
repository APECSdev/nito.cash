# POOL-V3-INTEGRATION-HANDOFF-2026-11-27 — the full v3 client-swap contract (M4)

**To: the Nito Cash team. From: the Hush side.** The M4 item of
`docs/HANDOFF-NITO-2026-11-27-MORNING.md`, in full: everything your client needs
to swap from the 3-out integration to the v3 pool (deposit path + hook-level
nullifier set), plus the M1 gate records, the M3 chipnet demo deployment
records, and the M5 mainnet recipe. Your repo and working assets are untouched;
this doc and the committed `pusd-shielded-pool` tooling are the references.

## §0 The category answer (your §0.3 / our open question, RESOLVED)

The mainnet PUSD **asset** category is
**`2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544`** (the anchor txid,
probed 200 on Selene `?network=mainnet`).

- The anchor probes **200 on Selene `?network=mainnet`** (re-verified this
  session from our host, twice; your §0.3 chain verification — anchor at height
  948,409 → mint at 948,416, 2^63−1 FT in 10 minting-NFT-guarded chunks + 5
  mutable NFTs — is our record of the asset chain too).
- In the **role-2 architecture the pool category IS the asset category**: the
  pool's state NFT, fuel tags, blanks and the shielded FT all live in ONE
  category, and the issuer mints the state mutable-NFT + blanks from the asset's
  minting NFT (your §0.3 issuer actions). So the mainnet v3 pool runs AT
  `2469acc5…`.
- **Our entire v3 stack already pins that category**: the circuit witness
  (`pusd-shielded-pool/gen-our-proofs-v3.mjs:43` — `assetCategory =
  0x2469acc5…`), the fixtures, the hook ctor, and the 7,998-B program
  (`d98c1d2ac828a909ba71bc94b719e2e21afcccc2d7565b8268ed8221d097b429`). If the
  issuer confirms, tonight's program is the category-correct mainnet candidate;
  program/locking hashes are PER-CATEGORY (a different category = one rebuild).
- Do not confuse it with the OLD gen-1 `mainnet-pusd-pool` registry entry:
  that pool ran poolCategory `dd1e3506…` (its own PREP txid) holding 100 base
  units (1.00 PUSD) of the asset `2469acc5…` — a different generation and a
  different architecture (7-input covenant era). It is not the v3 target.

## §1 The v3 facts (all measured; sources cited)

### §1.1 The circuit (`pusd-shielded-pool/circuits/pool4.circom` + `noteappend.circom`)

| quantity | value | source |
|---|---|---|
| constraints | **247,120** (194,632 non-linear / 52,488 linear) | `build4/pool4.r1cs` |
| public inputs | **2** (n0 = merkleRoot, n1 = actionHash) | VK `nPublic: 2`, `IC: 3` |
| private inputs | 174 | r1cs info |
| actionHash preimage | 9 fields, 288 B — **UNCHANGED** | `pool-hook.mjs actionHashOf(_, 3)` |
| carrier | **201 B** — UNCHANGED | `pool-hook.mjs carrierOf(_, 3)` |
| r1cs / wasm | 47,812,408 B / 3,641,000 B | `build4/` |
| pot18 headroom | 15,024 c under the 262,144 wall | `docs/V3-BUILD-2026-11-27.md` §3.4 |

The three fixes in one R1CS (each is a closed consensus hole):
1. **the append proof (R3-FREE-NEWROOT, closed)** — three sequential
   `DenseAppend` dual-walk inserts chain `merkleRoot -(cm0)-> r1 -(cm1)-> r2
   -(cm2)-> newMerkleRoot`, each pinned to the tree's true frontier by the
   dense-shape rule (`IsEqual(sibling, zh[i]) === 1 − keyBits[i]`). The R3
   plant witness (fake `newMerkleRoot`) now REJECTS at `wtns check`
   (`spike-nullset/probe-v3-negatives.mjs`).
2. **`isDeposit`** — the onboarding path: both in-note membership checks are
   gated `(1 − isDeposit)·(inMerkle[i].root − merkleRoot) === 0` and both
   in-note values are pinned `isDeposit · inValue[i] === 0`. The genesis tree is
   EMPTY; **the bootstrap-seed dependency is GONE**.
3. **`nf0 != nf1`** — `IsZero(nf[0] − nf[1]).out === 0` (the R2 in-action
   doubling dies at `wtns check`); the cross-ACTION replay is stopped by the
   hook-level SMT (§3).

### §1.2 The ceremony artifacts (CHIPNET-ONLY until the mini-MPC settles)

1-of-1 demo setup over `ppot_0080_18.ptau` (sha256 `9693220206af…`):

| artifact | sha256 |
|---|---|
| `pool4_final.zkey` (120,818,048 B) | `942f8fc5327191da4a98bfbd81b74f87bd6f79267efb2d3067ac6cd0175a723a` |
| `verification_key.json` (3,108 B) | `07638f101038418d7b97ba46871476edaf3f6c63086fa9e984a2aa33e530b704` |
| `pool4_js/pool4.wasm` (3,641,000 B) | `a9b4b03d17c614ba920c45df5c34949e26ce8cdbdeb3d6b145476a2857289395` |
| circuit hash | `69622946620445cf…` |

Entropy `888d7f92…` is PUBLISHED per the chipnet demo precedent — the toxic
waste is derivable, so **this VK is chipnet-valid ONLY**. The mainnet VK is the
post-MPC trio (§8): 2-3 independent contributions with UNPUBLISHED entropy —
yours first, then ours, `zkey verify`, VK export. Base: `build4/pool4_0000.zkey`
(120,817,628 B, VK-neutral). **M2 (the proving-assets release) = the POST-MPC
trio**; hold B4 pinning until it settles (the program bakes `vk.ic[0]`).

### §1.3 The program (per-category; the `2469acc5…` build)

| quantity | value |
|---|---|
| code | **7,998 B**, sha256 `d98c1d2ac828a909ba71bc94b719e2e21afcccc2d7565b8268ed8221d097b429` |
| redeem R | 65 B, sha256 `638b3c0e0bc5ff2e4abb78abbbf77742d34f58fda468c8e38da57680f5d797f9` |
| P2SH32 locking | `aa201708ef361d2f46564b4fb562a6b5f8692890a3a60658b53613c2035bc9dbebd187` |
| code pieces | 4,111 / 3,887 B |
| role2 code | 2,986 B (was ~2,836 in the 3-out hook) |

Source: `build.v3.json` (the VM bench, category `2469acc5…`), reproducible via
`wip-role2-hook/pool-build-v3.mjs`. The plain v3-era program: 7,385 B, sha256
`925a42327fd66f6d8131c52d10762057ecfdc0051bb18aa7ac5f764042e279e0`.

## §2 The action shape (FIVE inputs — the client-swap delta)

```
 input 0  fuel/deposit   program P2SH32 · mutable NFT tag = SHA256(carrier[0..64])
 input 1  fuel           program P2SH32 · same tag
 input 2  state NFT      program P2SH32 · role 2 (the hook)
 input 3  walkA data     RAW walkA locking (278 B) — NO P2SH, by design
 input 4  walkB data     RAW walkB locking (291 B) — NO P2SH, by design
 out0     carrier        OP_RETURN <201 B> nf0|nf1|cm0|cm1|cm2|newRoot|pv(8)|sign(1)
 out1     new state      program P2SH32 · commitment = newRoot ‖ finalNullRoot
 out2     payout         unshield only: pv FT to the recipient (bare category)
```

- **The walk lockings have NO P2SH32 form** (morning-response correction 1):
  the script IS the locking bytecode, so the ~8.2-KB sibling witness does not
  also have to push a redeem under the 10,000-B unlocking cap. They are pinned
  by SHA256 hash in TWO places: the GRAPH (`POOL_NULLDATA_HASHES` — the
  generator-source edit `wip-role2-hook/v3-graph-pin.patch`: `TXINPUTCOUNT ==
  5` + `SHA256(UTXOBYTECODE(3/4)) == walkA/BHash`) and the hook's check 4w.
  Belt and braces, matching how the covenant-sibling fix doubled its pins.
- **Blanks stay 2 per action** (correction 2): the fuel pair. The walk-input
  UTXOs are NOT blanks — plain dust UTXOs locked to the fixed raw scripts,
  permissionless to create (anyone can pre-fund them; the walks are
  self-validating against the state at spend time). Our lock tool embeds the
  deployed lockings per action.
- No signatures anywhere: the P2SH32(R) script satisfaction IS the spend
  authorization; `TXINPUTCOUNT == 5` forbids a fee input, so fees ride the
  locked UTXOs' own sats (BARE fee policy).

### §2.1 What role 2 checks (the v3 hook) vs what the walks check

```
              ┌─ role 2 (input 2) ─────────────┐   ┌─ walkA (input 3) ──────┐   ┌─ walkB (input 4) ─────┐
              │ p1..p6, p8..p11 as deployed   │   │ anchor = state's       │   │ anchor = midRoot      │
              │ 4w NEW: SHA256(UTXOBYTECODE   │   │   nullSetRoot (2nd     │   │   (INPUTBYTECODE(3)   │
              │   (3)) == walkAHash, (4) ==    │   │   half of its commit)  │   │   1st push — same-tx  │
              │   walkBHash                    │   │ key = carrier nf0      │   │   atomicity)          │
              │ 7 REMOVED (the fold was the    │   │ 0-walk: zeros fold ==  │   │ key = carrier nf1    │
              │   broken R2 mechanism)          │   │   anchor (slot EMPTY)  │   │ 0-walk: zeros ==     │
              │ 10 SPLIT: length 64 + FIRST     │   │ 1-walk: marker →       │   │   midRoot (EMPTY)    │
              │   half == carrier newRoot; the  │   │   midRoot, pinned to   │   │ 1-walk: marker →     │
              │   SECOND half is walkB's domain │   │   walkA's OWN witness  │   │   finalNullRoot ==   │
              └────────────────────────────────┘   └────────────────────────┘   │  out1 commit 2nd half │
                                                                                  └───────────────────────┘
```

The R2 replay now dies at **walkA's 0-walk** (a spent nullifier's slot is
non-empty); `nf0 == nf1` dies in-circuit AND at walkB; the R3 free-root dies
in-circuit (the append chain). Every rejection class is in the committed
29/29 acceptance suite (`wip-role2-hook/pool-test-v3.mjs`) and the red team
(§4).

## §3 The walk-data contract (per action; `role2-op-witness-v3.mjs` is FINAL)

Per action, the prover emits (op JSON `nullSet` field):

```json
"nullSet": {
  "sibsA":  [254 × 32-B hex],   // walkA: nf0's off-path siblings against the STORED nullSetRoot
  "midRoot": "…64 hex…",        // walkA's declared post-nf0 root (pinned in walkA's OWN unlocking)
  "sibsB":  [254 × 32-B hex],   // walkB: nf1's off-path siblings against midRoot
  "finalNullRoot": "…64 hex…",  // == the new state commitment's SECOND half
  "keysAdded": ["<kA>", "<kB>"],// the two 32-B LE spent keys (the SMT keys = the carrier's nf slices)
  "nullSetRootBefore": "…hex…"  // == the stored state commitment's SECOND half
}
```

- The SMT is SHA256, depth 254, keyed by the carrier's proof-bound nf slices
  (actionHash fields 0/1 — **NO actionHash change**). Leaf values: the spent
  marker `[1, 0×31]`; the empty leaf is 32 zero bytes; the node hash is
  `SHA256(left ‖ right)`; the empty-subtree ladder is the 254-level SHA256
  zero fold (`EMPTY_NULL_ROOT = e579b9be0b8f58daacc4f66c959ed3ec903884d1914e11e7e0c3bbf2a5627b43`).
- The walk unlocking layouts: walkA `[midRoot(32 B), sibBlob(8,128 B)]`,
  walkB `[sibBlob(8,128 B)]` — measured sizes **8,164 / 8,131 B**. The sibling
  blob is length-pinned at 254×32 by the script (defense in depth).
- Key bits are EXTRACTED IN SCRIPT from the carrier slice (byte `i>>3`, mask
  `1<<(i&7)`, LSB-first) — the walked slot is bound to the proof-bound
  nullifier; witness-supplied bits would decouple them and re-open the replay.
- **Build against `role2-op-witness-v3.mjs` as committed** (morning-response
  correction 3): the R1CS is fixed; the VK swap (the MPC) changes only the
  zkey/VK, not the generator. The 4/4 JS-mirror walk cross-checks it emits are
  the reference semantics.

## §4 The M1 gate records

**M1c — the hook cost re-measure: PASSED, measured** (`pool-cost-v3.mjs`, the
upstream difference method, fixture 0, same proof both builds, v3 scenario:
state commitment = noteRoot ‖ nullSetRoot, newCommit = newRoot ‖ finalNullRoot,
NO fold, 5-input shape both builds):

| measurement | standard | consensus |
|---|---|---|
| **v3 hook price (r2:statement → r2:slices)** | **41,567 op** | **39,391 op** |
| role-2 code delta | 612 B | (same) |
| total input 2 (hook + GT-GLS) | 6,672,998 / 7,099,200 (94.0%) | 6,635,238 (93.5%) |
| walkA own cost | 4,324,736 / 6,564,000 (65.9%) | 4,194,688 (63.9%) |
| walkB own cost | 4,350,443 / 6,537,600 (66.5%) | 4,220,395 (64.6%) |

vs the 3-out hook (39,082 std / 37,930 cons, 537 B): **+2,485 op std / +2,461 op
cons, +75 B** — the 4w walk-locking hash pins + the split check 10, less the
removed fold. Fills [0,0,203] (input 2 sized to the 6% margin; inputs 0/1 have
empty fillers as in every hooked build); walk unlockings 8,164 / 8,131 B with
~34% self-funded margins — comfortably inside every budget.

**M1a — the red team: PASSED. 164 runs, 0 accepted (consensus and standard),
both positive controls accepted** — `pool-redteam-v3.mjs` →
`pool-redteam-v3-report.json` (committed in `pusd-shielded-pool/wip-role2-hook/`).
The stock 151-scenario list re-pointed at the 5-input pool shape (146
expressible — inputs 0/1 have empty fillers in every hooked build, the 5
filler-tamper scenarios are no-ops) + **18 NEW walk-input scenarios**: witness
tampering (sibling flips, the declared midRoot, truncated blobs, swapped
witnesses, junk, cross-action staples), locking tampering (swap, junk — the
4w/graph hash pins), shape tampering (walk inputs dropped/duplicated — the
TXINPUTCOUNT pin), **the REPLAY (nf0 already in the set — walkA's 0-walk
rejects: the R2 mechanism now actually stopped at consensus level)**, the
state nullSetRoot half tampered (walkA rejects), the new commitment's
finalNullRoot half tampered (walkB rejects; role 2 accepts by design — the
two-script pin).

The layering held exactly as designed: walk-side tampering died at the walk
scripts (8 runs at walkA, 3 at walkB), the locking swaps at `r2:p4w` (5), the
shape tampering at the GRAPH, the public-input claims at `r2:p5`/`r2:binding`
before the graph's binding check, proof-point tampering in the graph
(`G1C@17`), B-outside-G2 at `r2:t:endpoint`. **NO FINDING — nothing surfaces
for the morning.**

**M1b — the liveness sweep**: 5 fixtures + 64 seeded random REAL proofs (seeds
`sweep-v3a`/`sweep-v3b`, all four action classes incl. DEPOSIT) →
`pool-sweep-v3.mjs`.
**[PENDING — minting in flight; measured v3 proof time ≈ 130–220 s at 247,120 c
(5–9× the 184k-c 3-out's 24.6 s) under a contended VM]**

## §5 The DEPOSIT flow (the onboarding spec)

The first-time user needs NO imported notes and NO bootstrap seeds:

1. **Prove**: `role2-op-witness-v3.mjs --action deposit --amount N` — phantom
   in-notes (value 0, fresh secrets; membership gated in-circuit), three fresh
   out-notes summing to N, the append at the current frontier (empty tree at
   genesis: indices 0,1,2), the two fresh nullifiers inserted into the SMT.
   The op JSON carries the walk data + the deposit FT rides the lock.
2. **Lock**: `pool-refill-role2-v3.mjs` — 2 blanks (tag pair) + the N-FT
   deposit on fuel0 + the two walk-data dust UTXOs.
3. **Act**: `pool-op-role2-v3.mjs` — the 5-input action; out1's balance grows
   by N; the nullifier set gains the two keys; the three out-notes are the
   user's first private notes (tree indices recorded in the op JSON).

The hook treats a deposit exactly like a shield (sign=0): fuel0 carries the FT
deposit; conservation + balance arithmetic are enforced by the proof, the hook,
and BCH consensus token rules. The UI contract is your side (M3's
DEPOSIT → TRANSFER → UNSHIELD browser acceptance through the real wallet UI).

## §6 The scan contract (SMT reconstruction from observed actions)

Per observed action, the scan must:
1. read the carrier (out0): `nf0, nf1, cm0, cm1, cm2, newRoot, pv, sign`;
2. verify `n0` (the proof's first public input) against the PREVIOUS state
   commitment's first half and the `actionHash` recompute (the 9-field
   preimage) — as the 3-out scan already does;
3. **NEW (the R3 stopgap is a strict subset of this)**: reconstruct the NOTE
   TREE append — `leaves += cm0, cm1, cm2` at the recorded frontier (the
   dense-shape rule guarantees the frontier is the next three slots) — and
   compare the fold against the carrier's `newRoot`;
4. **NEW (the SMT)**: reconstruct the nullifier set — insert the two keys
   `kA = LE(nf0)`, `kB = LE(nf1)` in that order (walkA's midRoot is the
   intermediate root) — and require the resulting root to equal the NEW state
   commitment's second half; the PREVIOUS root must equal the previous
   commitment's second half;
5. replay check: a key already in the set fails step 4 (the client-side
   mirror of walkA's 0-walk rejection);
6. balance: `newBalance = balance + pv − 2·sign·pv` from out1's FT amount.

The state commitment spec: **64 B = LE32(noteRoot) ‖ nullSetRoot** (was
`seededRoot ‖ fold` — the fold is GONE). The genesis values are in §7.

## §7 The genesis constants (exact values)

| constant | value |
|---|---|
| note tree root (zh[20], the depth-20 Poseidon zero ladder top) | `15019797232609675441998260052101280400536945603062888308240081994073687793470` |
| zh[20] LE hex | (the deployed state file's `pool.rootLE`) |
| EMPTY_NULL_ROOT (254-level SHA256 zero fold) | `e579b9be0b8f58daacc4f66c959ed3ec903884d1914e11e7e0c3bbf2a5627b43` |
| **genesis state commitment (64 B)** | `LE32(zh[20]) ‖ EMPTY_NULL_ROOT` |

All three computed from first principles and asserted at import
(`pusd-shielded-pool/genesis-v3.mjs`). The genesis tree is EMPTY — no leaves,
no notes, no spent keys; the first action MUST be a deposit.

## §8 The MPC (Gate 7 at demo scale — the mainnet VK)

- Base: `~/zkb/pusd-shielded-pool/build4/pool4_0000.zkey` (120,817,628 B) —
  VK-neutral; contributions chain onto it.
- Your contribution: `snarkjs zkey contribute pool4_0000.zkey <out> — your
  entropy, UNPUBLISHED — not in any repo, doc, commit, or message. ~10 min at
  this circuit size (measured). Record only the contribution hash the tool
  prints.
- Our contribution follows yours, same hygiene; then `zkey verify`, the VK
  export, the hash record. **The final trio supersedes the current chipnet-only
  trio** (§1.2) and is the M2 release + the B4 pin target.
- The cascade after the MPC (measured-pattern work, a few hours): re-prove the
  5 fixtures → `mkfixtures-v3.mjs` → rebuild the program (new `vk.ic[0]` ⇒ new
  program hash ⇒ new lockings; **the walk scripts are UNCHANGED — category-only,
  no VK**) → re-run `walk-test.mjs` + `pool-test-v3.mjs` (29/29) + the red team
  + the sweep under the final zkey.

## §9 The chipnet v3 demo (M3) — the deployment record

**[PENDING — lands with the deploy tonight: the pool id/registry entry, the
anchor/mint/deploy txids + heights, the program + walk lockings hex for the
DEPLOYED category, the state file path, and the DEPOSIT → TRANSFER → UNSHIELD
action txids with per-input VM-acceptance lines and the measured fuelSats]**

## §10 The fuel economics (measured on the chipnet demo)

**[PENDING — the measured action size, fee, and fuel-per-action from the real
broadcasts]** Design numbers: the action is ~44.7 KB (the walk unlockings add
8,164 + 8,131 B over the 3-out shape); the fuel pair + walk pair must cover the
fee at 1 sat/B plus the unshield payout while the 10k state float passes
through. The lock defaults: fuel 23,000 × 2, walk-data 2,000 × 2 (the walk dust
sits above the relay dust threshold — a ~300-B locking's threshold is
≈ 3 × (8 + 2 + 300 + 148) sats). **Blanks: 2 per action** (the fuel pair),
minted through the guard (K=64 per batch, batch cost ≈ 64 × 1,000 sats + fee).

## §11 The pool-accept extension (the 5-input oracle)

Per action, reproduce byte-exactly:
- unlockings: `[role0, role1, role2]` from the verifier program (the bench
  `transaction.mjs unlockingsFor` — sizes ≈ 9.6k / 9.6k / 9.0k under the v3
  program's pool-shaped fills) + `walkA 8,164 B` + `walkB 8,131 B`;
- the walk unlockings are pure data pushes: walkA `OP_PUSH32(midRoot)
  OP_PUSHDATA1(8128 sibBlob)`, walkB `OP_PUSHDATA1(8128 sibBlob)` (no redeem
  push — the locking IS the script);
- source outputs 3/4: the RAW walk lockings (from the registry entry) at dust
  value; source outputs 0/1: the tagged fuel NFTs; source output 2: the state
  NFT with the 64-B commitment;
- every input VM-ACCEPTED consensus + standard pre-broadcast (the discipline
  both sides already run).

## §12 The full VM-landmine list (script-adjacent client code)

The two published v3 landmines (measured, in `walk-scripts.mjs`):
1. **`BIN2NUM` of the bare sign byte `[0x80]` decodes as −0 = ZERO** — and
2. **`RSHIFTNUM` truncates toward zero for negatives** (bit parity flips for
   bytes ≥ 0x80). The walk scripts zero-pad the key byte to stay unsigned:
   `kbNum = BIN2NUM(key[0] ‖ 0x00)`, bit `i = (kbNum >> (i&7)) mod 2`.

The prior published set (all still live):
3. `OP_SIZE` is NON-POPPING on the BCH-2026 VM (model pop-1/push-2 — a
   pop-1/push-1 model shifts every later pick by one);
4. `OP_SPLIT` leaves the RIGHT part on top;
5. `OP_AND`/`OP_OR` need equal-length operands (NUM2BIN the mask);
6. 32-byte pushes decode as NEGATIVE VM numbers when the top byte ≥ 0x80 —
   compare roots bytewise (`EQUALVERIFY`), never `NUMEQUAL`;
7. the actionHash preimage limbs are REVERSEBYTES'd to big-endian; the
   nullifier-domain data (the SMT keys) uses the RAW LE forms;
8. **Node `Buffer` + libauth = in-place corruption** — `Buffer.slice()` returns
   a VIEW; the VM's mutating opcodes write through it. Pass ONLY plain
   `Uint8Array`s into the VM (a Proxy does NOT catch the writes);
9. loop-body stack hygiene: every per-level mutable must be CONSUMED and
   re-pushed each iteration (`roll`, never `pick`) — picks leak duplicates and
   shift the layout; read-only items are picked freely;
10. the in-loop consume-not-pick rule and the `ip` conventions: libauth
    `vm.debug()` `ip` is a byte offset in the executing function
    (`OP_INVOKE` starts a fresh ip space), not an instruction index.

## §13 The guard + vending recipe — UNCHANGED, pool-agnostic

The minting guard (`minting-guard.mjs`, suite 14/14) and the blank-vending
covenant (`blank-vending.mjs`, suite 18/18) are category-parametric and
UNCHANGED for v3: born-guarded deploy (the minting NFT locked into the guard at
deploy), guard batch = K blanks to the operator, vending at 1,000 sats/blank,
permissionless. Your B4/blank plumbing carries over as-is.

## §14 M5 — the mainnet recipe and the GO/NO-GO

- The recipe = the chipnet v3 deploy with mainnet constants: anchor (= the
  category, `2469acc5…` is ALREADY the asset — the mainnet pool's own anchor
  is the ASSET's anchor; the issuer performs the mint-side actions) + the
  program rebuild for that category + the state NFT + the guard, under the
  FINAL (post-MPC) VK.
- **Your mainnet-adapter diff gets our review before broadcast** (accepted in
  the morning response); send it when ready.
- The valued-asset clearance is the user's to give once the final VK + the M1
  gates are in place; our written confirmation follows the gates.

— the Hush side, 2026-11-27 (overnight).
