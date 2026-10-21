/**
 * Solana (SOL) support — address derivation + balance.
 *
 * Solana uses Ed25519 keys derived via SLIP-0010 (NOT the secp256k1 BIP32 used
 * for BCH). Derivation path: m/44'/501'/0'/0' (all hardened; BIP44 coin type
 * 501). The address is the base58 encoding of the 32-byte Ed25519 public key.
 *
 * Reuses the wallet's existing BIP39 seed (from the master entropy), so SOL is
 * derived from the SAME wallet — one seed, many chains.
 *
 * NOTE: SLIP-0010 derivation is verified against the official spec test vector
 *       (seed 000102...0f -> master key 2b4be7f1...e2eb19e7 / m/0' 68e0fe46...).
 *       Only READ (address + balance) is wired; SOL send is a further step.
 */

import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'

/* Import the wallet's existing seed helpers (BIP39 entropy -> seed). */
import { mnemonicFromEntropy, seedFromMnemonic } from '@/lib/bch/crypto.js'

/* SLIP-0010 master key for Ed25519 uses this HMAC key. */
const SLIP10_SEED_KEY = 'ed25519 seed'

/* BIP44 coin type for Solana. */
const SOLANA_COIN_TYPE = 501

/* Public Solana RPC endpoint (balance only; send is a further step). */
export const SOLANA_RPC = 'https://api.mainnet-beta.solana.com'

const HARDENED = 0x80000000

/* ser32 — 4-byte big-endian child index. */
function ser32(i) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, i >>> 0, false)
    return b
}

function concatBytes(...arrs) {
    const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0))
    let o = 0
    for (const a of arrs) { out.set(a, o); o += a.length }
    return out
}

/* SLIP-0010 master (key, chainCode) from a BIP39 seed. */
function slip10Master(seed) {
    const I = hmac(sha512, new TextEncoder().encode(SLIP10_SEED_KEY), seed)
    return { key: I.slice(0, 32), chainCode: I.slice(32) }
}

/* SLIP-0010 hardened child derivation (Ed25519 is hardened-only). */
function slip10Child(node, index) {
    const I = hmac(sha512, node.chainCode, concatBytes(new Uint8Array([0x00]), node.key, ser32(index)))
    return { key: I.slice(0, 32), chainCode: I.slice(32) }
}

/**
 * Derive the Solana account (Ed25519) from the wallet's master entropy.
 * Path: m/44'/501'/<account>'/0'. Returns { privateKey, publicKey, address }.
 */
export function solanaAccountFromEntropy(entropyHex, account = 0) {
    const seed = seedFromMnemonic(mnemonicFromEntropy(entropyHex))
    let node = slip10Master(seed)
    for (const index of [44 + HARDENED, SOLANA_COIN_TYPE + HARDENED, account + HARDENED, 0 + HARDENED]) {
        node = slip10Child(node, index)
    }
    const privateKey = node.key
    const publicKey = ed25519.getPublicKey(privateKey)
    const address = base58.encode(publicKey)
    return { privateKey, publicKey, address }
}

/**
 * Fetch the SOL balance (in SOL) for an address via Solana JSON-RPC getBalance.
 * Returns a Number of SOL (lamports / 1e9). Returns 0 on any error.
 */
export async function fetchSolBalance(address, rpcUrl = SOLANA_RPC) {
    try {
        const res = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getBalance',
                params: [ address ],
            }),
        })
        const json = await res.json()
        const lamports = json && json.result && typeof json.result.value === 'number'
            ? json.result.value
            : 0
        return lamports / 1e9
    } catch (err) {
        console.error(err) // eslint-disable-line no-console

        return 0
    }
}
