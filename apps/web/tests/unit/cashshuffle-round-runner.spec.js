import { describe, expect, it, vi } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'

import { CashShuffleRound } from '@/lib/cashshuffle/round-runner'

const key = () => {
    const privateKey = randomBytes(32)
    return { privateKey, publicKey: schnorr.getPublicKey(privateKey) }
}

function fakeTransport() {
    const sent = []
    return {
        sent,
        peers: [],
        broadcast: vi.fn(async (members, type, payload) => { sent.push({ members, type, payload }) }),
        close: vi.fn(),
    }
}

describe('lib/cashshuffle/round-runner', () => {
    it('joins, fills the pool, elects the lowest key and announces', async () => {
        const alice = key()
        const bob = key()
        const carol = key()
        const dave = key()
        const eve = key()
        const transport = fakeTransport()
        const updates = []
        const runner = new CashShuffleRound({ transport, keys: alice, roundId: 'r-1', onUpdate: (s) => updates.push(s) })
        const keys = [alice, bob, carol, dave, eve]
        runner.peers = keys.filter((k) => k !== alice).map((k) => bytesToHex(k.publicKey))
        await runner.join(100000n)
        for (const k of keys.slice(1)) await runner.onMessage({ type: 'REGISTER', from: bytesToHex(k.publicKey), payload: { amount: '100000' } })
        const view = runner.snapshot()
        expect(view.phase).toBe('ANNOUNCEMENT')
        expect(view.players).toHaveLength(5)
        const coordinator = view.coordinator
        expect(coordinator).toBe([...keys.map((k) => bytesToHex(k.publicKey))].sort()[0])
        expect(updates.length).toBeGreaterThan(0)
        if (coordinator === bytesToHex(alice.publicKey)) {
            await runner.announce()
            expect(transport.broadcast).toHaveBeenCalledWith(expect.any(Array), 'ANNOUNCEMENT', {})
        }
    })

    it('routes the phases and reaches BROADCAST', async () => {
        const alice = key()
        const bob = key()
        const transport = fakeTransport()
        const runner = new CashShuffleRound({ transport, keys: alice, roundId: 'r-2', poolSize: 2 })
        runner.peers = [bytesToHex(bob.publicKey)]
        await runner.join(100000n)
        await runner.onMessage({ type: 'REGISTER', from: bytesToHex(bob.publicKey), payload: { amount: '100000' } })
        const coordinator = runner.snapshot().coordinator
        const actor = coordinator === bytesToHex(alice.publicKey) ? alice : bob
        const other = actor === alice ? bob : alice
        const actorRunner = actor === alice ? runner : new CashShuffleRound({ transport, keys: bob, roundId: 'r-2', poolSize: 2 })
        await runner.onMessage({ type: 'ANNOUNCEMENT', from: bytesToHex(actor.publicKey) })
        expect(runner.snapshot().phase).toBe('SHUFFLE')
        await runner.onMessage({ type: 'SHUFFLE', from: bytesToHex(other.publicKey), payload: { onion: 'o' } })
        await runner.onMessage({ type: 'SIGNING', from: bytesToHex(other.publicKey), payload: { signature: 's' } })
        await runner.onMessage({ type: 'BROADCAST', from: bytesToHex(actor.publicKey), payload: { txid: 'tx' } })
        expect(runner.snapshot().phase).toBe('BROADCAST')
        expect(runner.snapshot().txid).toBe('tx')
    })

    it('blames to the abort threshold', async () => {
        const alice = key()
        const transport = fakeTransport()
        const runner = new CashShuffleRound({ transport, keys: alice, roundId: 'r-3', poolSize: 5 })
        const accused = bytesToHex(key().publicKey)
        for (let i = 0; i < 3; i += 1) await runner.onMessage({ type: 'BLAME', from: bytesToHex(key().publicKey), payload: { accused, reason: 'timeout' } })
        expect(runner.snapshot().aborted).toBe(false)
        await runner.onMessage({ type: 'BLAME', from: bytesToHex(key().publicKey), payload: { accused, reason: 'timeout' } })
        expect(runner.snapshot().aborted).toBe(true)
        expect(runner.snapshot().phase).toBe('BLAME')
    })

    it('drops out-of-phase packets without throwing', async () => {
        const alice = key()
        const runner = new CashShuffleRound({ transport: fakeTransport(), keys: alice, roundId: 'r-4', poolSize: 2 })
        await runner.onMessage({ type: 'SHUFFLE', from: bytesToHex(key().publicKey), payload: { onion: 'x' } })
        expect(runner.lastError).toContain('expected SHUFFLE')
        expect(runner.snapshot().phase).toBe('REGISTER')
    })

    it('guards the coordinator-only steps', async () => {
        const alice = key()
        const runner = new CashShuffleRound({ transport: fakeTransport(), keys: alice, roundId: 'r-5', poolSize: 2 })
        await expect(runner.announce()).rejects.toThrow('only the coordinator')
        await expect(runner.publish('tx')).rejects.toThrow('only the coordinator')
    })

    it('requires a transport, keys and a roundId', () => {
        expect(() => new CashShuffleRound({ keys: key(), roundId: 'r' })).toThrow('transport')
        expect(() => new CashShuffleRound({ transport: fakeTransport(), roundId: 'r' })).toThrow('keys')
        expect(() => new CashShuffleRound({ transport: fakeTransport(), keys: key() })).toThrow('roundId')
    })
})
