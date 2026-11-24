// apps/web/src/lib/cashaccount/nostr.js
//
// CashAccounts v2 ↔ Nostr integration (spec lines 585-621).
//
//   nostr_seed = HMAC-SHA512(
//       key  = wallet_bip39_seed,
//       data = "CashAccounts/Nostr" || category_id (32 display-order bytes)
//   )
//   BIP32 seed = the 64-byte HMAC result
//   path       = m/44'/1237'/<rotation>'/0/0        (NIP-06)
//
// The x-only public key is displayed as an `npub` and stored as the last 32
// bytes of the Identity NFT commitment. Nostr EVENTS use BIP340 Schnorr
// (@noble/curves). The COVENANT proof uses BCH Schnorr with sighash 0x61 and
// an even-Y key: if the derived compressed key starts with 0x03, the private
// key is negated modulo the curve order before signing (spec line 612).

import { HDKey } from '@scure/bip32'
import { bech32 } from '@scure/base'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { binToHex, hexToBin, hmacSha512, sha256 } from '@bitauth/libauth'
import { normalizeHex } from './identifier.js'

export const NOSTR_DERIVATION_PREFIX = 'CashAccounts/Nostr'
export const NOSTR_COIN_TYPE = 1237
export const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

const textEncoder = new TextEncoder()

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
 * Encode a 32-byte x-only key as an npub.
 *
 * @param {Uint8Array|string} xOnlyPublicKey
 * @returns {string}
 */
export function npubEncode(xOnlyPublicKey) {
    const bytes = typeof xOnlyPublicKey === 'string'
        ? hexToBin(normalizeHex(xOnlyPublicKey))
        : xOnlyPublicKey

    if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
        throw new Error('nostr: npubEncode expects a 32-byte x-only public key')
    }

    return bech32.encode('npub', bech32.toWords(bytes))
}

/**
 * Decode an npub to its 32-byte x-only key.
 *
 * @param {string} npub
 * @returns {string} lowercase hex
 */
export function npubDecode(npub) {
    const { prefix, words } = bech32.decode(npub, 1000)

    if (prefix !== 'npub') {
        throw new Error(`nostr: expected an npub, got ${prefix}`)
    }

    return binToHex(bech32.fromWords(words))
}

/**
 * Derive a CashAccount's Nostr key.
 *
 * @param {object} params
 * @param {Uint8Array} params.bip39Seed - the wallet's 64-byte BIP39 seed
 * @param {string} params.categoryHex - the Identity NFT category (display order)
 * @param {number} [params.rotation=0] - the binding's rotation index
 * @returns {{ privateKey: Uint8Array, publicKey: Uint8Array, xOnlyPublicKey: Uint8Array, npub: string, path: string }}
 */
export function deriveNostrKey({ bip39Seed, categoryHex, rotation = 0 }) {
    if (!(bip39Seed instanceof Uint8Array)) {
        throw new Error('nostr: bip39Seed must be a Uint8Array')
    }

    const category = hexToBin(normalizeHex(categoryHex))

    if (category.length !== 32) {
        throw new Error('nostr: category must be 32 bytes')
    }

    if (!Number.isInteger(rotation) || rotation < 0 || rotation > 0x7fffffff) {
        throw new Error('nostr: rotation must be a non-negative hardened index')
    }

    const seed = hmacSha512(bip39Seed, concatBytes([
        textEncoder.encode(NOSTR_DERIVATION_PREFIX),
        category,
    ]))

    const path = `m/44'/${NOSTR_COIN_TYPE}'/${rotation}'/0/0`
    const node = HDKey.fromMasterSeed(seed).derive(path)
    const privateKey = node.privateKey
    const xOnlyPublicKey = schnorr.getPublicKey(privateKey)

    return {
        privateKey,
        publicKey: node.publicKey,
        xOnlyPublicKey,
        npub: npubEncode(xOnlyPublicKey),
        path,
    }
}

/**
 * The BCH covenant's Nostr proof key: the same secret, normalized to the
 * even-Y point the covenant reconstructs from `0x02 || xOnlyKey`.
 *
 * @param {Uint8Array} privateKey
 * @returns {Uint8Array} 32-byte secret whose compressed public key starts 0x02
 */
export function toBchNostrProofKey(privateKey) {
    /* `schnorr.getPublicKey` returns x-only bytes; the ECDSA compressed point
       carries the Y parity the covenant reconstructs with the 0x02 prefix. */
    const full = secp256k1.getPublicKey(privateKey, true)

    if (full[0] === 0x02) {
        return privateKey
    }

    const value = BigInt(`0x${binToHex(privateKey)}`)
    const negated = SECP256K1_ORDER - value

    return hexToBin(negated.toString(16).padStart(64, '0'))
}

/**
 * Build and sign a NIP-01 event with BIP340 Schnorr.
 *
 * @param {object} params
 * @param {Uint8Array} params.privateKey
 * @param {number} [params.kind=0]
 * @param {string} [params.content='']
 * @param {Array} [params.tags=[]]
 * @param {number} [params.createdAt]
 * @returns {object} the signed event
 */
export function signNostrEvent({ privateKey, kind = 0, content = '', tags = [], createdAt = Math.floor(Date.now() / 1000) }) {
    const pubkey = binToHex(schnorr.getPublicKey(privateKey))
    const serialized = JSON.stringify([0, pubkey, createdAt, kind, tags, content])
    const id = binToHex(sha256.hash(textEncoder.encode(serialized)))
    const sig = binToHex(schnorr.sign(hexToBin(id), privateKey))

    return {
        id,
        pubkey,
        created_at: createdAt,
        kind,
        tags,
        content,
        sig,
    }
}

/**
 * Verify a NIP-01 event's id and BIP340 signature.
 *
 * @param {object} event
 * @returns {boolean}
 */
export function verifyNostrEvent(event) {
    const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
    const id = binToHex(sha256.hash(textEncoder.encode(serialized)))

    if (id !== event.id) {
        return false
    }

    return schnorr.verify(hexToBin(event.sig), hexToBin(event.id), hexToBin(event.pubkey))
}

/**
 * Publish a signed event to one relay (NIP-01). Resolves when the relay
 * acknowledges the event (`["OK", id, true, …]`); rejects on a false ACK,
 * socket error, or timeout.
 *
 * @param {string} url - e.g. wss://nos.lol
 * @param {object} event
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ relay: string, message: string }>}
 */
export function publishToRelay(url, event, { timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url)
        let settled = false

        const finish = (callback, value) => {
            if (settled) {
                return
            }

            settled = true
            clearTimeout(timer)

            try {
                socket.close()
            } catch (error) {
                /* already closed */
            }

            callback(value)
        }

        const timer = setTimeout(() => finish(reject, new Error(`nostr: relay ${url} timed out`)), timeoutMs)

        socket.onopen = () => socket.send(JSON.stringify(['EVENT', event]))

        socket.onmessage = (message) => {
            try {
                const payload = JSON.parse(message.data)

                if (payload[0] === 'OK' && payload[1] === event.id) {
                    if (payload[2] === true) {
                        finish(resolve, { relay: url, message: payload[3] || '' })
                    } else {
                        finish(reject, new Error(`nostr: relay ${url} rejected the event: ${payload[3] || ''}`))
                    }
                }
            } catch (error) {
                /* ignore non-JSON frames */
            }
        }

        socket.onerror = () => finish(reject, new Error(`nostr: relay ${url} connection failed`))
        socket.onclose = () => finish(reject, new Error(`nostr: relay ${url} closed before ACK`))
    })
}
