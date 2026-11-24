// apps/web/src/lib/cashaccount/cashid.js
//
// CashID authentication for CashAccounts v2 (spec lines 483-557).
//
// A service issues:   cashid:<host><path>?x=<32 hex>[&e=<unix>]
// The wallet replies:  cashid:<host><path>?x=<32 hex>[&e=<unix>]&d=<category>:<txid>:<vout>
// and signs the EXACT response URI with the CashCode spend key tweaked by
//
//   tweak = SHA256("CashID/v2" || spendPubKey (33 bytes) || UTF-8(response URI))
//
// (interpreted as an unsigned big-endian scalar). The signature is BCH
// Schnorr over the standard Bitcoin Signed Message digest, Base64-encoded.
// The returned address is the P2PKH CashAddress of the tweaked public key.

import {
    base64ToBin,
    binToBase64,
    binToHex,
    hash256,
    hexToBin,
    instantiateSecp256k1,
    publicKeyToP2pkhCashAddress,
    sha256,
} from '@bitauth/libauth'
import { getNetwork } from '../bch/networks.js'
import { normalizeHex } from './identifier.js'

export const CASHID_SCHEME = 'cashid:'
export const CASHID_DOMAIN = 'CashID/v2'

const textEncoder = new TextEncoder()

/* Lazy libauth secp256k1 (WASM) instance. */
let _secp256k1 = null

async function getSecp256k1() {
    if (!_secp256k1) {
        _secp256k1 = await instantiateSecp256k1()
    }

    return _secp256k1
}

/**
 * Concatenate byte arrays.
 *
 * @param {Uint8Array[]} parts
 * @returns {Uint8Array}
 */
function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const result = new Uint8Array(total)
    let offset = 0

    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }

    return result
}

/**
 * Bitcoin variable-length integer.
 *
 * @param {number} value
 * @returns {Uint8Array}
 */
function encodeVarInt(value) {
    if (value < 0xfd) {
        return Uint8Array.of(value)
    }

    if (value <= 0xffff) {
        return Uint8Array.of(0xfd, value & 0xff, (value >>> 8) & 0xff)
    }

    if (value <= 0xffffffff) {
        return Uint8Array.of(0xfe, value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff)
    }

    throw new Error('cashid: message too long for the BSM varint')
}

/**
 * The standard Bitcoin Signed Message digest:
 *   SHA256(SHA256("\x18Bitcoin Signed Message:\n" || varint(len) || message))
 *
 * @param {string} message
 * @returns {Uint8Array} 32-byte digest
 */
export function bitcoinSignedMessageHash(message) {
    const magic = concatBytes([
        Uint8Array.of(0x18),
        textEncoder.encode('Bitcoin Signed Message:\n'),
    ])
    const body = textEncoder.encode(message)

    return hash256(concatBytes([magic, encodeVarInt(body.length), body]))
}

/**
 * Parse a CashID challenge URI.
 *
 * The path is preserved exactly as issued. A missing path stays empty (the
 * service's endpoint default of `/cashid` is a service concern, not a URI
 * rewrite).
 *
 * @param {string} uri
 * @returns {{ host: string, path: string, nonce: string, expiry: number|null, uri: string }}
 */
export function parseChallenge(uri) {
    if (typeof uri !== 'string' || !uri.startsWith(CASHID_SCHEME)) {
        throw new Error('cashid: expected a cashid: URI')
    }

    const rest = uri.slice(CASHID_SCHEME.length)
    const queryIndex = rest.indexOf('?')
    const authority = queryIndex === -1 ? rest : rest.slice(0, queryIndex)
    const query = queryIndex === -1 ? '' : rest.slice(queryIndex + 1)
    const slashIndex = authority.indexOf('/')
    const host = slashIndex === -1 ? authority : authority.slice(0, slashIndex)
    const path = slashIndex === -1 ? '' : authority.slice(slashIndex)

    if (!/^[a-z0-9.-]+$/.test(host)) {
        throw new Error('cashid: host must be a lowercase ASCII hostname')
    }

    const params = new URLSearchParams(query)
    const nonce = params.get('x')
    const expiryValue = params.get('e')

    if (!nonce || !/^[0-9a-f]{32}$/.test(nonce)) {
        throw new Error('cashid: x must be 32 lowercase hex characters')
    }

    if (expiryValue !== null && !/^[0-9]+$/.test(expiryValue)) {
        throw new Error('cashid: e must be a Unix timestamp')
    }

    return {
        host,
        path,
        nonce,
        expiry: expiryValue === null ? null : Number(expiryValue),
        uri,
    }
}

/**
 * Parse a CashID response URI (challenge + the `d` outpoint data).
 *
 * @param {string} uri
 * @returns {object} the challenge plus `data: { category, txid, vout }`
 */
export function parseResponse(uri) {
    const challenge = parseChallenge(uri)
    const params = new URLSearchParams(uri.slice(uri.indexOf('?') + 1))
    const data = params.get('d')

    if (!data) {
        throw new Error('cashid: response is missing the d parameter')
    }

    const match = /^([0-9a-f]{64}):([0-9a-f]{64}):([0-9]+)$/.exec(data)

    if (!match) {
        throw new Error('cashid: d must be <category>:<txid>:<vout>')
    }

    return {
        ...challenge,
        data: {
            category: match[1],
            txid: match[2],
            vout: Number(match[3]),
        },
    }
}

/**
 * Build the exact Challenge Response URI.
 *
 * @param {object} challenge - the result of parseChallenge()
 * @param {{ category: string, txid: string, vout: number }} outpoint
 * @returns {string}
 */
export function buildResponseUri(challenge, { category, txid, vout }) {
    if (!Number.isInteger(vout) || vout < 0) {
        throw new Error('cashid: vout must be a non-negative integer')
    }

    const data = `${normalizeHex(category)}:${normalizeHex(txid)}:${vout}`
    const expiry = challenge.expiry === null ? '' : `&e=${challenge.expiry}`

    return `${CASHID_SCHEME}${challenge.host}${challenge.path}?x=${challenge.nonce}${expiry}&d=${data}`
}

/**
 * The CashID key tweak (a 32-byte big-endian scalar).
 *
 * @param {{ spendPubkey: Uint8Array|string, responseUri: string }} params
 * @returns {Uint8Array}
 */
export function cashIdTweak({ spendPubkey, responseUri }) {
    const publicKey = typeof spendPubkey === 'string'
        ? hexToBin(normalizeHex(spendPubkey))
        : spendPubkey

    if (!(publicKey instanceof Uint8Array) || publicKey.length !== 33) {
        throw new Error('cashid: spend pubkey must be 33 compressed bytes')
    }

    return sha256.hash(concatBytes([
        textEncoder.encode(CASHID_DOMAIN),
        publicKey,
        textEncoder.encode(responseUri),
    ]))
}

/**
 * Sign a CashID response with the CashCode spend key.
 *
 * @param {object} params
 * @param {Uint8Array} params.spendPrivateKey - 32 bytes
 * @param {Uint8Array|string} params.spendPubkey - 33 compressed bytes
 * @param {string} params.responseUri
 * @param {string} [params.network='mainnet']
 * @returns {Promise<{ request: string, address: string, signature: string }>}
 */
export async function signCashIdResponse({ spendPrivateKey, spendPubkey, responseUri, network = 'mainnet' }) {
    const secp256k1 = await getSecp256k1()
    const tweak = cashIdTweak({ spendPubkey, responseUri })
    const tweakedPrivateKey = secp256k1.addTweakPrivateKey(spendPrivateKey, tweak)

    if (typeof tweakedPrivateKey === 'string') {
        throw new Error(`cashid: tweak failed (${tweakedPrivateKey})`)
    }

    const tweakedPublicKey = secp256k1.derivePublicKeyCompressed(tweakedPrivateKey)

    if (typeof tweakedPublicKey === 'string') {
        throw new Error(`cashid: key derivation failed (${tweakedPublicKey})`)
    }

    const digest = bitcoinSignedMessageHash(responseUri)
    const signature = secp256k1.signMessageHashSchnorr(tweakedPrivateKey, digest)

    if (typeof signature === 'string') {
        throw new Error(`cashid: signing failed (${signature})`)
    }

    const { address } = publicKeyToP2pkhCashAddress({
        publicKey: tweakedPublicKey,
        prefix: getNetwork(network).addressPrefix,
    })

    return {
        request: responseUri,
        address,
        signature: binToBase64(signature),
    }
}

/**
 * Verify a CashID response against the account's current spend pubkey.
 *
 * @param {object} params
 * @param {{ request: string, address: string, signature: string }} params.response
 * @param {Uint8Array|string} params.spendPubkey
 * @param {string} [params.network='mainnet']
 * @returns {Promise<{ valid: boolean, address: string, reason?: string }>}
 */
export async function verifyCashIdResponse({ response, spendPubkey, network = 'mainnet' }) {
    const secp256k1 = await getSecp256k1()
    const publicKey = typeof spendPubkey === 'string'
        ? hexToBin(normalizeHex(spendPubkey))
        : spendPubkey
    const tweak = cashIdTweak({ spendPubkey: publicKey, responseUri: response.request })
    const tweakedPublicKey = secp256k1.addTweakPublicKeyCompressed(publicKey, tweak)

    if (typeof tweakedPublicKey === 'string') {
        return { valid: false, address: '', reason: tweakedPublicKey }
    }

    const digest = bitcoinSignedMessageHash(response.request)
    const signature = base64ToBin(response.signature)
    const validSignature = secp256k1.verifySignatureSchnorr(signature, tweakedPublicKey, digest)
    const { address } = publicKeyToP2pkhCashAddress({
        publicKey: tweakedPublicKey,
        prefix: getNetwork(network).addressPrefix,
    })

    if (!validSignature) {
        return { valid: false, address, reason: 'signature does not verify' }
    }

    if (address !== response.address) {
        return { valid: false, address, reason: 'address does not match the tweaked key' }
    }

    return { valid: true, address }
}
