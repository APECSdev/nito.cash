// apps/web/scripts/send-bch.mjs
//
// Minimal plain-BCH P2PKH send from a mnemonic wallet — used to top up the
// chipnet mint key (the pool deploy script requires a plain funding UTXO
// > 100,000 sats at that key).
//
// Usage (from apps/web/):
//   node --import ./.loader-register.mjs scripts/send-bch.mjs \
//     --mnemonic "<24 words>" --to bchtest:q… --amount 150000 [--index 0] [--dry]

import { ElectrumClient } from '@electrum-cash/network'
import { entropyFromMnemonic, hdNodeFromEntropy, derivePath, toCashAddress, toPrivateKeyBytes, toPublicKeyBytes, buildTransaction, signP2pkhInput, encodeTransactionToHex } from '../src/lib/bch/crypto.js'

const argOf = (name, fallback) => {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : fallback
}

const MNEMONIC = argOf('--mnemonic')
const TO = argOf('--to')
const AMOUNT = BigInt(argOf('--amount', '0'))
const INDEX = Number(argOf('--index', '0'))
const DRY = process.argv.includes('--dry')

if (!MNEMONIC || !TO || AMOUNT <= 0n) {
    console.error('usage: --mnemonic "<24 words>" --to <cashaddr> --amount <sats> [--index N] [--dry]')
    process.exit(1)
}

const entropy = entropyFromMnemonic(MNEMONIC)
const hdNode = hdNodeFromEntropy(entropy)
const node = derivePath(hdNode, `m/44'/145'/0'/0/${INDEX}`)
const from = toCashAddress(node, 'chipnet')

const client = new ElectrumClient('nito.cash', '1.5', 'chipnet.bch.ninja', { port: 50004, encrypted: true })
await client.connect()

const utxos = await client.request('blockchain.address.listunspent', from)
const plain = (Array.isArray(utxos) ? utxos : []).filter((u) => !u.token_data).sort((a, b) => b.value - a.value)
console.log('from      :', from)
console.log('plain utxos:', plain.map((u) => u.tx_hash.slice(0, 10) + '…:' + u.tx_pos + '=' + u.value).join(' '))

const pick = plain[0]
if (!pick) throw new Error('no plain UTXO at ' + from)

const FEE = 300n
const change = BigInt(pick.value) - AMOUNT - FEE
if (change < 546n) throw new Error('change would be dust: ' + change)

const bundle = buildTransaction(
    [{ txid: pick.tx_hash, vout: pick.tx_pos, satoshis: BigInt(pick.value), address: from }],
    [{ address: TO, satoshis: AMOUNT }, { address: from, satoshis: change }],
)
await signP2pkhInput(bundle, 0, toPrivateKeyBytes(node), toPublicKeyBytes(node))
const hex = encodeTransactionToHex(bundle.transaction)
console.log('to        :', TO, '| amount:', AMOUNT.toString(), '| change:', change.toString(), '| size:', hex.length / 2)

if (DRY) {
    console.log('DRY — not broadcasting')
} else {
    const txid = await client.request('blockchain.transaction.broadcast', hex)
    console.log('broadcast :', typeof txid === 'string' ? txid : JSON.stringify(txid))
}
await client.disconnect()
process.exit(0)
