/* apps/web/scripts/faucet-claim.mjs
 *
 * The chipnet.bch.ninja PoW faucet claim (dev-only): the demo wallets' plain
 * satoshi top-up for the pool action locks (the standing acceptance recipe).
 *
 *   POST /api/challenge  { address, sats }        -> the challenge (id,
 *                                                      payload, target, …)
 *   PoW: SHA256(payload + ":" + nonce) <= target
 *   POST /api/claim       { ...challenge, nonce: String(nonce) }
 *
 * NOTE the claim format (measured 2026-11-28, two wrong shapes rejected
 * with "Invalid proof format"): the FULL challenge object + the nonce AS A
 * STRING. The id-only forms fail.
 *
 * Usage (from apps/web/):
 *   node scripts/faucet-claim.mjs [--address bchtest:…] [--sats 100000]
 */
import { createHash } from 'node:crypto'

const ARGS = process.argv.slice(2)
const argOf = (name, fallback) => {
    const i = ARGS.indexOf(name)
    return i >= 0 ? ARGS[i + 1] : fallback
}

const ADDRESS = argOf('--address', 'bchtest:qzzu85xnl99u534d9z40yu7c494hknppx5lu29gl8t')
const SATS = argOf('--sats', '100000')

const challenge = await (await fetch('https://chipnet.bch.ninja/api/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address: ADDRESS, sats: SATS }),
})).json()

if (!challenge.payload || !challenge.target) throw new Error('faucet: no challenge: ' + JSON.stringify(challenge).slice(0, 120))
console.log('challenge id', challenge.id, '— solving the PoW…')

let nonce = 0
for (;;) {
    const hex = createHash('sha256').update(challenge.payload + ':' + nonce).digest('hex')
    if (BigInt('0x' + hex) <= BigInt('0x' + challenge.target)) break
    nonce += 1
}
console.log('PoW solved at nonce', nonce)

const claim = await (await fetch('https://chipnet.bch.ninja/api/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...challenge, nonce: String(nonce) }),
})).json()

if (claim.error) throw new Error('faucet claim rejected: ' + JSON.stringify(claim))
console.log('FAUCET OK', JSON.stringify({ address: ADDRESS, sats: SATS, txid: claim.txid }))
