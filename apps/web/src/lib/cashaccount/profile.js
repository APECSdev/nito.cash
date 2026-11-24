// apps/web/src/lib/cashaccount/profile.js
//
// CashAccounts v2 registration output 1 (the profile OP_RETURN).
//
// Script shape (spec lines 368-393):
//
//   OP_RETURN
//   push(0x01010102)                 <- protocol identifier
//   push(<ACCOUNT_NAME>)             <- ASCII, 2..32 chars
//   push(0x01 || <AVATAR_CID>)       <- optional
//   push(0x02 || <DISPLAY_NAME>)     <- optional, UTF-8
//   push(0x03 || <BIO>)              <- optional, UTF-8
//   push(0x04 || <URL> [ URL ... ])  <- optional, space-separated
//
// The tag is the first byte of the pushed data. This matches the live
// mainnet registration 8267bff0… (output 1), whose pushes are
// `12 02 "Kallisti.cash🍏"` and `15 04 "https://kallisti.io"`.
//
// The whole OP_RETURN script must fit the 223-byte relay limit.

import { binToHex, encodeDataPush, hexToBin } from '@bitauth/libauth'
import { isValidAccountName, normalizeHex } from './identifier.js'

export const PROTOCOL_ID = '01010102'
export const REGISTRATION_PREFIX = `6a04${PROTOCOL_ID}` // 6a0401010102
export const MAX_OP_RETURN_BYTES = 223

export const FIELD_TAGS = {
    avatar: 0x01,
    displayName: 0x02,
    bio: 0x03,
    urls: 0x04,
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

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
 * Read one data push from a script.
 *
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @returns {{ data: Uint8Array, next: number }}
 */
function readPush(bytes, offset) {
    if (offset >= bytes.length) {
        throw new Error('profile: unexpected end of script')
    }

    const opcode = bytes[offset]

    if (opcode === 0x00) {
        return { data: new Uint8Array(0), next: offset + 1 }
    }

    if (opcode >= 0x01 && opcode <= 0x4b) {
        const end = offset + 1 + opcode

        if (end > bytes.length) {
            throw new Error('profile: truncated direct push')
        }

        return { data: bytes.slice(offset + 1, end), next: end }
    }

    if (opcode === 0x4c) {
        const length = bytes[offset + 1]
        const end = offset + 2 + length

        if (end > bytes.length) {
            throw new Error('profile: truncated OP_PUSHDATA1')
        }

        return { data: bytes.slice(offset + 2, end), next: end }
    }

    if (opcode === 0x4d) {
        const length = bytes[offset + 1] | (bytes[offset + 2] << 8)
        const end = offset + 3 + length

        if (end > bytes.length) {
            throw new Error('profile: truncated OP_PUSHDATA2')
        }

        return { data: bytes.slice(offset + 3, end), next: end }
    }

    if (opcode === 0x4e) {
        const length = bytes[offset + 1] | (bytes[offset + 2] << 8) | (bytes[offset + 3] << 16) | (bytes[offset + 4] << 24)
        const end = offset + 5 + length

        if (end > bytes.length) {
            throw new Error('profile: truncated OP_PUSHDATA4')
        }

        return { data: bytes.slice(offset + 5, end), next: end }
    }

    throw new Error(`profile: unexpected opcode 0x${opcode.toString(16)}`)
}

/**
 * Encode the registration profile OP_RETURN.
 *
 * @param {object} fields
 * @param {string} fields.name - account name (ASCII, 2..32 chars)
 * @param {Uint8Array|string|null} [fields.avatar=null] - avatar CID bytes/text
 * @param {string|null} [fields.displayName=null]
 * @param {string|null} [fields.bio=null]
 * @param {string[]|string|null} [fields.urls=null] - one string or an array
 * @returns {Uint8Array} the full OP_RETURN locking bytecode
 */
export function encodeProfile({ name, avatar = null, displayName = null, bio = null, urls = null }) {
    if (!isValidAccountName(name)) {
        throw new Error('profile: account name must match /^[a-zA-Z0-9_]{2,32}$/')
    }

    const parts = [
        Uint8Array.of(0x6a),
        encodeDataPush(hexToBin(PROTOCOL_ID)),
        encodeDataPush(textEncoder.encode(name)),
    ]

    if (avatar !== null && avatar !== undefined) {
        const avatarBytes = typeof avatar === 'string' ? textEncoder.encode(avatar) : avatar
        parts.push(encodeDataPush(concatBytes([Uint8Array.of(FIELD_TAGS.avatar), avatarBytes])))
    }

    if (displayName !== null && displayName !== undefined && displayName !== '') {
        parts.push(encodeDataPush(concatBytes([Uint8Array.of(FIELD_TAGS.displayName), textEncoder.encode(displayName)])))
    }

    if (bio !== null && bio !== undefined && bio !== '') {
        parts.push(encodeDataPush(concatBytes([Uint8Array.of(FIELD_TAGS.bio), textEncoder.encode(bio)])))
    }

    if (urls !== null && urls !== undefined) {
        const list = Array.isArray(urls) ? urls : [urls]
        const joined = list.filter((url) => url !== '').join(' ')

        if (joined !== '') {
            parts.push(encodeDataPush(concatBytes([Uint8Array.of(FIELD_TAGS.urls), textEncoder.encode(joined)])))
        }
    }

    const script = concatBytes(parts)

    if (script.length > MAX_OP_RETURN_BYTES) {
        throw new Error(`profile: OP_RETURN is ${script.length} bytes (limit ${MAX_OP_RETURN_BYTES})`)
    }

    return script
}

/**
 * Decode a registration profile OP_RETURN.
 *
 * @param {Uint8Array|string} value - bytes or hex (with/without `\x`)
 * @returns {object}
 */
export function decodeProfile(value) {
    const bytes = typeof value === 'string'
        ? hexToBin(normalizeHex(value))
        : value

    if (!(bytes instanceof Uint8Array)) {
        throw new Error('profile: expected bytes or a hex string')
    }

    if (bytes.length < 1 || bytes[0] !== 0x6a) {
        throw new Error('profile: not an OP_RETURN output')
    }

    const protocol = readPush(bytes, 1)
    const protocolHex = binToHex(protocol.data)

    if (protocolHex !== PROTOCOL_ID) {
        throw new Error(`profile: unexpected protocol identifier ${protocolHex}`)
    }

    const namePush = readPush(bytes, protocol.next)
    const name = textDecoder.decode(namePush.data)

    if (!isValidAccountName(name)) {
        throw new Error('profile: invalid account name')
    }

    const fields = {
        avatar: null,
        displayName: null,
        bio: null,
        urls: [],
    }

    let offset = namePush.next

    while (offset < bytes.length) {
        const push = readPush(bytes, offset)
        const data = push.data

        if (data.length === 0) {
            offset = push.next
            continue
        }

        const tag = data[0]
        const payload = data.slice(1)

        if (tag === FIELD_TAGS.avatar) {
            fields.avatar = payload
        } else if (tag === FIELD_TAGS.displayName) {
            fields.displayName = textDecoder.decode(payload)
        } else if (tag === FIELD_TAGS.bio) {
            fields.bio = textDecoder.decode(payload)
        } else if (tag === FIELD_TAGS.urls) {
            const text = textDecoder.decode(payload)
            fields.urls = text.split(' ').filter((url) => url !== '')
        }

        offset = push.next
    }

    return {
        name,
        ...fields,
        scriptHex: binToHex(bytes),
    }
}

/**
 * Whether a locking script is a CashAccounts v2 registration profile.
 *
 * @param {Uint8Array|string} value
 * @returns {boolean}
 */
export function isRegistrationScript(value) {
    const hex = typeof value === 'string'
        ? normalizeHex(value)
        : binToHex(value)

    return hex.startsWith(REGISTRATION_PREFIX)
}
