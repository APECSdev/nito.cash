import { describe, expect, it } from 'vitest'
import { decodeTransaction, hexToBin } from '@bitauth/libauth'

import { buildRole2Action } from '@/lib/pool/role2-action'
import { encodeRole2Carrier } from '@/lib/pool/role2-carrier'
import { getPools } from '@/lib/pool/registry'

const POOL = getPools('chipnet').find((pool) => pool.id === 'chipnet-pusd-role2')
const POOL_3OUT = getPools('chipnet').find((pool) => pool.id === 'chipnet-pusd-role2-3out')
const ROOT = new Uint8Array(32).fill(0x01)
const NULL = new Uint8Array(32).fill(0x02)
const NEW_ROOT = new Uint8Array(32).fill(0x03)
const NEW_NULL = new Uint8Array(32).fill(0x04)
const CARRIER = encodeRole2Carrier({
    nf0: 5n, nf1: 6n, cm0: 7n, cm1: 8n, newRoot: 9n, pv: 1000000n, sign: 0n,
})
const UNLOCKINGS = [new Uint8Array([0x51]), new Uint8Array([0x52]), new Uint8Array([0x53])]
const fuel = (n) => ({ txid: String(n).repeat(64).slice(0, 64), vout: 0, sats: 15000n })
const state = { txid: 'aa'.repeat(32), vout: 0, sats: 10000n }

describe('lib/pool/role2-action', () => {
    it('builds a SHIELD: carrier at out0, new state at out1, no payout', async () => {
        const action = await buildRole2Action({
            pool: POOL, carrier: CARRIER, newRoot: NEW_ROOT, newNull: NEW_NULL, newBalance: 1000000n,
            stateUtxo: state, fuelUtxos: [fuel(1), fuel(2)], unlockings: UNLOCKINGS,
        })
        const decoded = decodeTransaction(hexToBin(action.hex))
        expect(decoded.inputs).toHaveLength(3)
        expect(decoded.outputs).toHaveLength(2)
        expect(decoded.outputs[0].lockingBytecode[0]).toBe(0x6a)
        expect(decoded.outputs[1].token.nft.commitment).toEqual(new Uint8Array([...NEW_ROOT, ...NEW_NULL]))
        expect(decoded.outputs[1].token.amount).toBe(1000000n)
        expect(decoded.outputs[1].valueSatoshis).toBe(10000n)
        expect(action.sign).toBe(0n)
        expect(action.fee).toBe(30000n)
    })

    it('builds an UNSHIELD: payout at out2 with the public value', async () => {
        const carrier = encodeRole2Carrier({ nf0: 5n, nf1: 6n, cm0: 7n, cm1: 8n, newRoot: 9n, pv: 250000n, sign: 1n })
        const action = await buildRole2Action({
            pool: POOL, carrier, newRoot: NEW_ROOT, newNull: NEW_NULL, newBalance: 750000n,
            stateUtxo: state, fuelUtxos: [fuel(3), fuel(4)], unlockings: UNLOCKINGS,
            payoutAddress: 'bchtest:qzzu85xnl99u534d9z40yu7c494hknppx5lu29gl8t',
        })
        const decoded = decodeTransaction(hexToBin(action.hex))
        expect(decoded.outputs).toHaveLength(3)
        expect(decoded.outputs[2].token.amount).toBe(250000n)
        expect(action.sign).toBe(1n)
    })

    it('builds a 3-out UNSHIELD with the 201-B carrier and the payout', async () => {
        const carrier = encodeRole2Carrier({ nf0: 5n, nf1: 6n, cm0: 7n, cm1: 8n, cm2: 9n, newRoot: 10n, pv: 300n, sign: 1n }, 3)
        const action = await buildRole2Action({
            pool: POOL_3OUT, carrier, newRoot: NEW_ROOT, newNull: NEW_NULL, newBalance: 700n,
            stateUtxo: state, fuelUtxos: [fuel(10), fuel(11)], unlockings: UNLOCKINGS,
            payoutAddress: 'bchtest:qzzu85xnl99u534d9z40yu7c494hknppx5lu29gl8t',
        })
        const decoded = decodeTransaction(hexToBin(action.hex))
        expect(action.carrierBytes).toBe(201)
        expect(decoded.outputs[0].lockingBytecode).toHaveLength(3 + 201)
        expect(decoded.outputs).toHaveLength(3)
        expect(decoded.outputs[2].token.amount).toBe(300n)
        expect(action.sign).toBe(1n)
        expect(action.publicValue).toBe(300n)
    })

    it('rejects bad shapes', async () => {
        await expect(buildRole2Action({ pool: POOL, carrier: new Uint8Array(10), newRoot: NEW_ROOT, newNull: NEW_NULL, newBalance: 0n, stateUtxo: state, fuelUtxos: [fuel(5), fuel(6)], unlockings: UNLOCKINGS })).rejects.toThrow('169')
        await expect(buildRole2Action({ pool: POOL, carrier: CARRIER, newRoot: NEW_ROOT, newNull: NEW_NULL, newBalance: 0n, stateUtxo: state, fuelUtxos: [fuel(7)], unlockings: UNLOCKINGS })).rejects.toThrow('TWO fuel')
        await expect(buildRole2Action({ pool: POOL, carrier: CARRIER, newRoot: NEW_ROOT, newNull: NEW_NULL, newBalance: 0n, stateUtxo: state, fuelUtxos: [fuel(8), fuel(9)], unlockings: [new Uint8Array([1])] })).rejects.toThrow('THREE')
    })
})
