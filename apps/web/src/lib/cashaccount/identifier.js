// apps/web/src/lib/cashaccount/identifier.js
//
// Pure CashAccounts v2 identifier logic (no network, no chain):
//
//   Collision Hash = SHA256(SHA256(blockHash || categoryId))
//   Minimal Identifier = <AccountName>#<first 2 bytes, UPPERCASE hex>
//   Extension = the next bytes of the same hash, lowercase hex
//   Identicon = the full 32-byte hash as a big-endian integer, modulo 128
//   Color = the first 3 bytes of the hash
//   Pre-confirmation = <AccountName>#FFFF.00 (no identicon)
//
// Sources: CashAccountV2.md lines 90-141 (name/collision/extension),
// 143-330 (identicon + color), 420-430 (pre-confirmation), 432-440
// (earliest-confirmed ordering for the minimal identifier).

import { binToHex, hexToBin, sha256 } from '@bitauth/libauth'
import { IDENTICON_CODE_POINTS, IDENTICON_NAMES } from './identicons.js'

/* The spec's strict ASCII account-name rule. */
export const ACCOUNT_NAME_REGEX = /^[a-zA-Z0-9_]{2,32}$/

/* The number of identicon glyphs. */
export const IDENTICON_COUNT = 128

/* The pre-confirmation placeholder (spec line ~426). */
export const PENDING_COLLISION = 'FFFF'
export const PENDING_EXTENSION = '00'

/* Maximum extension length: the hash is 32 bytes; the minimal id uses the
   first 2 bytes, so at most the remaining 30 bytes (60 hex digits) extend it. */
export const MAX_EXTENSION_NYBBLES = 60

/**
 * Normalize a hex string from any of the shapes this codebase receives:
 * `0x…`, GraphQL/Postgres `\x…`, or bare hex. Returns lowercase bare hex.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeHex(value) {
    if (typeof value !== 'string') {
        throw new TypeError('normalizeHex: expected a hex string')
    }

    return value.replace(/^\\x/, '').replace(/^0x/i, '').toLowerCase()
}

/**
 * Validate an Account Name against the spec's regex.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isValidAccountName(name) {
    return typeof name === 'string' && ACCOUNT_NAME_REGEX.test(name)
}

/**
 * Compute the full 32-byte Collision Hash.
 *
 * The block hash and the NFT category are decoded from their DISPLAY-ORDER
 * hex, concatenated (block hash first), and double-SHA256 hashed.
 *
 * @param {string} blockHashHex - the block that mined the registration
 * @param {string} categoryHex - the Identity NFT category (display order)
 * @returns {string} 64 lowercase hex characters
 */
export function collisionHash(blockHashHex, categoryHex) {
    const blockHash = hexToBin(normalizeHex(blockHashHex))
    const category = hexToBin(normalizeHex(categoryHex))

    if (blockHash.length !== 32) {
        throw new Error(`collisionHash: block hash must be 32 bytes (got ${blockHash.length})`)
    }

    if (category.length !== 32) {
        throw new Error(`collisionHash: category must be 32 bytes (got ${category.length})`)
    }

    const concatenated = new Uint8Array(64)
    concatenated.set(blockHash, 0)
    concatenated.set(category, 32)

    const digest = sha256.hash(sha256.hash(concatenated))

    return binToHex(digest)
}

/**
 * The four uppercase hex digits after the `#`.
 *
 * @param {string} hash - full collision hash (hex)
 * @returns {string}
 */
export function minimalCollision(hash) {
    return normalizeHex(hash).slice(0, 4).toUpperCase()
}

/**
 * The lowercase Collision Hash Extension (the next `nybbles` hex digits).
 *
 * @param {string} hash - full collision hash (hex)
 * @param {number} [nybbles=2] - even count, 2..60
 * @returns {string}
 */
export function collisionExtension(hash, nybbles = 2) {
    if (nybbles < 2 || nybbles > MAX_EXTENSION_NYBBLES || nybbles % 2 !== 0) {
        throw new Error(`collisionExtension: nybbles must be an even number from 2 to ${MAX_EXTENSION_NYBBLES}`)
    }

    return normalizeHex(hash).slice(4, 4 + nybbles)
}

/**
 * The identicon index: the full hash as an unsigned big-endian integer,
 * modulo 128.
 *
 * @param {string} hash - full collision hash (hex)
 * @returns {number} 0..127
 */
export function identiconIndex(hash) {
    const normalized = normalizeHex(hash)

    if (!/^[0-9a-f]{64}$/.test(normalized)) {
        throw new Error('identiconIndex: expected a 32-byte collision hash')
    }

    return Number(BigInt(`0x${normalized}`) % BigInt(IDENTICON_COUNT))
}

/**
 * The full identicon record for a collision hash.
 *
 * @param {string} hash
 * @returns {{ index: number, emoji: string, name: string }}
 */
export function identiconFor(hash) {
    const index = identiconIndex(hash)

    return {
        index,
        emoji: String.fromCodePoint(IDENTICON_CODE_POINTS[index]),
        name: IDENTICON_NAMES[index],
    }
}

/**
 * The optional account color: the first 3 bytes of the collision hash.
 *
 * @param {string} hash
 * @returns {string} `#rrggbb`
 */
export function accountColor(hash) {
    return `#${normalizeHex(hash).slice(0, 6)}`
}

/**
 * Format a Complete Identifier.
 *
 * @param {string} name
 * @param {string} hash - full collision hash
 * @param {{ extensionNybbles?: number }} [options]
 * @returns {string}
 */
export function formatIdentifier(name, hash, { extensionNybbles = 0 } = {}) {
    const base = `${name}#${minimalCollision(hash)}`

    if (extensionNybbles === 0) {
        return base
    }

    return `${base}.${collisionExtension(hash, extensionNybbles)}`
}

/**
 * The pre-confirmation identifier: `Name#FFFF.00`, with no identicon.
 *
 * @param {string} name
 * @returns {string}
 */
export function pendingIdentifier(name) {
    return `${name}#${PENDING_COLLISION}.${PENDING_EXTENSION}`
}

/**
 * Parse a Complete/Minimal Identifier (with or without an extension).
 *
 * A trailing identicon is ignored (the spec allows it to be prepended,
 * appended, or displayed separately). The parser is deliberately not
 * end-anchored for that reason; the account-name group is anchored.
 *
 * @param {string} text
 * @returns {{ name: string, collision: string, extension: string|null }|null}
 */
export function parseIdentifier(text) {
    if (typeof text !== 'string') {
        return null
    }

    const match = /^([a-zA-Z0-9_]{2,32})#([0-9a-fA-F]{4})(?:\.([0-9a-fA-F]{2,60}))?/.exec(text.trim())

    if (!match) {
        return null
    }

    const name = match[1]

    if (!isValidAccountName(name)) {
        return null
    }

    return {
        name,
        collision: match[2].toUpperCase(),
        extension: match[3] ? match[3].toLowerCase() : null,
    }
}

/**
 * Assign identifiers to a name group.
 *
 * The earliest confirmed registration (block height, then transaction
 * position) keeps the Minimal Identifier. Later registrations sharing the
 * same four-digit prefix receive the shortest Collision Hash Extension that
 * distinguishes them from every earlier registration in the group.
 *
 * @param {Array<{ name: string, collisionHash: string, height: number|string, transactionIndex?: number|string }>} registrations
 * @returns {Array<object>} the same records, plus `extensionNybbles`,
 *   `extension`, `identifier` and `minimal`.
 */
export function assignIdentifiers(registrations) {
    const groups = new Map()

    for (const registration of registrations) {
        const key = String(registration.name).toUpperCase()

        if (!groups.has(key)) {
            groups.set(key, [])
        }

        groups.get(key).push(registration)
    }

    const result = []

    for (const group of groups.values()) {
        group.sort((a, b) => {
            const heightDelta = Number(a.height) - Number(b.height)

            if (heightDelta !== 0) {
                return heightDelta
            }

            return Number(a.transactionIndex || 0) - Number(b.transactionIndex || 0)
        })

        const earlier = []

        for (const registration of group) {
            const hash = normalizeHex(registration.collisionHash)
            const prefix = hash.slice(0, 4)
            const collisions = earlier.filter((other) => other.hash.slice(0, 4) === prefix)

            let extensionNybbles = 0
            let extension = ''

            if (collisions.length > 0) {
                extensionNybbles = 2

                while (extensionNybbles <= MAX_EXTENSION_NYBBLES) {
                    extension = hash.slice(4, 4 + extensionNybbles)
                    const clash = collisions.some((other) => other.hash.slice(4, 4 + extensionNybbles) === extension)

                    if (!clash) {
                        break
                    }

                    extensionNybbles += 2
                }

                if (extensionNybbles > MAX_EXTENSION_NYBBLES) {
                    extensionNybbles = MAX_EXTENSION_NYBBLES
                    extension = hash.slice(4, 4 + MAX_EXTENSION_NYBBLES)
                }
            }

            const record = {
                ...registration,
                extensionNybbles,
                extension,
                identifier: formatIdentifier(registration.name, hash, { extensionNybbles }),
                minimal: extensionNybbles === 0,
            }

            earlier.push({ hash })
            result.push(record)
        }
    }

    return result
}
