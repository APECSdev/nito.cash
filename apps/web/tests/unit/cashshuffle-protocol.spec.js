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
        expect(PHASES).toEqual(['REGISTER', 'POOL', 'ANNOUNCEMENT', 'SHUFFLE', 'SIGNING', 'BROADCAST'])
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
