<!-- HANDOFF-POOL-V2.md -->

# Handoff — chipnet-pusd-v2: the runner-independent shielded pool (LIVE)

**Audience:** the HushYourMoney team (the shielded-pool source of truth —
`pool-registry.json` + `docs/POOL-DEPLOYMENT.md`) and any team consuming the pool.

**Status: DEPLOYED on chipnet (2026-11-22) — CORRECTED 2026-11-23: the pool is
UNSPENDABLE AS DEPLOYED (see "Correction" below; do NOT register it as usable).**
The wallet-committed verifying key + a fresh category, zero runner dependency.
Everything below is machine-verbatim for your registries.

## The on-chain facts (all confirmed by broadcast result == computed txid)

| What | Value |
| ---- | ----- |
| **Category anchor tx** (= THE CATEGORY, txid) | `050b5934bea9a7713e842371d8fb233b14f5596b7339fcbf8c1c7dac58c504a9` |
| **Mint tx** (genesis: minting NFT + 100,000,000 fungible) | `a3e90020be9924f4a6400b922c651d69ce0005941922b7f4f62331c781decc02` |
| **Deploy tx** (pool UTXO + 5 verifier-step UTXOs) | `53014fd4749ff205795e288689e12316a1497e09fc6a97bcfaa38360206766da` |
| Pool covenant locking (P2SH32) | `aa20e6b3af9822cdaf8d2c0744bdf51e7d61b8edd280820f661b8641d3c9844d585587` |
| Covenant redeem (347 B, category ctor arg) | registry.js `covenantRedeem` (bytecode identical to gate3's — asset-agnostic) |
| Genesis tree root (LE VM-number) | `551108f63731bcc628dda2697d70219d103a8c1bf203f2d4aaec6bbea5b4510f` |
| Verifying key | **the wallet-committed key** — GitHub Release `proving-assets-v1` lineage (nito.cash), *not* the recovered runner key |
| Verifier program | the committed bench vectors (`WALLET_PROGRAM` in `apps/web/src/lib/pool/verifier-program.js`; byte-exact vs `apps/web/tests/fixtures/pool/bench-vectors-steps.json`) |

## pool-registry.json entry (your schema — ready to paste, bump `updated`)

```json
{
  "name": "chipnet-pusd-v2",
  "network": "chipnet",
  "poolCategory": "050b5934bea9a7713e842371d8fb233b14f5596b7339fcbf8c1c7dac58c504a9",
  "poolLocking": "aa20e6b3af9822cdaf8d2c0744bdf51e7d61b8edd280820f661b8641d3c9844d585587",
  "treeRootLE": "551108f63731bcc628dda2697d70219d103a8c1bf203f2d4aaec6bbea5b4510f",
  "assetCategory": "050b5934bea9a7713e842371d8fb233b14f5596b7339fcbf8c1c7dac58c504a9",
  "setupGrade": "committed-1of1-published-entropy",
  "notes": "Path-A runner-independent pool (2026-11-22): the wallet-COMMITTED verifying key (nito.cash proving-assets-v1 lineage) + a fresh category. Anchor 050b5934…504a9 (= the category), mint a3e90020…decc02, deploy 53014fd4…766da. Two PUBLIC bootstrap seed notes (value 0, nk=1) — any wallet can bootstrap. Deployed from apps/web/scripts/deploy-pool.mjs."
}
```

## The deployment rules we had to discover (verify against your runbook)

Diagnosed live 2026-11-22 (each rejected/broadcast pair on chipnet):

1. **Genesis category anchoring = `vin[0]` at vout 0.** The category must equal the
   anchor txid AND the mint must spend **out[0]** of the anchor. Spending out[1]
   (same txid!) is rejected with `bad-txns-token-invalid-category (16)`. Both your
   known-good mints (3fd526e8 spending 8c73ff15:0, 097619e8 spending 98690dba:0)
   follow this; your POOL-DEPLOYMENT.md doesn't state the vout-0 requirement.
2. **Genesis NFTs are MINTING-capable with EMPTY commitments.** A genesis output
   attempting a mutable NFT with a commitment is rejected (same error). The pool's
   mutable state NFT is created by SPENDING the minting NFT in the deploy.
3. **Min-relay fee vs the unsigned-size probe**: probing the tx size BEFORE signing
   undersizes ~70 B/input; at 1 sat/B that lands below the floor and the broadcast
   is rejected — probe with 100 B placeholder unlockings (the build.js convention).
4. **BCH txid = DSHA of the FULL SIGNED tx** (no segwit stripping), and libauth's
   `hash256` is already the double-sha (one call — two calls = quadruple = wrong).

## CORRECTION (2026-11-23) — the deployed step program is the 5-INPUT variant

The pool was deployed with the BENCH's step program (`WALLET_PROGRAM` ==
`tests/fixtures/pool/bench-vectors-steps.json` redeems), whose scripts hardcode
the bench's transaction layout:

- terminal redeem (`redeems[4]`), instructions 1548-1558:
  `OP_1 OP_TXINPUTCOUNT OP_5 OP_EQUALVERIFY` … `OP_INPUTINDEX OP_4 OP_EQUALVERIFY`
  → **exactly five inputs, terminal at index 4**;
- exec redeems (`redeems[0..2]`), instructions 33-34: `OP_3 OP_INPUTBYTECODE`
  → **the genesis witness must be input 3**.

The nito.cash builder emits EIGHT inputs (covenant 0, exec0..2 1..3, genesis 4,
terminal 5, funding 6+), so every hardcoded index is wrong and **no action can
ever satisfy these scripts**, independent of the proof.

Evidence, on a real action (36,997 B, 8-in/8-out) evaluated with the BCH-2026 VM
(`createVirtualMachineBch2026`, apecsdev `~/zkb/tools`):

| input | result |
|---|---|
| 0 — covenant | PASS (ip 234/234) |
| 1-3 — exec | `OP_SPLIT invalid index: stack item length 219; requested split index 867` |
| 4 — genesis | `OP_VERIFY failed` |
| 5 — terminal | `OP_VERIFY failed` |

Network verdict on broadcast: `mandatory-script-verify-flag-failed (Invalid
OP_SPLIT range)`. The working gate3/mainnet program is the GENERALIZED variant
(`DEPLOYED_PROGRAM` redeem 4 @1549-1557: `OP_TXINPUTCOUNT >= 5`, terminal at
index 5).

**Required fix:** generate a GENERALIZED program under the wallet vk and
redeploy (`apps/web/scripts/deploy-pool.mjs` takes the program constants from
`lib/pool/verifier-program.js`). Until then the pool must stay
`walletProverCompatible: false` in every registry.

## Wallet state (nito.cash, this commit)

- `networks.js` chipnet PUSD → `050b5934…` (supersedes the 8c73ff… TX-P3 stand-in —
  which no wallet-compatible pool ever tracked — and the 479aee… faucet token).
- `registry.js`: the pool is the FIRST chipnet entry — `genesisLeaves` +
  `bootstrapNotes` are published (public dummy notes: value 0, nk=1, fixed
  rho/r — fully deterministic). `walletProverCompatible` is **false** (was true
  on 2026-11-22; corrected 2026-11-23 — see the Correction section).
- The deployed pools (gate3 + mainnet) stay `walletProverCompatible: false` —
  their witness-encoding generator revision is still missing
  (`apps/web/scripts/pool-accept.mjs` is the byte-exact acceptance gate).
- Deployment tool: `apps/web/scripts/deploy-pool.mjs` (deterministic seeds +
  self-checked covenant derivation; `--dry` builds without broadcasting).
