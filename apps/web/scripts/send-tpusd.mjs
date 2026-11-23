// apps/web/scripts/send-tpusd.mjs
//
// FUND A WALLET WITH CHIPNET tPUSD (the chipnet-pusd-v2 stand-in token) +
// the BCH its first pool action needs — one tx, one funding account, the
// exact shape lib/pool/actions.js selectFunding() requires:
//
//   · the SAME address must hold the pool-category CashTokens AND >= 50,000
//     sats of plain BCH (MIN_FUNDING_SATS — the ~37 KB action tx fee plus the
//     constrained outputs). selectFunding() accumulates BOTH kinds of UTXO
//     from ONE account address, so this script pays them to one destination;
//   · the token output carries 1,000 sats dust (the token-aware minimum the
//     deploy script uses) and the plain output carries --bch sats;
//   · change (BCH + any unspent token amount) returns to the mint key.
//
// The mint key (TEST-ONLY, no value) is the .secrets key that minted the v2
// category — its 100,000,000 fungible units sit at output 6 of the deploy tx
// (53014fd4…:6, verified live 2026-11-22).
//
// Usage (plain node, from apps/web/):
//   node scripts/send-tpusd.mjs --to bchtest:q… --amount 20000000 --dry
//   node scripts/send-tpusd.mjs --to bchtest:q… --amount 20000000
//
// --amount is PUSD BASE UNITS (the Wallet view's shield/transfer/unshield
// amount field). --bch defaults to 200000 sats (4x the 50,000-sat floor).

import { readFileSync } from 'node:fs'
import {
    binToHex, cashAddressToLockingBytecode, encodeDataPush, encodeTransactionBCH,
    generateSigningSerializationBCH, hash256, hexToBin, instantiateSecp256k1,
    instantiateSha256, SigningSerializationTypeBCH,
} from '@bitauth/libauth'
import { ElectrumClient } from '@electrum-cash/network'

/* ---- args ---- */
const argOf = (name, fallback = null) => {
    const i = process.argv.indexOf(name)
    return i >= 0 ? process.argv[i + 1] : fallback
}
const SECRETS = argOf('--secrets', '/Workspace/apecsdev/.secrets/pusd-shielded-pool-chipnet-mint.json')
const TO = argOf('--to')
const AMOUNT = BigInt(argOf('--amount', '0'))
const BCH = BigInt(argOf('--bch', '200000'))
const DRY = process.argv.includes('--dry')

/* The wallet-tracked chipnet PUSD category — MUST match
   src/lib/bch/networks.js chipnet.tokens.PUSD and
   src/lib/pool/registry.js chipnet-pusd-v2.assetCategory. */
const CATEGORY = argOf('--category', '050b5934bea9a7713e842371d8fb233b14f5596b7339fcbf8c1c7dac58c504a9')
/* --token-sats: the sats carried by the TOKEN output. The PUBLIC BENCH program
   pins the action to EXACTLY ONE funding input, so that single UTXO must hold
   BOTH the pool tokens AND the ~38 KB action's fee. */
const TOKEN_SATS = BigInt(argOf('--token-sats', '1000'))

if (!TO) throw new Error('usage: node scripts/send-tpusd.mjs --to <bchtest:…> --amount <base units> [--bch <sats>] [--dry]')
if (AMOUNT <= 0n) throw new Error('--amount must be > 0 (PUSD base units)')
/* The action's fee floor must be satisfied by the funding UTXO the selector
   picks. When the TOKEN output itself carries >= MIN_FUNDING_SATS, the separate
   plain --bch output is unnecessary: a fixture-shaped program allows exactly ONE
   funding input, and that single UTXO must hold both the tokens and the fee. */
if (BCH + TOKEN_SATS < 50000n) throw new Error('--bch + --token-sats must be >= 50000 (lib/pool/actions.js MIN_FUNDING_SATS — the action fee floor)')

const secrets = JSON.parse(readFileSync(SECRETS, 'utf8'))
const privateKey = hexToBin(secrets.privateKeyHex)
const publicKey = hexToBin(secrets.publicKeyHex)
const address = secrets.address
if (!address.startsWith('bchtest:')) throw new Error('expected a chipnet mint key')

const destLocking = cashAddressToLockingBytecode(TO)
if (typeof destLocking === 'string') throw new Error('bad --to address: ' + destLocking)
const dest = destLocking.bytecode

const client = new ElectrumClient('nito.cash', '1.5', 'chipnet.bch.ninja', { port: 50004, encrypted: true })
await client.connect()

const utxos = await client.request('blockchain.address.listunspent', address, 'include_tokens')

/* The ONE token UTXO carrying the whole fungible supply (deploy output 6). */
const tokenUtxo = utxos
    .filter((u) => u.token_data && u.token_data.category === CATEGORY && !u.token_data.nft)
    .sort((a, b) => Number(BigInt(b.token_data.amount) - BigInt(a.token_data.amount)))[0]

if (!tokenUtxo) throw new Error('no fungible ' + CATEGORY.slice(0, 8) + '… UTXO at the mint key')
if (BigInt(tokenUtxo.token_data.amount) < AMOUNT) {
    throw new Error('mint key holds only ' + tokenUtxo.token_data.amount + ' base units, requested ' + AMOUNT)
}

console.log('token input: ' + tokenUtxo.tx_hash + ':' + tokenUtxo.tx_pos +
    ' (' + tokenUtxo.token_data.amount + ' tPUSD, ' + tokenUtxo.value + ' sats)')

/* ---- signing + txid helpers (the deploy-pool.mjs convention) ---- */
const sha256a = await instantiateSha256()
const secp = await instantiateSecp256k1()
const fundLocking = cashAddressToLockingBytecode(address).bytecode

/* BCH txid = double-sha256 of the FULL SIGNED transaction (no segwit) —
   libauth's hash256 IS the double-sha256 (call it ONCE). */
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

/* FEE: probe with SIGNED-SIZE placeholder unlockings (100 B), 2 sat/B — the
   deploy-pool.mjs convention (probing the unsigned tx undersizes by ~70 B per
   input and can land below the min-relay floor). */
const P2PKH_SIGNED = 100
const probeFee = (transaction) => BigInt(encodeTransactionBCH({ ...transaction, inputs: transaction.inputs.map((i) => ({ ...i, unlockingBytecode: new Uint8Array(P2PKH_SIGNED) })) }).length) * 2n

/* The token UTXO carries only 1,000 sats dust, so the BCH leg comes from
   separate PLAIN UTXOs at the SAME mint key (one key signs every input). */
const plain = utxos
    .filter((u) => !u.token_data)
    .sort((a, b) => b.value - a.value)

if (plain.length === 0) throw new Error('no plain BCH UTXOs at the mint key')

/* ---- the funding tx: token + BCH to the destination, change to the mint key ----
   Plain UTXOs are accumulated LARGEST-FIRST until the fee + outputs fit (the
   mint key holds many small ones; a single plain input is not enough). */
const buildTx = (sources) => ({
    version: 2,
    inputs: sources.map((u) => ({
        outpointTransactionHash: hexToBin(u.tx_hash),
        outpointIndex: u.tx_pos,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: new Uint8Array(0),
    })),
    outputs: [
        /* out0: the tPUSD delivery (1,000 sats dust — the token minimum). */
        {
            lockingBytecode: dest,
            valueSatoshis: TOKEN_SATS,
            token: { category: hexToBin(CATEGORY), amount: AMOUNT },
        },
        /* out1: the action-fee BCH, SAME address (one funding account).
           OMITTED when --bch 0: a zero-sat output is dust, and the token
           output above already carries the fee floor. */
        ...(BCH > 0n ? [{ lockingBytecode: dest, valueSatoshis: BCH }] : []),
        /* out2: change — BCH **and** the UNSPENT token remainder (CashToken
           conservation: every input category amount must be re-emitted; a
           token-less change output would BURN the remainder). */
        {
            lockingBytecode: fundLocking,
            valueSatoshis: 0n,
            ...(BigInt(tokenUtxo.token_data.amount) - AMOUNT > 0n
                ? { token: { category: hexToBin(CATEGORY), amount: BigInt(tokenUtxo.token_data.amount) - AMOUNT } }
                : {}),
        },
    ],
    locktime: 0,
})

let sources = [tokenUtxo]
let tx = buildTx(sources)
let fee = probeFee(tx)

for (const candidate of plain) {
    const sourceValue = sources.reduce((sum, u) => sum + BigInt(u.value), 0n)

    if (sourceValue - TOKEN_SATS - BCH - fee >= 0n) break

    sources = [...sources, candidate]
    tx = buildTx(sources)
    fee = probeFee(tx)
}

const sourceValue = sources.reduce((sum, u) => sum + BigInt(u.value), 0n)
const change = sourceValue - TOKEN_SATS - BCH - fee

if (change < 0n) throw new Error('funding UTXOs hold ' + sourceValue + ' sats, need ' + (TOKEN_SATS + BCH + fee))

tx.outputs[tx.outputs.length - 1].valueSatoshis = change

await signInputs(tx, sources.map((u) => ({
    lockingBytecode: fundLocking,
    valueSatoshis: BigInt(u.value),
    ...(u.token_data ? { token: { category: hexToBin(CATEGORY), amount: BigInt(u.token_data.amount) } } : {}),
})))

const txHex = binToHex(encodeTransactionBCH(tx))
const txid = txidOf(tx)

for (const u of sources.slice(1)) console.log('plain input: ' + u.tx_hash + ':' + u.tx_pos + ' (' + u.value + ' sats)')
console.log('fee: ' + fee + ' sats, change: ' + change + ' sats')
console.log('txid: ' + txid)
console.log('hex:  ' + txHex)

if (DRY) {
    console.log('DRY RUN — not broadcast')
} else {
    console.log('broadcast: ' + await client.request('blockchain.transaction.broadcast', txHex))
}

client.disconnect()
