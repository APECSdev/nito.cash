import { describe, expect, it } from 'vitest'

import {
    ROLE2_CARRIER_BYTES,
    ROLE2_CARRIER_BYTES_3OUT,
    decodeRole2Carrier,
    depositTag,
    encodeRole2Carrier,
    readRole2CarrierOutput,
    role2ActionHash,
    role2CarrierOutput,
} from '@/lib/pool/role2-carrier'

const CATEGORY = '480e30ff1d3f5f0b6fe9dd2dbe363b1776f61566f29a395628d0b50abd01b9d0'
const LIMBS = {
    nf0: 0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20n,
    nf1: 0x2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40n,
    cm0: 0x4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60n,
    cm1: 0x6162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f80n,
    newRoot: 0x8182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0n,
    pv: 1000000n,
    sign: 0n,
}

describe('lib/pool/role2-carrier', () => {
    it('encodes exactly 169 bytes and round-trips the limbs', () => {
        const payload = encodeRole2Carrier(LIMBS)
        expect(payload).toHaveLength(ROLE2_CARRIER_BYTES)
        const decoded = decodeRole2Carrier(payload)
        for (const key of ['nf0', 'nf1', 'cm0', 'cm1', 'newRoot', 'pv', 'sign']) {
            expect(decoded[key]).toBe(LIMBS[key])
        }
    })

    it('stores the limbs little-endian (carrier[0] is the low byte of nf0)', () => {
        const payload = encodeRole2Carrier(LIMBS)
        expect(payload[0]).toBe(0x20)
        expect(payload[31]).toBe(0x01)
        expect(payload[160]).toBe(0x40)
        expect(payload[167]).toBe(0x00)
        expect(payload[168]).toBe(0x00)
    })

    it('builds the OP_RETURN output and reads it back', () => {
        const payload = encodeRole2Carrier(LIMBS)
        const locking = role2CarrierOutput(payload)
        expect(locking[0]).toBe(0x6a)
        expect(locking[1]).toBe(0x4c)
        expect(locking[2]).toBe(169)
        expect(locking).toHaveLength(172)
        expect(readRole2CarrierOutput(locking)).toEqual(payload)
        expect(readRole2CarrierOutput(new Uint8Array([0x6a]))).toBeNull()
    })

    it('derives the deposit tag from the first 64 bytes', () => {
        const payload = encodeRole2Carrier(LIMBS)
        const tag = depositTag(payload)
        expect(tag).toHaveLength(32)
        /* tag changes when either nullifier changes */
        const other = encodeRole2Carrier({ ...LIMBS, nf1: LIMBS.nf1 + 1n })
        expect(depositTag(other)).not.toEqual(tag)
    })

    it('rejects a wrong-size carrier', () => {
        expect(() => decodeRole2Carrier(new Uint8Array(168))).toThrow('169')
        expect(() => role2CarrierOutput(new Uint8Array(10))).toThrow('169')
        expect(() => depositTag(new Uint8Array(10))).toThrow('too short')
    })

    it('computes the big-endian actionHash with the top 3 bits cleared', () => {
        const n1 = role2ActionHash({ ...LIMBS, categoryDisplay: CATEGORY })
        expect(n1).toBeGreaterThan(0n)
        /* top 3 bits of the 32-byte BE digest are cleared => n1 < 2^253 */
        expect(n1 < 2n ** 253n).toBe(true)
        const other = role2ActionHash({ ...LIMBS, pv: 1n, categoryDisplay: CATEGORY })
        expect(other).not.toBe(n1)
    })

    it('encodes the 3-out 201-byte carrier with cm2 and the 9-field actionHash', () => {
        const limbs3 = { ...LIMBS, cm2: 0xa1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebf0n }
        const payload = encodeRole2Carrier(limbs3, 3)
        expect(payload).toHaveLength(ROLE2_CARRIER_BYTES_3OUT)
        expect(payload[128]).toBe(0xf0)
        expect(payload[192]).toBe(0x40)
        expect(payload[200]).toBe(0x00)

        const decoded = decodeRole2Carrier(payload, 3)
        for (const key of ['nf0', 'nf1', 'cm0', 'cm1', 'cm2', 'newRoot', 'pv', 'sign']) {
            expect(decoded[key]).toBe(limbs3[key])
        }

        const locking = role2CarrierOutput(payload)
        expect(locking[2]).toBe(201)
        expect(readRole2CarrierOutput(locking)).toEqual(payload)

        const n1 = role2ActionHash({ ...limbs3, categoryDisplay: CATEGORY }, 3)
        expect(n1).toBeGreaterThan(0n)
        expect(n1 < 2n ** 253n).toBe(true)
        /* cm2 is bound: changing it changes the 9-field actionHash. */
        const other = role2ActionHash({ ...limbs3, cm2: limbs3.cm2 + 1n, categoryDisplay: CATEGORY }, 3)
        expect(other).not.toBe(n1)
        /* and the 3-out hash differs from the 2-out hash of the same limbs. */
        expect(n1).not.toBe(role2ActionHash({ ...LIMBS, categoryDisplay: CATEGORY }, 2))
    })
})
