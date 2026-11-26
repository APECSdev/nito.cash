import { describe, expect, it, vi } from 'vitest'

import { submitRole2Action } from '@/lib/pool/role2-actions'
import { encodeRole2Carrier, depositTag } from '@/lib/pool/role2-carrier'
import { getPools } from '@/lib/pool/registry'

const POOL = getPools('chipnet').find((pool) => pool.id === 'chipnet-pusd-role2')
const POOL_3OUT = getPools('chipnet').find((pool) => pool.id === 'chipnet-pusd-role2-3out')
const CARRIER = encodeRole2Carrier({ nf0: 1n, nf1: 2n, cm0: 3n, cm1: 4n, newRoot: 5n, pv: 1000000n, sign: 0n })
const KEY = new Uint8Array(32).fill(0x11)
const ADDRESS = 'bchtest:qzzu85xnl99u534d9z40yu7c494hknppx5lu29gl8t'
const funding = { txid: '11'.repeat(32), vout: 0, sats: 50000n }
const blank = (n) => ({ txid: String(n).repeat(64).slice(0, 64), vout: n, sats: 1000n, token: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: '' } } })
const state = { txid: 'aa'.repeat(32), vout: 0, sats: 10000n }
const prove = vi.fn(async () => ({ carrier: CARRIER, unlockings: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])], newRoot: new Uint8Array(32).fill(3), newNull: new Uint8Array(32).fill(4), newBalance: 1000000n, outNotes: ['note-a', 'note-b'] }))
const broadcast = vi.fn(async (hex, label) => `${label}-txid`)

const base = {
    pool: POOL, state, blanks: [blank(1), blank(2)], funding, changeAddress: ADDRESS, privateKey: KEY, prove, broadcast,
}

describe('lib/pool/role2-actions', () => {
    it('proves, tags, locks, builds and broadcasts atomically', async () => {
        const stages = []
        const saveNotes = vi.fn(async () => {})
        const result = await submitRole2Action({ ...base, onStage: (name) => stages.push(name), saveNotes })
        expect(stages).toEqual(['proving', 'tagging', 'locking', 'building', 'broadcasting', 'done'])
        expect(result.lockTxid).toBe('lock-txid')
        expect(result.actionTxid).toBe('action-txid')
        expect(result.tag).toBe(depositTag(CARRIER).reduce((hex, byte) => hex + byte.toString(16).padStart(2, '0'), ''))
        expect(result.action.transaction.inputs).toHaveLength(3)
        expect(result.action.transaction.outputs).toHaveLength(2)
        expect(saveNotes).toHaveBeenCalledWith(expect.objectContaining({ lockTxid: 'lock-txid', actionTxid: 'action-txid', outNotes: ['note-a', 'note-b'] }))
        expect(prove).toHaveBeenCalledTimes(1)
        expect(broadcast).toHaveBeenCalledTimes(2)
    })

    it('refuses a prover result without a carrier or 3 unlockings', async () => {
        await expect(submitRole2Action({ ...base, prove: async () => ({ carrier: new Uint8Array(10), unlockings: [] }) })).rejects.toThrow('169-B or 201-B carrier')
        await expect(submitRole2Action({ ...base, prove: async () => ({ carrier: CARRIER, unlockings: [new Uint8Array([1])] }) })).rejects.toThrow('3 unlockings')
    })

    it('accepts the 201-B 3-out carrier and saves three out-notes', async () => {
        const carrier3 = encodeRole2Carrier({ nf0: 1n, nf1: 2n, cm0: 3n, cm1: 4n, cm2: 5n, newRoot: 6n, pv: 0n, sign: 0n }, 3)
        const blank3 = (n) => ({ txid: String(n).repeat(64).slice(0, 64), vout: n, sats: 1000n, token: { category: POOL_3OUT.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: '' } } })
        const prove3 = vi.fn(async () => ({ carrier: carrier3, unlockings: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])], newRoot: new Uint8Array(32).fill(3), newNull: new Uint8Array(32).fill(4), newBalance: 1000000n, outNotes: ['note-a', 'note-b', 'note-c'] }))
        const saveNotes = vi.fn(async () => {})

        const result = await submitRole2Action({
            ...base, pool: POOL_3OUT, blanks: [blank3(3), blank3(4)], prove: prove3, saveNotes,
        })

        expect(result.action.carrierBytes).toBe(201)
        expect(result.action.transaction.outputs[0].lockingBytecode).toHaveLength(3 + 201)
        expect(saveNotes).toHaveBeenCalledWith(expect.objectContaining({ outNotes: ['note-a', 'note-b', 'note-c'] }))
    })

    it('requires prove and broadcast', async () => {
        await expect(submitRole2Action({ ...base, prove: null })).rejects.toThrow('prove function')
        await expect(submitRole2Action({ ...base, broadcast: null })).rejects.toThrow('broadcast function')
    })
})
