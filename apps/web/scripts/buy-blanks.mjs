/* apps/web/scripts/buy-blanks.mjs
 *
 * The G5 STRANGER-BUY rehearsal (dev-only): purchase tag blanks from the
 * LIVE chipnet vending machine with the wallet's OWN vendored covenant — the
 * permissionless, operator-free acquisition the visitors will use. This is
 * both the end-to-end validation of the vendored covenant + the registry
 * field set (VENDING-NITO-RESPONSE-2026-11-28.md §1) AND the blank refill
 * for the demo wallet ahead of the browser acceptance.
 *
 * The buy: the buyer's tokenless funding input pays the exact pinned price
 * to the operator P2PKH and the blank lands at the funding input's own
 * locking (the covenant's "the blank follows the money" — no signature, no
 * permission). One blank per transaction.
 *
 * Usage (from apps/web/, node v24):
 *   node scripts/buy-blanks.mjs --count 2
 *     [--mnemonic "<the 24 words>"] (default: the role-2 demo wallet A)
 *     [--network chipnet] (the only loaded machine today)
 */
import { ElectrumClient } from '@electrum-cash/network'
import { binToHex } from '@bitauth/libauth'

import { entropyFromMnemonic, hdNodeFromEntropy, derivePath, toCashAddress, toPrivateKeyBytes, toPublicKeyBytes, hexToBytes, addressToLockingBytecode } from '../src/lib/bch/crypto.js'
import { buildBuyBlankTx, vendingRedeem, vendingLockingOf, vendingScripthash } from '../src/lib/pool/blank-vending.js'
import { getPools } from '../src/lib/pool/registry.js'

const ARGS = process.argv.slice(2)
const argOf = (name, fallback = '') => {
    const i = ARGS.indexOf(name)
    return i >= 0 ? ARGS[i + 1] : fallback
}

const COUNT = Number(argOf('--count', '2'))
const NETWORK = argOf('--network', 'chipnet')
const MNEMONIC = argOf('--mnemonic', 'direct blame later place ready bronze logic race soda toss clerk violin dirt area very color security physical rubber veteran circle grace treat strike')

/* The chipnet v3 machine (the registry entry — the Hush handover fields). */
const POOL = getPools(NETWORK).find((p) => p.id === 'chipnet-role2-pool4-v3')
if (!POOL?.vending) throw new Error('no vending machine registered for ' + NETWORK)

const ELECTRUM = NETWORK === 'chipnet'
    ? { host: 'chipnet.bch.ninja', port: 50004 }
    : { host: 'bch.imaginary.cash', port: 50004 }

/* ── connect ──────────────────────────────────────────────────────────────── */
const client = new ElectrumClient('nito-buy', '1.5', ELECTRUM.host, { port: ELECTRUM.port, encrypted: true })
await client.connect()
console.log('connected to', ELECTRUM.host)

try {
    /* ── the machine's blanks (scripthash listunspent, tokens included) ── */
    const machineLocking = hexToBytes(POOL.vending.lockingBytecode)
    const scripthash = await vendingScripthash(machineLocking)
    /* NOTE: no include_tokens flag — Fulcrum's SCRIPTHASH listunspent
       already carries token_data (the ADDRESS form is the one that hides
       token UTXOs); the extra param breaks the electrum-cash request
       (measured: {} with it, the full array without). */
    const machineUtxos = await client.request('blockchain.scripthash.listunspent', scripthash)

    /* The blank shape: pool-category MUTABLE NFT, EMPTY commitment, 0 FT. */
    /* token_data.category arrives in DISPLAY (natural) order — the registry's
       assetCategory form. */
    const isBlank = (u) => {
        const t = u.token_data
        if (!t || !t.nft) return false
        return t.category === POOL.assetCategory
            && (t.nft.commitment === '' || t.nft.commitment === undefined)
            && !String(t.nft.capability).match(/minting/i)
            && BigInt(t.amount || 0) === 0n
    }
    const blanks = (machineUtxos || []).filter(isBlank).sort((a, b) => a.tx_hash.localeCompare(b.tx_hash))
    console.log('machine', POOL.vending.lockingBytecode.slice(0, 20) + '…')
    console.log('machine stock:', (machineUtxos || []).length, 'UTXOs,', blanks.length, 'exact blanks')

    if (blanks.length < 1) throw new Error(`machine has ${blanks.length} blanks; the buy needs at least 1`)

    /* ── the buyer: derive address 0 + the largest tokenless UTXO ── */
    const entropy = entropyFromMnemonic(MNEMONIC)
    const hdNode = hdNodeFromEntropy(entropy)
    const account = derivePath(hdNode, "m/44'/145'/0'/0/0")
    const address = toCashAddress(account, NETWORK)
    const buyerLockingHex = binToHex(addressToLockingBytecode(address))
    const privateKey = toPrivateKeyBytes(account)
    const publicKey = toPublicKeyBytes(account)

    /* The electrum-cash listunspent occasionally returns {} (a shape flake
       measured twice) — retry until a real array arrives. */
    let addressUtxos = null
    for (let attempt = 0; attempt < 3 && !Array.isArray(addressUtxos); attempt += 1) {
        addressUtxos = await client.request('blockchain.address.listunspent', address)
        if (!Array.isArray(addressUtxos)) await new Promise((r) => setTimeout(r, 1000))
    }
    if (!Array.isArray(addressUtxos)) throw new Error('listunspent kept returning a non-array')
    const funding = addressUtxos
        .filter((u) => !u.token_data)
        .sort((a, b) => Number(b.value) - Number(a.value))[0]
    console.log('buyer', address)
    if (!funding) throw new Error('no tokenless funding UTXO at the buyer address')
    console.log('funding', funding.tx_hash.slice(0, 16) + '…', ':', funding.tx_pos, '=', funding.value, 'sats')

    /* ── buy COUNT blanks (one tx each) ── */
    const results = []
    for (let i = 0; i < COUNT; i += 1) {
        const blank = blanks[i]
        const machineUtxo = { txid: blank.tx_hash, vout: blank.tx_pos, sats: blank.value }
        const fundingUtxo = { txid: funding.tx_hash, vout: funding.tx_pos, sats: funding.value }

        /* The second buy cannot reuse the first's change (unconfirmed) — the
           consecutive buys chain from the SAME confirmed funding would
           double-spend. Buy ONE per confirmed funding UTXO: for count > 1
           the caller re-runs after a confirmation (the acceptance needs 2 —
           the machine holds exactly 2; this run buys 1, then re-run buys the
           second after the first confirms). */
        if (i > 0) {
            console.log(`NOTE: buying ${COUNT} in one run would double-spend the funding — buy 1 per run (re-run after the confirmation).`)
            break
        }

        const { hex, fee } = await buildBuyBlankTx({
            machineUtxo,
            fundingUtxo,
            vending: POOL.vending,
            categoryDisplayHex: POOL.assetCategory,
            buyerLockingHex,
            privateKey,
            publicKey,
        })

        const txid = await client.request('blockchain.transaction.broadcast', hex)
        console.log(`buy ${i + 1}: blank ${blank.tx_hash.slice(0, 16)}…:${blank.tx_pos} → broadcast ${txid} (fee ${fee} sats)`)
        results.push(txid)
    }

    console.log('BUY OK', JSON.stringify({ bought: results.length, txids: results }))
} finally {
    await client.disconnect()
}
