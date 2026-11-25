// src/lib/pool/role2-carrier.js
//
// The role-2 tagged pool's 169-byte carrier (handoff §3/§4).
//
//   out0  OP_RETURN <169-B carrier>
//         nf0(32) ‖ nf1(32) ‖ cm0(32) ‖ cm1(32) ‖ newRoot(32) ‖ pv(8 LE) ‖ sign(1)
//
// The DEPOSIT TAG is SHA256(carrier[0..64]) = SHA256(nf0_LE ‖ nf1_LE) — the
// same raw-LE fold as the nullifier hash. Both fuel UTXOs carry it as a
// mutable-NFT commitment, so standing fuel can only be consumed by the action
// whose witness spends exactly those nullifiers (hook checks 4c/4g).
//
// The actionHash preimage is the 8-field BIG-ENDIAN SHA256 (the same relation
// as the v4 pool): nf0 ‖ nf1 ‖ cm0 ‖ cm1 ‖ pv ‖ sign ‖ categoryDisplay ‖ newRoot,
// with the top 3 bits of the digest cleared (n1). The carrier stores the same
// values LITTLE-ENDIAN, which is why the tag is a raw fold of its first 64 B.

import { sha256 } from '@bitauth/libauth'

export const ROLE2_CARRIER_BYTES = 169
export const ROLE2_CARRIER_PREFIX = [0x6a, 0x4c, ROLE2_CARRIER_BYTES] // OP_RETURN OP_PUSHDATA1 169
export const ROLE2_CARRIER_FIELDS = ['nf0', 'nf1', 'cm0', 'cm1', 'newRoot', 'pv', 'sign']

const FIELD_LAYOUT = [
    ['nf0', 0, 32],
    ['nf1', 32, 32],
    ['cm0', 64, 32],
    ['cm1', 96, 32],
    ['newRoot', 128, 32],
    ['pv', 160, 8],
    ['sign', 168, 1],
]

function toBigInt(value) {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number') return BigInt(value)
    if (typeof value === 'string' && value.length) return BigInt(value)
    return 0n
}

function putLE(bytes, offset, length, value) {
    let x = toBigInt(value)
    for (let i = 0; i < length; i++) {
        bytes[offset + i] = Number(x & 0xffn)
        x >>= 8n
    }
}

function readLE(bytes, offset, length) {
    let x = 0n
    for (let i = length - 1; i >= 0; i--) x = (x << 8n) | BigInt(bytes[offset + i])
    return x
}

/* Encode the 169-byte carrier payload (without the OP_RETURN prefix). */
export function encodeRole2Carrier({ nf0, nf1, cm0, cm1, newRoot, pv, sign }) {
    const bytes = new Uint8Array(ROLE2_CARRIER_BYTES)
    for (const [name, offset, length] of FIELD_LAYOUT) {
        putLE(bytes, offset, length, { nf0, nf1, cm0, cm1, newRoot, pv, sign }[name])
    }
    return bytes
}

/* Decode a 169-byte carrier payload back into its limbs (bigint). */
export function decodeRole2Carrier(payload) {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
    if (bytes.length !== ROLE2_CARRIER_BYTES) {
        throw new Error(`role2-carrier: expected ${ROLE2_CARRIER_BYTES} bytes, got ${bytes.length}`)
    }
    const out = {}
    for (const [name, offset, length] of FIELD_LAYOUT) out[name] = readLE(bytes, offset, length)
    return out
}

/* The full OP_RETURN output locking: 6a 4c a9 <169 bytes>. */
export function role2CarrierOutput(payload) {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
    if (bytes.length !== ROLE2_CARRIER_BYTES) {
        throw new Error(`role2-carrier: carrier must be ${ROLE2_CARRIER_BYTES} bytes`)
    }
    const out = new Uint8Array(ROLE2_CARRIER_PREFIX.length + bytes.length)
    out.set(ROLE2_CARRIER_PREFIX, 0)
    out.set(bytes, ROLE2_CARRIER_PREFIX.length)
    return out
}

/* Extract the carrier payload from an OP_RETURN locking (or null). */
export function readRole2CarrierOutput(lockingBytecode) {
    const bytes = lockingBytecode instanceof Uint8Array ? lockingBytecode : new Uint8Array(lockingBytecode)
    if (bytes.length !== ROLE2_CARRIER_PREFIX.length + ROLE2_CARRIER_BYTES) return null
    if (bytes[0] !== 0x6a || bytes[1] !== 0x4c || bytes[2] !== ROLE2_CARRIER_BYTES) return null
    return bytes.slice(ROLE2_CARRIER_PREFIX.length)
}

/* The deposit tag: SHA256(carrier[0..64]) = SHA256(nf0_LE ‖ nf1_LE). */
export function depositTag(payload) {
    const bytes = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
    if (bytes.length < 64) throw new Error('role2-carrier: carrier too short for a deposit tag')
    return sha256.hash(bytes.slice(0, 64))
}

/*
 * The actionHash (n1): SHA256 of the 8-field BIG-ENDIAN preimage, top 3 bits
 * cleared. `categoryDisplay` is the natural (display/BE) category hex.
 */
export function role2ActionHash({ nf0, nf1, cm0, cm1, pv, sign, categoryDisplay, newRoot }) {
    const be32 = (value) => {
        const out = new Uint8Array(32)
        let x = toBigInt(value)
        for (let i = 31; i >= 0 && x > 0n; i--) {
            out[i] = Number(x & 0xffn)
            x >>= 8n
        }
        return out
    }
    const preimage = new Uint8Array(32 * 8)
    const fields = [nf0, nf1, cm0, cm1, pv, sign, newRoot]
    fields.forEach((value, index) => preimage.set(be32(value), index * 32))
    /* field 6 is the category (display/BE) in the 7th slot; newRoot is 8th */
    preimage.set(be32(BigInt('0x' + String(categoryDisplay).replace(/^0x/, ''))), 32 * 6)
    preimage.set(be32(newRoot), 32 * 7)
    const digest = sha256.hash(preimage)
    const n1 = new Uint8Array(digest)
    n1[0] &= 0x1f
    return readBE(n1)
}

function readBE(bytes) {
    let x = 0n
    for (let i = 0; i < bytes.length; i++) x = (x << 8n) | BigInt(bytes[i])
    return x
}
