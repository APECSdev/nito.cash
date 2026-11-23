// apps/web/scripts/shield-e2e.mjs
//
// END-TO-END SHIELD DRIVER — runs the wallet's OWN action pipeline
// (lib/pool/actions.js submitPoolAction) against a registered pool, from plain
// node, so an on-chain action can be produced and inspected without a browser.
//
// This is the acceptance harness for a pool deployment: it exercises the real
// scan -> in-note/funding selection -> witness -> Groth16 proof -> tx build ->
// broadcast path. Proving is heavy, so run it on the build host, not the dev
// host.
//
// Usage (from apps/web/):
//   node --import ./.loader-register.mjs scripts/shield-e2e.mjs \
//     --mnemonic "<24 words>" --amount 1000000 [--action shield|transfer|unshield]
//     [--to <delivery point hex>] [--dry]

/* Local-file fetch shim: prover.js resolves the proving assets and the
   verifying key with fetch(); node's fetch rejects relative paths. Map the
   web-relative 'proving/…' paths onto the on-disk public/ copies so the SAME
   wallet code path runs unmodified outside a browser. */
import { readFileSync } from 'node:fs'

const realFetch = globalThis.fetch

globalThis.fetch = async (input, init) => {
    if (typeof input === 'string' && !/^(https?|file|data):/.test(input)) {
        const path = input.startsWith('proving/') ? 'public/' + input : input
        return new Response(readFileSync(path), { status: 200 })
    }
    return realFetch(input, init)
}

import { getCluster } from '../src/lib/bch/provider.js'
import { getProverPool } from '../src/lib/pool/registry.js'
import { scanPool } from '../src/lib/pool/scan.js'
import { submitPoolAction } from '../src/lib/pool/actions.js'
import { deriveSpendKey } from '../src/lib/pool/notes.js'
import { entropyFromMnemonic, hdNodeFromEntropy, derivePath, toCashAddress, hexToBytes } from '../src/lib/bch/crypto.js'

const argOf = (name, fallback) => {
    const index = process.argv.indexOf(name)
    return index >= 0 ? process.argv[index + 1] : fallback
}

const MNEMONIC = argOf('--mnemonic')
const AMOUNT = BigInt(argOf('--amount', '0'))
const ACTION = argOf('--action', 'shield')
const RECIPIENT = argOf('--to')
const NETWORK = argOf('--network', 'chipnet')

if (!MNEMONIC || AMOUNT <= 0n) {
    console.error('usage: --mnemonic "<24 words>" --amount <base units> [--action shield|transfer|unshield] [--to <delivery point>]')
    process.exit(1)
}

const entropy = entropyFromMnemonic(MNEMONIC)
const hdNode = hdNodeFromEntropy(entropy)
const accountBase = "m/44'/145'/0'"
const derivationPath = `${accountBase}/0`
const accounts = [0, 1, 2, 3, 4].map((index) => ({
    address: toCashAddress(derivePath(hdNode, `${accountBase}/0/${index}`), NETWORK),
    index,
    branch: 0,
}))
const changeAddress = toCashAddress(derivePath(hdNode, `${accountBase}/1/0`), NETWORK)
const spendKey = deriveSpendKey(hexToBytes(entropy))

console.log('account 0 :', accounts[0].address)
console.log('change    :', changeAddress)
console.log('action    :', ACTION, '| amount:', AMOUNT.toString(), 'base units')

const pool = getProverPool(NETWORK)
if (!pool) {
    console.error('no wallet-prover-compatible pool registered on', NETWORK)
    process.exit(1)
}
console.log('pool      :', pool.id, '| category:', pool.assetCategory.slice(0, 16) + '…')

const cluster = await getCluster(NETWORK)

/* --capture: intercept the broadcast, persist the signed tx, and let the
   pipeline complete so the built bytes can be evaluated input-by-input on the
   BCH-2026 VM (the only way to see WHICH input's script fails). */
const CAPTURE = process.argv.includes('--capture')
if (CAPTURE) {
    const originalRequest = cluster.request.bind(cluster)
    cluster.request = async (method, ...args) => {
        if (method === 'blockchain.transaction.broadcast') {
            const { writeFileSync } = await import('node:fs')
            writeFileSync('/tmp/shield-tx.hex', args[0])
            console.log('captured signed tx -> /tmp/shield-tx.hex (' + args[0].length / 2 + ' B)')
            return 'captured-not-broadcast'
        }
        return originalRequest(method, ...args)
    }
}

/* NOTE PERSISTENCE: a browser keeps the wallet's own shielded notes sealed in
   localStorage; this plain-node driver is stateless, so it keeps them in a file.
   Without it a TRANSFER can never see the note a previous SHIELD created. */
const { writeFileSync } = await import('node:fs')
const NOTES_FILE = argOf('--notes', '/tmp/pool-notes.json')
const loadNotes = () => {
    try {
        /* selectInNotes expects FLAT records { value, ownerPub, rho, r, nk,
           leafIndex } — own notes have nk === spendKey. */
        return JSON.parse(readFileSync(NOTES_FILE, 'utf8')).map((rec) => ({
            value: String(rec.value),
            ownerPub: String(rec.ownerPub),
            rho: String(rec.rho),
            r: String(rec.r),
            nk: spendKey.toString(),
            leafIndex: rec.leafIndex,
        }))
    } catch { return [] }
}
const ownNotes = loadNotes()
console.log('own notes :', ownNotes.length)

const scan = await scanPool({ cluster, pool, networkId: NETWORK, spendKey, notes: ownNotes })
console.log('scan      : actions', scan.actions.length, '| leaves', (scan.leaves || []).length)

const result = await submitPoolAction({
    cluster,
    pool,
    networkId: NETWORK,
    scan,
    hdNode,
    accounts,
    accountBase,
    derivationPath,
    spendKey,
    ownNotes,
    action: ACTION,
    amount: AMOUNT,
    recipientDeliveryPoint: RECIPIENT,
    changeAddress,
    payoutAddress: accounts[0].address,
    wasmUrl: 'public/proving/pool.wasm',
    zkeyUrl: 'public/proving/pool_final.zkey',
    verify: true,
    onStage: async (stage) => console.log('stage     :', stage),
})

/* persist the wallet's own output notes for the NEXT action */
try {
    const prev = (() => { try { return JSON.parse(readFileSync(NOTES_FILE, 'utf8')) } catch { return [] } })()
    const merged = [...prev, ...(result.outNotes || [])]
    const seen = new Set()
    const dedup = merged.filter((r) => { const k = String(r.cm); if (seen.has(k)) return false; seen.add(k); return true })
    writeFileSync(NOTES_FILE, JSON.stringify(dedup, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 1))
    console.log('notes saved:', dedup.length, '->', NOTES_FILE)
} catch (e) { console.log('notes save failed:', String(e.message || e)) }

console.log('')
console.log('=== RESULT ===')
console.log(JSON.stringify(result, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
process.exit(0)
