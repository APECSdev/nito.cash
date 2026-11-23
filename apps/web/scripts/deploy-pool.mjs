// apps/web/scripts/deploy-pool.mjs
//
// PATH-A POOL DEPLOYMENT (the runner-recovery-independent pool) — creates a
// fresh chipnet shielded pool for the wallet's OWN committed verifying key and
// the wallet-tracked PUSD stand-in category, using ONLY materials already in
// this repo + the test fixture ground truth:
//
//   · covenant   — the deployed 347 B merged spend()/init() bytecode (asset-
//                  identical; the category is the 32-byte constructor arg) —
//                  derived from the gate3 registry covenantRedeem and
//                  SELF-CHECKED (hash256 of the rebuilt redeem must reproduce
//                  gate3's P2SH32 locking before anything else happens);
//   · program     — the WALLET-COMMITTED verifying key's on-chain program in
//                  its GENERALIZED layout: the LAYOUT of the deployed on-chain
//                  program (verifier-program.js DEPLOYED_PROGRAM) carrying the
//                  BODIES of the committed bench vectors (WALLET_PROGRAM — the
//                  constants lib/pool/verifier.js reproduces byte-exactly per
//                  pool-verifier.spec's pinned ground-truth test). This is
//                  GENERALIZED_WALLET_PROGRAM in
//                  lib/pool/verifier-program-generalized.js. Deploying the raw
//                  WALLET_PROGRAM is what made chipnet-pusd-v2 unspendable: its
//                  fixture layout hardcodes OP_TXINPUTCOUNT == 5 with the
//                  verifier genesis at input 3 and the terminal at input 4,
//                  which no real action tx (covenant 0, exec 1-3, genesis 4,
//                  terminal 5, funding 6+) can satisfy;
//   · seed leaves — TWO PUBLIC dummy notes (value 0, the published bootstrap
//                  key nk = 1) whose commitments form the genesis tree; the
//                  full contents go into the registry entry as `genesisLeaves`
//                  + `bootstrapNotes`, so ANY wallet can bootstrap its first
//                  action by spending them (lib/pool/actions.js selectInNotes).
//
// FRESH CATEGORY (the hushyourmoney POOL-DEPLOYMENT.md §2 pattern — verified
// empirically on-chain 2026-11-22: the 8c73ff/98690dba categories are the
// TXIDs of small ANCHOR transactions that the mint tx spends, NOT the mint
// txids themselves): the deploy MINTS a brand-new category via a two-tx flow —
//   tx 1 (anchor): a 1-in/out spend from the chipnet stand-in mint key
//                 (TEST-ONLY, no value) — its TXID becomes the category;
//   tx 2 (deploy): spends the anchor output; outputs carry category =
//                 the anchor txid: the pool UTXO (a GENESIS MUTABLE NFT with
//                 the seeded-root commitment), the 5 step UTXOs, the 100M
//                 fungible supply, and BCH change.
// After deployment, networks.js chipnet PUSD is updated to the new category.
//
// Usage (plain node, from apps/web/):
//   node scripts/deploy-pool.mjs --secrets ~/.secrets/…-mint.json --dry
//   node scripts/deploy-pool.mjs --secrets ~/.secrets/…-mint.json
//   node scripts/deploy-pool.mjs --secrets … --category <64hex>   (default: the
//        wallet-tracked chipnet PUSD 8c73ff…93144 — MUST match networks.js)
//
// Output: the deploy txid + the complete registry-entry JSON block (for
// src/lib/pool/registry.js AND the hushyourmoney pool-registry.json handoff).

import { readFileSync } from 'node:fs'
import {
    binToHex, cashAddressToLockingBytecode, decodeTransaction, encodeDataPush,
    encodeTransactionBCH, generateSigningSerializationBCH, hash256, hexToBin,
    hash160, instantiateSecp256k1, instantiateSha256, SigningSerializationTypeBCH,
} from '@bitauth/libauth'
import { ElectrumClient } from '@electrum-cash/network'

import { BENCH_PROGRAM, BENCH_STEP_LOCKINGS } from '../src/lib/pool/verifier-program-bench.js'

/* The gate3 ground-truth pair (from src/lib/pool/registry.js — not plain-node
   importable due to its extensionless relative imports, so inlined here; the
   self-check below proves the redeem↔locking pair is internally consistent). */
const GATE3 = {
    covenantRedeem: '2053b1852a0311e37849cedf9b7353faff12be4ceba23b6199801a8309ba0d699878009c637b82012088537a82012088547a82012088557a82012088567a82012088c2529dc076ce5779517e8876cf01207f7554ca0221077f7701207f758876cf01207f7778d07c57797e56797ea853797c7e7c5a7993525c79955b7995947600a26900cd537ac78800d15879517e8800d27b8800d39d5879519c6356d156798856d358799d68547abc547abc7e537abc7e7bbc7e547a012080bc7e547a012080bc7e7bbc7e7cbc7ea876517f75011f847c517f777ebc54ca0200077f7701207f758777677c519d7c82012088c2529dc076ce5379517e88203e1f1922dfb671d3f912f7ea461e0a88ee848fdde12b6c18ab1ad2c56ae734212000000000000000000000000000000000000000000000000000000000000000005279cf7b52797e8800cd5279c78800d1547a517e8800d37bd09d00d27b7b7e8768',
    lockingBytecode: 'aa207c0c15fbdc14dda43fb0540846e065a1bbd4076e7ab64720e64c3ecd3515208087',
}

/* ---- args ---- */
const argOf = (name, fallback = null) => {
    const i = process.argv.indexOf(name)
    return i >= 0 ? process.argv[i + 1] : fallback
}
const SECRETS = argOf('--secrets', '/Workspace/apecsdev/.secrets/pusd-shielded-pool-chipnet-mint.json')
const DRY = process.argv.includes('--dry')

/* ---- the covenant (derived + self-checked against the gate3 ground truth) ---- */
const gate3Redeem = hexToBin(GATE3.covenantRedeem)

/* covenantRedeem = <push catOnchain(32)> ‖ bytecode; the bytecode tail is
   asset-identical (POOL-DEPLOYMENT.md §4). */
if (gate3Redeem[0] !== 0x20 || gate3Redeem.length < 34) throw new Error('gate3 redeem: unexpected shape')
const covenantBytecode = gate3Redeem.subarray(33)

/* THE COVENANT IS THE ORIGINAL gate3 BYTECODE (unshifted). The program is
   GENERALIZED to the covenant-at-input-0 shape, so the steps sit at inputs 1..5
   and the genesis witness is INPUT 4 — exactly what this covenant reads
   (`54ca` = OP_4 INPUTBYTECODE at two sites). No bytecode edit is needed. */
const covenantBytecodeShifted = covenantBytecode

/* ---- the public bootstrap seed notes (deterministic, fully published) ---- */
import { buildPoseidon } from 'circomlibjs'

const poseidon = await buildPoseidon()
const F = poseidon.F
const H = (...xs) => BigInt(F.toObject(poseidon(xs.map((x) => BigInt(x)))))

const BOOTSTRAP_NK = 1n /* the PUBLIC bootstrap nullifier key (anyone may spend) */
const BOOTSTRAP_SEED = [
    { rho: 0x626f6f7473747261702d736565642d30n, r: 0x736565642d302d6e69746f2d706f6f6cn }, /* "bootstrap-seed-0" */
    { rho: 0x626f6f7473747261702d736565642d31n, r: 0x736565642d312d6e69746f2d706f6f6cn }, /* "bootstrap-seed-1" */
]
/* ownerPub = x(nk · G) on BabyJubJub (the circuit's owner key form). */
import { buildBabyjub } from 'circomlibjs'
const bb = await buildBabyjub()
const bootPub = BigInt(F.toObject(bb.mulPointEscalar(bb.Base8, BOOTSTRAP_NK)[0]))

const seedNotes = []
for (const s of BOOTSTRAP_SEED) {
    seedNotes.push({ value: 0n, ownerPub: bootPub, rho: s.rho, r: s.r })
}
const genesisLeaves = seedNotes.map((n) => H(n.value, n.ownerPub, n.rho, n.r))

/* seededRoot: the depth-20 Poseidon zero tree with the 2 leaves inserted. */
const zeros = [0n]
for (let d = 1; d <= 20; d += 1) zeros.push(H(zeros[d - 1], zeros[d - 1]))
const fold = (leaves) => {
    let level = leaves.slice()
    for (let d = 0; d < 20; d += 1) {
        const next = []
        for (let i = 0; i < level.length; i += 2) {
            next.push(H(level[i], (i + 1 < level.length) ? level[i + 1] : zeros[d]))
        }
        level = next
    }
    return level[0]
}
const seededRoot = fold(genesisLeaves)
const leBytes = (v) => { const out = new Uint8Array(32); let x = BigInt(v); for (let i = 0; i < 32; i += 1) { out[i] = Number(x & 0xffn); x >>= 8n } return out }
const seededRootLE = binToHex(leBytes(seededRoot))
const GENESIS_COMMITMENT = new Uint8Array([...leBytes(seededRoot), ...new Uint8Array(32)])
console.log('seededRoot:  ' + seededRoot.toString(16))
console.log('seededRootLE: ' + seededRootLE)

/* ---- the mint key + funding ---- */
const secrets = JSON.parse(readFileSync(SECRETS, 'utf8'))
const privateKey = hexToBin(secrets.privateKeyHex)
const publicKey = hexToBin(secrets.publicKeyHex)
const address = secrets.address
if (!address.startsWith('bchtest:')) throw new Error('expected a chipnet mint key')

const client = new ElectrumClient('nito.cash', '1.5', 'chipnet.bch.ninja', { port: 50004, encrypted: true })
await client.connect()

const utxos = await client.request('blockchain.address.listunspent', address, 'include_tokens')
/* A SINGLE plain UTXO must cover the 8 x 1000-sat outputs + the ~900 B fee.
   The deploy spends ~10,000 sats total, so a 15,000 floor is ample. */
const plain = utxos.filter((u) => !u.token_data && u.value > 15000).sort((a, b) => b.value - a.value)
if (plain.length === 0) throw new Error('no plain BCH funding UTXOs at the mint key')
console.log('funding pool: ' + plain.slice(0, 3).map((u) => u.tx_hash.slice(0, 8) + ':' + u.tx_pos + ' (' + u.value + ')').join(', '))

/* ---- shared signing + txid helpers (plain BCH P2PKH only) ---- */
const sha256a = await instantiateSha256()
const secp = await instantiateSecp256k1()
const fundLocking = cashAddressToLockingBytecode(address).bytecode

/* BCH txid = double-sha256 of the FULL SIGNED transaction (BCH has NO
   segwit — the unlockings are part of the txid preimage). Verified live
   2026-11-22: the stripped-form hash did NOT match the network txid. */
/* libauth's hash256 IS the double-sha256 — call it ONCE. (Hashing twice =
   quadruple-sha — diagnosed live 2026-11-22: the broadcast txid matched
   hash256(hex) but not hash256(hash256(hex)).) */
const txidOf = (transaction) =>
    binToHex(new Uint8Array(hash256(encodeTransactionBCH(transaction), sha256a)).reverse())

const signInputs = async (transaction, sourceOutputs) => {
    for (let i = 0; i < transaction.inputs.length; i += 1) {
        const serialization = generateSigningSerializationBCH(
            { inputIndex: i, sourceOutputs, transaction },
            { coveredBytecode: fundLocking, signingSerializationType: Uint8Array.of(SigningSerializationTypeBCH.allOutputs) },
            sha256a,
        )
        const digest = hash256(serialization, sha256a)
        const signature = secp.signMessageHashSchnorr(privateKey, digest)
        if (typeof signature === 'string') throw new Error('Schnorr signing failed: ' + signature)
        const sigWithType = Uint8Array.from([...signature, SigningSerializationTypeBCH.allOutputs])
        transaction.inputs[i].unlockingBytecode = Uint8Array.from([...encodeDataPush(sigWithType), ...encodeDataPush(publicKey)])
    }
}

const broadcast = async (hex) => client.request('blockchain.transaction.broadcast', hex)

/* ---- tx 1: the CATEGORY ANCHOR (its txid becomes the new category) ---- */
const anchor = {
    version: 2,
    inputs: [{ outpointTransactionHash: hexToBin(plain[0].tx_hash), outpointIndex: plain[0].tx_pos, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array(0) }],
    /* out[0] = the BIG output the mint spends as vin[0].vout=0 (the known-good
       anchor shape: 8c73ff15's sole output / 98690dba's out[0] — the genesis
       category rule's empirical shape, diagnosed live 2026-11-22). */
    outputs: [{ lockingBytecode: fundLocking, valueSatoshis: 0n }],
    locktime: 0,
}
/* FEE: probe with SIGNED-SIZE placeholder unlockings (100 B = 65B sig + 1B
   hashtype + 33B pubkey + push opcodes — the build.js convention). Probing
   the unsigned tx undersizes it ~70B/input; at 1 sat/B that lands BELOW the
   min-relay floor → "rejected by network rules" (diagnosed live 2026-11-22:
   the anchor was BCH-2023-VM-ACCEPTED yet rejected on fee). 2 sat/B margin. */
const P2PKH_SIGNED = 100
const probeFee = (transaction) => BigInt(encodeTransactionBCH({ ...transaction, inputs: transaction.inputs.map((i) => ({ ...i, unlockingBytecode: new Uint8Array(P2PKH_SIGNED) })) }).length) * 2n

anchor.outputs.push({ lockingBytecode: fundLocking, valueSatoshis: 1000n })
anchor.outputs[0].valueSatoshis = BigInt(plain[0].value) - 1000n - probeFee(anchor)

/* CATEGORY RANGE CONSTRAINT (verified live 2026-11-23): the proving assets take
   `assetCategory` as a SINGLE BN254 field element (lib/pool/prover.js
   buildPoolWitness), so a category >= the scalar-field prime cannot be proven —
   the witness calculator fails with "Assert Failed. Error in template Pool_253".
   The category is the anchor TXID, so retry the anchor (varying the change by
   1 sat per attempt, which changes the txid and raises the fee slightly) until
   the txid is below the prime. ~18.9% of txids qualify, so this converges in a
   few attempts. Measured: 09268d21… (< p) proved; 9c54723d… (>= p) failed. */
const BN254_SCALAR_FIELD = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n

let anchorHex = null
let anchorTxid = null

for (let salt = 0n; salt < 4096n; salt += 1n) {
    anchor.outputs[0].valueSatoshis = BigInt(plain[0].value) - 1000n - probeFee(anchor) - salt
    anchor.inputs[0].unlockingBytecode = new Uint8Array(0)

    await signInputs(anchor, [{ lockingBytecode: fundLocking, valueSatoshis: BigInt(plain[0].value) }])

    anchorHex = binToHex(encodeTransactionBCH(anchor))
    anchorTxid = txidOf(anchor)

    if (BigInt('0x' + anchorTxid) < BN254_SCALAR_FIELD) break

    if (salt === 0n) console.log('anchor txid is >= the BN254 scalar field — retrying with a 1-sat change bump')
}

/* the NEW category = the anchor txid (display form) — verified empirically:
   8c73ff… and 98690dba… are exactly such anchor txids on chipnet, and the
   known-good mints spend them as vin[0] (the genesis-category rule). */
const CATEGORY = anchorTxid
const CAT_BYTES = hexToBin(CATEGORY) /* libauth token category bytes = display form */
console.log('anchor tx:  ' + anchorTxid + '  → THE NEW CATEGORY')

/* ---- the covenant (needs the category = the anchor txid) ---- */
const catOnchain = hexToBin(CATEGORY).reverse() /* the on-chain (LE) category bytes */
const redeem = new Uint8Array([...encodeDataPush(catOnchain), ...covenantBytecodeShifted])

const sha256 = await instantiateSha256()
const lockingOf = (red) => new Uint8Array([0xaa, ...encodeDataPush(hash256(red, sha256)), 0x87])

/* SELF-CHECK: rebuilding gate3's redeem from its own category must reproduce
   gate3's on-chain P2SH32 locking byte-for-byte. */
const gate3Cat = gate3Redeem.subarray(1, 33)
const gate3RedeemRebuilt = new Uint8Array([...encodeDataPush(gate3Cat), ...covenantBytecode])
if (binToHex(gate3RedeemRebuilt) !== binToHex(gate3Redeem)) throw new Error('covenant rebuild mismatch (gate3 redeem)')
if (binToHex(lockingOf(gate3Redeem)) !== GATE3.lockingBytecode) throw new Error('covenant self-check failed (gate3 locking)')

const poolLockingHex = binToHex(lockingOf(redeem))
const covenantRedeemHex = binToHex(redeem)
console.log('covenant OK — bytecode ' + covenantBytecode.length + 'B, self-check passed vs gate3')
console.log('pool locking: ' + poolLockingHex)

/* ---- tx 2: the MINT (spends the anchor as vin[0]; genesis token outputs) ----
   The known-good shape (gate3's mint 097619e8…, verified on-chain 2026-11-22):
   genesis NFTs are MINTING-capable with an EMPTY commitment — the mutable
   pool state NFT is created LATER, by SPENDING this minting NFT (the deploy).
   Attempting to mint a mutable+commitment NFT at genesis is rejected with
   "bad-txns-token-invalid-category" (diagnosed live 2026-11-22). */
const mint = {
    version: 2,
    inputs: [{ outpointTransactionHash: hexToBin(anchorTxid), outpointIndex: 0, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array(0) }],
    outputs: [
        { lockingBytecode: fundLocking, valueSatoshis: 1000n, token: { category: CAT_BYTES, amount: 0n, nft: { capability: 'minting', commitment: new Uint8Array(0) } } },
        { lockingBytecode: fundLocking, valueSatoshis: 1000n, token: { category: CAT_BYTES, amount: 100000000n } },
    ],
    locktime: 0,
}
mint.outputs.push({ lockingBytecode: fundLocking, valueSatoshis: BigInt(anchor.outputs[0].valueSatoshis) - 2000n - probeFee(mint) })

await signInputs(mint, [{ lockingBytecode: fundLocking, valueSatoshis: BigInt(anchor.outputs[0].valueSatoshis) }])
const mintHex = binToHex(encodeTransactionBCH(mint))
const mintTxid = txidOf(mint)
console.log('mint tx:    ' + mintTxid + ' (minting NFT + 100M fungible of ' + CATEGORY.slice(0, 8) + '…)')

/* ---- tx 3: the DEPLOY (spends the minting NFT → the pool state NFT) ----
   The gate3-deploy shape: the minting NFT transitions to mutable carrying the
   64-byte genesis commitment (seededRootLE ‖ 32 zero bytes); the fungible is
   carried to the mint key; the five WALLET step lockings are created. */
const deploy = {
    version: 2,
    inputs: [
        { outpointTransactionHash: hexToBin(mintTxid), outpointIndex: 0, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array(0) },
        { outpointTransactionHash: hexToBin(mintTxid), outpointIndex: 1, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array(0) },
        { outpointTransactionHash: hexToBin(mintTxid), outpointIndex: 2, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array(0) },
    ],
    outputs: [
        {
            lockingBytecode: hexToBin(poolLockingHex),
            valueSatoshis: 1000n,
            token: { category: CAT_BYTES, amount: 0n, nft: { capability: 'mutable', commitment: GENESIS_COMMITMENT } },
        },
        /* OUTPUT POSITIONS matter: the terminal asserts
           inputs[INPUTINDEX].outpointIndex == INPUTINDEX, and with the covenant
           at input 0 the terminal is input 5 — so it must spend OUTPUT 5. The
           steps are therefore emitted IN PROGRAM ORDER:
           out1=exec0 out2=exec1 out3=exec2 out4=genesis out5=terminal. */
        ...BENCH_STEP_LOCKINGS.map((locking) => ({ lockingBytecode: hexToBin(locking), valueSatoshis: 1000n })),
        /* the 100M fungible supply, held by the mint key for later shields */
        { lockingBytecode: fundLocking, valueSatoshis: 1000n, token: { category: CAT_BYTES, amount: 100000000n } },
    ],
    locktime: 0,
}
const deployFixedSpend = 1000n * 8n
deploy.outputs.push({ lockingBytecode: fundLocking, valueSatoshis: BigInt(mint.outputs[2].valueSatoshis) - deployFixedSpend - probeFee(deploy) })

const deploySources = [
    { lockingBytecode: fundLocking, valueSatoshis: 1000n, token: { category: CAT_BYTES, amount: 0n, nft: { capability: 'minting', commitment: new Uint8Array(0) } } },
    { lockingBytecode: fundLocking, valueSatoshis: 1000n, token: { category: CAT_BYTES, amount: 100000000n } },
    { lockingBytecode: fundLocking, valueSatoshis: BigInt(mint.outputs[2].valueSatoshis) },
]
await signInputs(deploy, deploySources)
const deployHex = binToHex(encodeTransactionBCH(deploy))
const deployTxid = txidOf(deploy)

/* decode round-trip all three */
for (const [label, hex] of [['anchor', anchorHex], ['mint', mintHex], ['deploy', deployHex]]) {
    const decoded = decodeTransaction(hexToBin(hex))
    if (typeof decoded === 'string') throw new Error(label + ' tx does not decode: ' + decoded)
}

console.log('deploy tx:  ' + deployTxid + ' (' + deployHex.length / 2 + 'B)')
console.log('pool UTXO:  ' + deployTxid + ':0 → category ' + CATEGORY.slice(0, 8) + '… (NFT seededRoot) + 5 step UTXOs')

/* ---- the registry-entry block (wallet registry + hushyourmoney handoff) ---- */
const registryEntry = {
    id: 'chipnet-pusd-v4',
    name: 'Chipnet PUSD pool v4 (bench program, wallet-generated witness)',
    network: 'chipnet',
    lockingBytecode: poolLockingHex,
    covenantRedeem: covenantRedeemHex,
    assetCategory: CATEGORY,
    genesisRootLE: seededRootLE,
    genesisLeafCount: 2,
    walletProverCompatible: true,
    deployTxid,
    categoryAnchorTxid: anchorTxid,
    mintTxid,
    genesisLeaves: genesisLeaves.map((l) => l.toString(10)),
    bootstrapNotes: seedNotes.map((n, i) => ({
        note: { value: n.value.toString(10), ownerPub: n.ownerPub.toString(10), rho: n.rho.toString(10), r: n.r.toString(10) },
        nk: BOOTSTRAP_NK.toString(10),
        index: i,
    })),
    stepLockings: BENCH_STEP_LOCKINGS,
    program: 'bench',
    notes: 'Deployed ' + new Date().toISOString() + ' (START OVER, runner-independent): a FRESH category (anchor ' + anchorTxid.slice(0, 8) + '…, mint ' + mintTxid.slice(0, 8) + '…) + the PUBLIC BENCH program generated by chunked/bn254/densless-msm/build.mjs — the SAME source tree as densless-recovered/witness.mjs, which lib/pool/verifier.js ports. The wallet witness is therefore correct BY CONSTRUCTION (no runner revision, no oracle). Steps occupy inputs 0..4 (fixture shape); the covenant follows and reads the genesis witness at input 3.',
}
console.log('')
console.log('=== registry entry ===')
console.log(JSON.stringify(registryEntry, null, 2))

if (DRY) {
    console.log('')
    console.log('MINT HEX: ' + mintHex)
    console.log('DEPLOY HEX: ' + deployHex)
    console.log('DRY — not broadcasting.')
    try { await client.disconnect(true) } catch {}
    process.exit(0)
}

console.log('')
console.log('broadcasting anchor…')
console.log('ANCHOR RESULT: ' + await broadcast(anchorHex))
console.log('broadcasting mint…')
console.log('MINT RESULT: ' + await broadcast(mintHex))
console.log('broadcasting deploy…')
console.log('DEPLOY RESULT: ' + await broadcast(deployHex))
try { await client.disconnect(true) } catch {}
