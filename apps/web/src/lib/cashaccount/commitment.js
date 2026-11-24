// apps/web/src/lib/cashaccount/commitment.js
//
// CashAccounts v2 Identity NFT commitment codec.
//
// Layout (spec lines 355-366):
//   1  byte   version          0x02
//   1  byte   CashCode network 0x01 (mainnet) | 0x05 (any testnet)
//   1  byte   CashCode prefix  0x00 | 0x04 | 0x08 | 0x0c | 0x10
//   33 bytes  scan pubkey      compressed secp256k1
//   4  bytes  expiry           unsigned big-endian (0 = none)
//   32 bytes  Nostr pubkey     optional (x-only)
//
// Total: 40 bytes without the Nostr key, 72 bytes with it.

import { binToHex, hexToBin } from '@bitauth/libauth'
import { normalizeHex } from './identifier.js'

export const COMMITMENT_VERSION = 0x02

/* The spec's CashCode network bytes. */
export const NETWORK_BYTES = {
    mainnet: 0x01,
    chipnet: 0x05,
    testnet: 0x05,
}

/* Reverse map for decoding; 0x05 means "any testnet". */
export const NETWORKS_BY_BYTE = {
    0x01: 'mainnet',
    0x05: 'chipnet',
}

/* The five permitted CashCode prefix values (0, 4, 8, 12, 16 bits). */
export const PREFIX_BYTES = [0x00, 0x04, 0x08, 0x0c, 0x10]

/**
 * The commitment length for a given shape.
 *
 * @param {boolean} hasNostrKey
 * @returns {40|72}
 */
export function commitmentLength(hasNostrKey) {
    return hasNostrKey ? 72 : 40
}

/**
 * Encode a v2 Identity NFT commitment.
 *
 * @param {object} fields
 * @param {string} fields.network - 'mainnet' | 'chipnet' (or a raw byte)
 * @param {number} fields.prefix - one of PREFIX_BYTES
 * @param {Uint8Array|string} fields.scanPubkey - 33-byte compressed key (bytes or hex)
 * @param {number} [fields.expiry=0] - unsigned 32-bit seconds
 * @param {Uint8Array|string|null} [fields.nostrPubkey=null] - 32-byte x-only key
 * @returns {Uint8Array}
 */
export function encodeCommitment({ network, prefix, scanPubkey, expiry = 0, nostrPubkey = null }) {
    const networkByte = typeof network === 'number'
        ? network
        : NETWORK_BYTES[network]

    if (networkByte !== 0x01 && networkByte !== 0x05) {
        throw new Error(`commitment: unsupported network byte ${networkByte}`)
    }

    if (!PREFIX_BYTES.includes(prefix)) {
        throw new Error(`commitment: unsupported prefix byte ${prefix}`)
    }

    const scan = typeof scanPubkey === 'string'
        ? hexToBin(normalizeHex(scanPubkey))
        : scanPubkey

    if (!(scan instanceof Uint8Array) || scan.length !== 33) {
        throw new Error('commitment: scan pubkey must be 33 compressed bytes')
    }

    if (scan[0] !== 0x02 && scan[0] !== 0x03) {
        throw new Error('commitment: scan pubkey must start with 0x02 or 0x03')
    }

    if (!Number.isInteger(expiry) || expiry < 0 || expiry > 0xffffffff) {
        throw new Error('commitment: expiry must be an unsigned 32-bit integer')
    }

    let nostr = null

    if (nostrPubkey !== null && nostrPubkey !== undefined) {
        nostr = typeof nostrPubkey === 'string'
            ? hexToBin(normalizeHex(nostrPubkey))
            : nostrPubkey

        if (!(nostr instanceof Uint8Array) || nostr.length !== 32) {
            throw new Error('commitment: Nostr pubkey must be 32 bytes')
        }
    }

    const length = commitmentLength(nostr !== null)
    const bytes = new Uint8Array(length)

    bytes[0] = COMMITMENT_VERSION
    bytes[1] = networkByte
    bytes[2] = prefix
    bytes.set(scan, 3)
    bytes[36] = (expiry >>> 24) & 0xff
    bytes[37] = (expiry >>> 16) & 0xff
    bytes[38] = (expiry >>> 8) & 0xff
    bytes[39] = expiry & 0xff

    if (nostr) {
        bytes.set(nostr, 40)
    }

    return bytes
}

/**
 * Decode a v2 Identity NFT commitment.
 *
 * @param {Uint8Array|string} value - bytes or hex (with/without `\x`)
 * @returns {object}
 */
export function decodeCommitment(value) {
    const bytes = typeof value === 'string'
        ? hexToBin(normalizeHex(value))
        : value

    if (!(bytes instanceof Uint8Array)) {
        throw new Error('commitment: expected bytes or a hex string')
    }

    if (bytes.length !== 40 && bytes.length !== 72) {
        throw new Error(`commitment: length must be 40 or 72 bytes (got ${bytes.length})`)
    }

    if (bytes[0] !== COMMITMENT_VERSION) {
        throw new Error(`commitment: unsupported version 0x${bytes[0].toString(16).padStart(2, '0')}`)
    }

    const networkByte = bytes[1]

    if (networkByte !== 0x01 && networkByte !== 0x05) {
        throw new Error(`commitment: unsupported network byte 0x${networkByte.toString(16)}`)
    }

    const prefix = bytes[2]

    if (!PREFIX_BYTES.includes(prefix)) {
        throw new Error(`commitment: unsupported prefix byte 0x${prefix.toString(16)}`)
    }

    const scanPubkey = bytes.slice(3, 36)

    if (scanPubkey[0] !== 0x02 && scanPubkey[0] !== 0x03) {
        throw new Error('commitment: scan pubkey must start with 0x02 or 0x03')
    }

    const expiry = ((bytes[36] << 24) >>> 0) + (bytes[37] << 16) + (bytes[38] << 8) + bytes[39]
    const nostrPubkey = bytes.length === 72 ? bytes.slice(40, 72) : null

    return {
        version: bytes[0],
        networkByte,
        network: NETWORKS_BY_BYTE[networkByte],
        prefix,
        scanPubkey: binToHex(scanPubkey),
        expiry,
        nostrPubkey: nostrPubkey ? binToHex(nostrPubkey) : null,
        bytes: binToHex(bytes),
        length: bytes.length,
    }
}
