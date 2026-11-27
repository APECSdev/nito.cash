import { describe, expect, it, vi } from 'vitest'

import { binToHex } from '@bitauth/libauth'

import { submitRole2Action, matchStandingFuelNotes } from '@/lib/pool/role2-actions'
import { encodeRole2Carrier, depositTag } from '@/lib/pool/role2-carrier'
import { nullifier } from '@/lib/pool/notes'
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

    /* ── B2 — the standing-fuel path ─────────────────────────────────── */

    it('spends standing fuel WITHOUT a fresh lock: one broadcast, no locking stage', async () => {
        prove.mockClear()
        broadcast.mockClear()

        const tagHex = binToHex(depositTag(CARRIER))
        const fuel = (vout) => ({ txid: '33'.repeat(32), vout, sats: 15000n, token: { category: POOL.assetCategory, amount: '1000', nft: { capability: 'mutable', commitment: tagHex } } })
        const standingFuel = [fuel(0), fuel(1)]
        const stages = []
        const saveNotes = vi.fn(async () => {})

        const result = await submitRole2Action({ ...base, standingFuel, onStage: (name) => stages.push(name), saveNotes })

        /* No lock stage, no lock broadcast — the action alone. */
        expect(stages).toEqual(['proving', 'tagging', 'building', 'broadcasting', 'done'])
        expect(broadcast).toHaveBeenCalledTimes(1)
        expect(broadcast).toHaveBeenCalledWith(expect.any(String), 'action')
        expect(result.lock).toBe(null)
        expect(result.lockTxid).toBe('33'.repeat(32))
        expect(result.tag).toBe(tagHex)
        expect(result.stages).not.toContain('locking')

        /* The action spends the standing fuel outpoints as in0/in1. */
        expect(result.action.transaction.inputs).toHaveLength(3)
        expect(result.action.transaction.inputs[0].outpointIndex).toBe(0)
        expect(result.action.transaction.inputs[1].outpointIndex).toBe(1)
        expect(binToHex(new Uint8Array(result.action.transaction.inputs[0].outpointTransactionHash))).toBe('33'.repeat(32))
        expect(binToHex(new Uint8Array(result.action.transaction.inputs[1].outpointTransactionHash))).toBe('33'.repeat(32))

        /* saveNotes carries the STANDING lock's txid (the fuel's origin). */
        expect(saveNotes).toHaveBeenCalledWith(expect.objectContaining({ lockTxid: '33'.repeat(32), tag: tagHex }))
        expect(prove).toHaveBeenCalledTimes(1)
    })

    it('refuses standing fuel tagged for a DIFFERENT nullifier pair (hook 4g)', async () => {
        prove.mockClear()
        broadcast.mockClear()

        const fuel = (vout) => ({ txid: '33'.repeat(32), vout, sats: 15000n, token: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: 'ff'.repeat(32) } } })

        await expect(submitRole2Action({ ...base, standingFuel: [fuel(0), fuel(1)] }))
            .rejects.toThrow('bound to a different nullifier pair')

        expect(broadcast).not.toHaveBeenCalled()
    })

    it('refuses a malformed standing-fuel pair', async () => {
        prove.mockClear()
        broadcast.mockClear()

        await expect(submitRole2Action({ ...base, standingFuel: [{ txid: '33'.repeat(32), vout: 0, sats: 15000n }] }))
            .rejects.toThrow('exactly TWO fuel UTXOs')
    })

    it('spends standing fuel for the 3-out shape (201-B carrier)', async () => {
        prove.mockClear()
        broadcast.mockClear()

        const carrier3 = encodeRole2Carrier({ nf0: 1n, nf1: 2n, cm0: 3n, cm1: 4n, cm2: 5n, newRoot: 6n, pv: 0n, sign: 0n }, 3)
        const tagHex = binToHex(depositTag(carrier3))
        const prove3 = vi.fn(async () => ({ carrier: carrier3, unlockings: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])], newRoot: new Uint8Array(32).fill(3), newNull: new Uint8Array(32).fill(4), newBalance: 1000000n, outNotes: ['note-a', 'note-b', 'note-c'] }))
        const fuel = (vout) => ({ txid: '44'.repeat(32), vout, sats: 15000n, token: { category: POOL_3OUT.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: tagHex } } })

        const result = await submitRole2Action({
            ...base, pool: POOL_3OUT, prove: prove3, standingFuel: [fuel(0), fuel(1)],
        })

        expect(result.action.carrierBytes).toBe(201)
        expect(broadcast).toHaveBeenCalledTimes(1)
        expect(result.lockTxid).toBe('44'.repeat(32))
    })
})

describe('lib/pool/role2-actions matchStandingFuelNotes', () => {
    /* The in-note pair tag helper: SHA256(nf0_LE ‖ nf1_LE), both orders. */
    const le32 = (value) => {
        const bytes = new Uint8Array(32)
        let x = BigInt(value)
        for (let i = 0; i < 32; i += 1) { bytes[i] = Number(x & 0xffn); x >>= 8n }
        return bytes
    }

    const pairTag = async (a, b) => binToHex(depositTag(new Uint8Array([
        ...le32(await nullifier(BigInt(a.nk), BigInt(a.rho))),
        ...le32(await nullifier(BigInt(b.nk), BigInt(b.rho))),
    ])))

    /* The PUBLIC bootstrap tag, recomputed from the registry pair (the
       standing-lock finding: 9b15436a… on chipnet lock 3db76294…). */
    it('matches the public bootstrap pair to its deposit tag', async () => {
        const pair = await matchStandingFuelNotes({
            commitment: '9b15436ae6d6d9bcc4297a786f48267829a9e056515fcce00817077bd11fc204',
            ownNotes: [],
            bootstrapNotes: POOL.bootstrapNotes,
        })

        expect(pair).toHaveLength(2)
        expect(pair[0].index).toBe(0)
        expect(pair[1].index).toBe(1)
        expect(pair[0].note.rho).toBe(BigInt(POOL.bootstrapNotes[0].note.rho))
        expect(pair[1].note.rho).toBe(BigInt(POOL.bootstrapNotes[1].note.rho))
    })

    it('matches the wallet\u2019s own pair in BOTH orders (the tag is order-sensitive)', async () => {
        const own = [
            { value: '100', ownerPub: '9', rho: '101', r: '103', nk: '7', leafIndex: 5, spent: false },
            { value: '200', ownerPub: '9', rho: '102', r: '104', nk: '8', leafIndex: 6, spent: false },
        ]

        /* (a, b) */
        const forward = await pairTag({ nk: own[0].nk, rho: own[0].rho }, { nk: own[1].nk, rho: own[1].rho })
        const pair = await matchStandingFuelNotes({ commitment: forward, ownNotes: own })

        expect(pair).toHaveLength(2)
        expect(pair[0].index).toBe(5)
        expect(pair[1].index).toBe(6)

        /* (b, a) — the reversed order produces a DIFFERENT tag and matches
           the reversed pair. */
        const reverse = await pairTag({ nk: own[1].nk, rho: own[1].rho }, { nk: own[0].nk, rho: own[0].rho })
        expect(reverse).not.toBe(forward)

        const pairReversed = await matchStandingFuelNotes({ commitment: reverse, ownNotes: own })

        expect(pairReversed).toHaveLength(2)
        expect(pairReversed[0].index).toBe(6)
        expect(pairReversed[1].index).toBe(5)
    })

    it('returns null when nothing matches, skipping spent notes and duplicate leaves', async () => {
        const own = [
            { value: '100', ownerPub: '9', rho: '101', r: '103', nk: '7', leafIndex: 5, spent: true },
            { value: '200', ownerPub: '9', rho: '102', r: '104', nk: '8', leafIndex: 6, spent: false },
        ]

        /* A tag binding the SPENT note to the unspent one — the spent note is
           never a candidate, so no pair exists. */
        const mixedTag = await pairTag({ nk: '7', rho: '101' }, { nk: '8', rho: '102' })

        /* A tag binding the UNSPENT note to ITSELF — the same leaf can never
           fund both slots (the selectInNotes duplicate rule). */
        const selfTag = await pairTag({ nk: '8', rho: '102' }, { nk: '8', rho: '102' })

        expect(await matchStandingFuelNotes({ commitment: mixedTag, ownNotes: own })).toBe(null)
        expect(await matchStandingFuelNotes({ commitment: selfTag, ownNotes: own })).toBe(null)
        expect(await matchStandingFuelNotes({ commitment: 'ab'.repeat(32), ownNotes: own })).toBe(null)
        expect(await matchStandingFuelNotes({ commitment: '9b15436a', ownNotes: own })).toBe(null)
        expect(await matchStandingFuelNotes({ commitment: '0x' + '9b15436a'.repeat(8), ownNotes: own, bootstrapNotes: POOL.bootstrapNotes })).toBe(null)
    })
})
