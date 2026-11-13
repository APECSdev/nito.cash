/* Unit tests for the external (WizardConnect) wallet helpers. */
import { describe, expect, it } from 'vitest'

import {
    buildPaymentTransaction,
    p2pkhLockingBytecode,
    parseBchToSats,
    selectCoins,
} from '@/lib/bch/external-wallet'

describe('external-wallet helpers', () => {
    describe('p2pkhLockingBytecode', () => {
        it('emits OP_DUP OP_HASH160 <20B> OP_EQUALVERIFY OP_CHECKSIG', () => {
            const h = new Uint8Array(20).fill(0xab)
            const lock = p2pkhLockingBytecode(h)

            expect(lock.length).toBe(25)
            expect(Array.from(lock.slice(0, 3))).toEqual([0x76, 0xa9, 0x14])
            expect(Array.from(lock.slice(3, 23))).toEqual(Array.from(h))
            expect(Array.from(lock.slice(23))).toEqual([0x88, 0xac])
        })
    })

    describe('parseBchToSats', () => {
        it('parses without float rounding', () => {
            expect(parseBchToSats('0.00005')).toBe(5000n)
            expect(parseBchToSats('1')).toBe(100000000n)
            expect(parseBchToSats('0.00000001')).toBe(1n)
            expect(parseBchToSats('2.5')).toBe(250000000n)
            expect(parseBchToSats('.5')).toBe(50000000n)
        })

        it('rejects invalid input', () => {
            expect(() => parseBchToSats('1.234567890')).toThrow()
            expect(() => parseBchToSats('abc')).toThrow()
            expect(() => parseBchToSats('-1')).toThrow()
        })
    })

    describe('selectCoins', () => {
        const utxo = (value, withToken) => ({ value: BigInt(value), ...(withToken ? { token: { category: new Uint8Array(32) } } : {}) })

        it('selects the single largest UTXO when it covers the target', () => {
            const { chosen, sum } = selectCoins([utxo(1000), utxo(5000), utxo(2000)], 3000n)
            expect(chosen.map((u) => Number(u.value))).toEqual([5000])
            expect(sum).toBe(5000n)
        })

        it('keeps adding until covered when the largest alone is not enough', () => {
            const { chosen, sum } = selectCoins([utxo(1000), utxo(2500), utxo(400)], 3000n)
            expect(chosen.map((u) => Number(u.value))).toEqual([2500, 1000])
            expect(sum).toBe(3500n)
        })

        it('skips token-bearing UTXOs', () => {
            const { chosen } = selectCoins([utxo(9000, true), utxo(1000)], 500n)
            expect(chosen.length).toBe(1)
            expect(Number(chosen[0].value)).toBe(1000)
        })

        it('returns everything when the wallet cannot cover the target', () => {
            const { chosen, sum } = selectCoins([utxo(100), utxo(200)], 5000n)
            expect(chosen.length).toBe(2)
            expect(sum).toBe(300n)
        })
    })

    describe('buildPaymentTransaction', () => {
        const lock = new Uint8Array(25)
        const source = (value) => ({
            outpointTransactionHash: new Uint8Array(32),
            outpointIndex: 0,
            unlockingBytecode: new Uint8Array(0),
            valueSatoshis: BigInt(value),
            lockingBytecode: lock,
        })

        it('pays the recipient and returns change', () => {
            const { transaction, change } = buildPaymentTransaction({
                sourceOutputs: [source(100_000)],
                recipientLockingBytecode: lock,
                changeLockingBytecode: lock,
                amountSats: 30_000n,
                feeSats: 500n,
            })

            expect(transaction.version).toBe(2)
            expect(transaction.inputs.length).toBe(1)
            expect(transaction.outputs[0].valueSatoshis).toBe(30_000n)
            expect(change).toBe(69_500n)
            expect(transaction.outputs[1].valueSatoshis).toBe(69_500n)
        })

        it('omits the change output when change is zero', () => {
            const { transaction, change } = buildPaymentTransaction({
                sourceOutputs: [source(30_500)],
                recipientLockingBytecode: lock,
                changeLockingBytecode: lock,
                amountSats: 30_000n,
                feeSats: 500n,
            })

            expect(change).toBe(0n)
            expect(transaction.outputs.length).toBe(1)
        })

        it('throws when the wallet cannot cover amount + fee', () => {
            expect(() => buildPaymentTransaction({
                sourceOutputs: [source(1_000)],
                recipientLockingBytecode: lock,
                changeLockingBytecode: lock,
                amountSats: 30_000n,
                feeSats: 500n,
            })).toThrow(/Insufficient BCH/)
        })
    })
})
