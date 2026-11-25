import { describe, expect, it } from 'vitest'

import {
    BLAME_THRESHOLD,
    DEFAULT_POOL_SIZE,
    PHASES,
    advance,
    announcement,
    blame,
    broadcast,
    coordinatorOf,
    createRound,
    nextPhase,
    register,
    signing,
    snapshot,
    shuffle,
    verify,
} from '@/lib/cashshuffle/protocol'

const keys = ['cc', 'aa', 'ee', 'bb', 'dd']

function fullRound(poolSize = 5) {
    const round = createRound({ roundId: 'r1', relay: 'wss://relay.example', poolSize })
    for (let i = 0; i < poolSize; i += 1) register(round, { key: keys[i], amount: 100000n })
    return round
}

describe('lib/cashshuffle/protocol', () => {
    it('picks the lexicographically lowest key as the coordinator', () => {
        expect(coordinatorOf(keys)).toBe('aa')
        expect(coordinatorOf([])).toBeNull()
    })

    it('walks the phases in order', () => {
        expect(PHASES).toEqual(['REGISTER', 'POOL', 'ANNOUNCEMENT', 'SHUFFLE', 'VERIFY', 'SIGNING', 'BROADCAST'])
        expect(nextPhase('REGISTER')).toBe('POOL')
        expect(nextPhase('BROADCAST')).toBeNull()
        expect(() => nextPhase('NOPE')).toThrow('unknown phase')
    })

    it('fills the pool and elects the coordinator', () => {
        const round = fullRound()
        expect(round.phase).toBe('ANNOUNCEMENT')
        expect(round.coordinator).toBe('aa')
        expect(round.players).toHaveLength(5)
        expect(DEFAULT_POOL_SIZE).toBe(5)
    })

    it('only the coordinator can announce and broadcast', () => {
        const round = fullRound()
        expect(() => announcement(round, { from: 'bb' })).toThrow('only the coordinator')
        announcement(round, { from: 'aa' })
        expect(round.phase).toBe('SHUFFLE')
        shuffle(round, { from: 'bb', onion: 'onion-1' })
        advance(round)
        advance(round)
        signing(round, { from: 'bb', signature: 'sig-1' })
        advance(round)
        expect(() => broadcast(round, { from: 'bb', txid: 'tx' })).toThrow('only the coordinator')
        broadcast(round, { from: 'aa', txid: 'txid-1' })
        expect(round.txid).toBe('txid-1')
        expect(round.phase).toBe('BROADCAST')
    })

    it('rejects out-of-phase packets', () => {
        const round = fullRound()
        expect(() => shuffle(round, { from: 'bb', onion: 'x' })).toThrow('expected SHUFFLE')
        announcement(round, { from: 'aa' })
        expect(() => signing(round, { from: 'bb', signature: 's' })).toThrow('expected SIGNING')
    })

    it('aborts on N-1 matching blames (before broadcast)', () => {
        const round = fullRound()
        const accusers = ['bb', 'cc', 'dd', 'ee']
        for (const from of accusers.slice(0, 3)) blame(round, { from, accused: 'aa', reason: 'timeout' })
        expect(round.aborted).toBe(false)
        blame(round, { from: 'ee', accused: 'aa', reason: 'timeout' })
        expect(round.aborted).toBe(true)
        expect(round.phase).toBe('BLAME')
        expect(round.txid).toBeNull()
        expect(BLAME_THRESHOLD(5)).toBe(4)
    })

    it('ignores duplicate blames and self-blame', () => {
        const round = fullRound()
        blame(round, { from: 'bb', accused: 'aa' })
        blame(round, { from: 'bb', accused: 'aa' })
        expect(round.blames.aa.size).toBe(1)
        expect(() => blame(round, { from: 'aa', accused: 'aa' })).toThrow('cannot blame itself')
    })

    it('snapshots the round for the UI', () => {
        const round = fullRound()
        const view = snapshot(round)
        expect(view.phase).toBe('ANNOUNCEMENT')
        expect(view.coordinator).toBe('aa')
        expect(view.players).toHaveLength(5)
        expect(view.aborted).toBe(false)
        expect(view.txid).toBeNull()
        expect(view.log.length).toBeGreaterThan(0)
    })
})

describe('lib/cashshuffle/protocol — VERIFY', () => {
    it('accepts a conserving transaction under the fee bound', () => {
        const round = fullRound()
        announcement(round, { from: 'aa' })
        advance(round)
        const tx = { inputs: [{ value: 200000 }], outputs: [{ value: 199000 }], estBytes: 300 }
        expect(() => verify(round, { from: 'bb', transaction: tx })).not.toThrow()
        expect(round.log.some((entry) => entry.type === 'verify')).toBe(true)
    })

    it('rejects sumOut > sumIn and a fee above 5 sat/B', () => {
        const round = fullRound()
        announcement(round, { from: 'aa' })
        advance(round)
        expect(() => verify(round, { from: 'bb', transaction: { inputs: [{ value: 100 }], outputs: [{ value: 200 }], estBytes: 300 } })).toThrow('sumOut')
        expect(() => verify(round, { from: 'bb', transaction: { inputs: [{ value: 200000 }], outputs: [{ value: 100000 }], estBytes: 300 } })).toThrow('5 sat/B')
    })

    it('rejects a wrong output count', () => {
        const round = fullRound()
        announcement(round, { from: 'aa' })
        advance(round)
        expect(() => verify(round, { from: 'bb', transaction: { inputs: [{ value: 200000 }], outputs: [{ value: 199000 }], estBytes: 300 }, expectedOutputs: 5 })).toThrow('expected 5 outputs')
    })
})
