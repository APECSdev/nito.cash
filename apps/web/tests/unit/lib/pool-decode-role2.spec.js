import { describe, expect, it } from 'vitest'
import { encodeDataPush } from '@bitauth/libauth'

import { decodeRole2Action } from '@/lib/pool/decode'

const le32 = (v) => {
    const b = new Uint8Array(32)
    let x = BigInt(v)
    for (let i = 0; i < 32; i += 1) { b[i] = Number(x & 0xffn); x >>= 8n }
    return b
}
const push = (bytes) => new Uint8Array(encodeDataPush(bytes))

describe('lib/pool/decode — role-2 (the 3-input shape)', () => {
    it('reads n0/n1 from the 642-B STMT and the args from the 169-B carrier', () => {
        const stmt = new Uint8Array(642)
        stmt.set(le32(0x1234n), 256)
        stmt.set(le32(0x5678n), 288)

        const payload = new Uint8Array(169)
        payload.set(le32(0xaa), 0)
        payload.set(le32(0xbb), 32)
        payload.set(le32(0xcc), 64)
        payload.set(le32(0xdd), 96)
        payload.set(le32(0xee), 128)
        payload[160] = 0x10
        payload[168] = 1

        const stateUnlocking = new Uint8Array([
            ...push(new Uint8Array(96)),
            ...push(stmt),
            ...push(new Uint8Array(65)),
        ])
        const tx = {
            inputs: [
                { unlockingBytecode: new Uint8Array(0), outpointTransactionHash: new Uint8Array(32) },
                { unlockingBytecode: new Uint8Array(0), outpointTransactionHash: new Uint8Array(32) },
                { unlockingBytecode: stateUnlocking, outpointTransactionHash: new Uint8Array(32) },
            ],
            outputs: [{ lockingBytecode: new Uint8Array([0x6a, 0x4c, 0xa9, ...payload]) }],
        }

        const decoded = decodeRole2Action(tx)
        expect(decoded.covenantInputIndex).toBe(2)
        expect(decoded.proven.merkleRoot).toBe(0x1234n)
        expect(decoded.proven.actionHash).toBe(0x5678n)
        expect(decoded.args.nf0).toBe(0xaan)
        expect(decoded.args.nf1).toBe(0xbbn)
        expect(decoded.args.cm0).toBe(0xccn)
        expect(decoded.args.cm1).toBe(0xddn)
        expect(decoded.args.newMerkleRoot).toBe(0xeen)
        expect(decoded.args.publicValueAbs).toBe(0x10n)
        expect(decoded.args.isUnshield).toBe(1n)
    })

    it('reads the 3-out 201-B carrier (cm2 + the shifted pv/sign offsets)', () => {
        const stmt = new Uint8Array(642)
        stmt.set(le32(0x1234n), 256)
        stmt.set(le32(0x5678n), 288)

        const payload = new Uint8Array(201)
        payload.set(le32(0xaa), 0)
        payload.set(le32(0xbb), 32)
        payload.set(le32(0xcc), 64)
        payload.set(le32(0xdd), 96)
        payload.set(le32(0xee), 128)
        payload.set(le32(0xff), 160)
        payload[192] = 0x10
        payload[200] = 1

        const stateUnlocking = new Uint8Array([
            ...push(new Uint8Array(96)),
            ...push(stmt),
            ...push(new Uint8Array(65)),
        ])
        const tx = {
            inputs: [
                { unlockingBytecode: new Uint8Array(0), outpointTransactionHash: new Uint8Array(32) },
                { unlockingBytecode: new Uint8Array(0), outpointTransactionHash: new Uint8Array(32) },
                { unlockingBytecode: stateUnlocking, outpointTransactionHash: new Uint8Array(32) },
            ],
            outputs: [{ lockingBytecode: new Uint8Array([0x6a, 0x4c, 0xc9, ...payload]) }],
        }

        const decoded = decodeRole2Action(tx)
        expect(decoded.carrierBytes).toBe(201)
        expect(decoded.args.cm2).toBe(0xeen)
        expect(decoded.args.newMerkleRoot).toBe(0xffn)
        expect(decoded.args.publicValueAbs).toBe(0x10n)
        expect(decoded.args.isUnshield).toBe(1n)
    })

    it('returns null for a non-3-input transaction and for the 5-input pools', () => {
        expect(decodeRole2Action({ inputs: [], outputs: [] })).toBeNull()
        const five = { inputs: Array.from({ length: 5 }, () => ({ unlockingBytecode: new Uint8Array(0), outpointTransactionHash: new Uint8Array(32) })), outputs: [] }
        expect(decodeRole2Action(five)).toBeNull()
    })
})
