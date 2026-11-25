import { describe, expect, it, vi } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'

import { CASHSHUFFLE_KIND, CashShuffleTransport } from '@/lib/cashshuffle/transport'
import { unwrapGift, wrapRumor } from '@/lib/nostr/nip59'

class MockWebSocket {
    static instances = []
    constructor(url) {
        this.url = url
        this.sent = []
        this.onopen = null
        this.onmessage = null
        this.onclose = null
        this.onerror = null
        MockWebSocket.instances.push(this)
    }
    send(data) { this.sent.push(JSON.parse(data)) }
    close() { this.onclose?.() }
    open() { this.onopen?.() }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }) }
}

const key = () => {
    const priv = randomBytes(32)
    return { privateKey: priv, publicKey: schnorr.getPublicKey(priv) }
}

describe('lib/cashshuffle/transport', () => {
    it('publishes a gift-wrapped packet and the recipient unwraps it', async () => {
        const alice = key()
        const bob = key()
        const received = []
        const transport = new CashShuffleTransport({
            relays: ['wss://relay.example'],
            keys: alice,
            roundId: 'r-1',
            onMessage: (packet) => received.push(packet),
            WebSocketImpl: MockWebSocket,
        })
        transport.connect()
        const socket = MockWebSocket.instances.at(-1)
        socket.open()
        const publish = transport.send(bytesToHex(bob.publicKey), 'REGISTER', { amount: '100000' })
        const gift = socket.sent.at(-1)[1]
        socket.receive(['OK', gift.id, true, ''])
        await publish
        expect(gift.kind).toBe(1059)
        expect(gift.tags[0][0]).toBe('p')
        expect(gift.tags[0][1]).toBe(bytesToHex(bob.publicKey))
        const rumor = unwrapGift({ gift, recipientPrivateKey: bob.privateKey })
        const packet = JSON.parse(rumor.content)
        expect(packet).toEqual({ round: 'r-1', type: 'REGISTER', from: bytesToHex(alice.publicKey), to: bytesToHex(bob.publicKey), payload: { amount: '100000' } })
    })

    it('fans a broadcast out to every member', async () => {
        const alice = key()
        const members = [bytesToHex(key().publicKey), bytesToHex(key().publicKey)]
        const transport = new CashShuffleTransport({
            relays: ['wss://relay.example'],
            keys: alice,
            roundId: 'r-2',
            WebSocketImpl: MockWebSocket,
        })
        transport.connect()
        const socket = MockWebSocket.instances.at(-1)
        socket.open()
        const promise = transport.broadcast(members, 'ANNOUNCEMENT', {})
        for (const gift of socket.sent.filter((m) => m[0] === 'EVENT')) socket.receive(['OK', gift[1].id, true, ''])
        await promise
        expect(socket.sent.filter((m) => m[0] === 'EVENT')).toHaveLength(2)
    })

    it('routes an inbound gift to onMessage and drops other rounds', () => {
        const alice = key()
        const bob = key()
        const received = []
        const transport = new CashShuffleTransport({
            relays: ['wss://relay.example'],
            keys: alice,
            roundId: 'r-3',
            onMessage: (packet) => received.push(packet),
            WebSocketImpl: MockWebSocket,
        })
        transport.connect()
        const socket = MockWebSocket.instances.at(-1)
        socket.open()
        const rumor = { kind: CASHSHUFFLE_KIND, content: JSON.stringify({ round: 'r-3', type: 'SHUFFLE', from: bytesToHex(bob.publicKey), to: null, payload: { onion: 'x' } }), tags: [], pubkey: bytesToHex(bob.publicKey), created_at: 1700000000, id: 'x', sig: 'x' }
        // wrap it as Bob → Alice so the transport can decrypt it
        const throwaway = key()
        const gift = wrapRumor({ rumor, senderPrivateKey: bob.privateKey, senderPublicKey: bob.publicKey, recipientPublicKey: alice.publicKey, throwawayPrivateKey: throwaway.privateKey, throwawayPublicKey: throwaway.publicKey })
        socket.receive(['EVENT', 'nito-1', gift])
        expect(received).toHaveLength(1)
        expect(received[0].type).toBe('SHUFFLE')
        const other = wrapRumor({ rumor: { ...rumor, content: JSON.stringify({ round: 'other' }) }, senderPrivateKey: bob.privateKey, senderPublicKey: bob.publicKey, recipientPublicKey: alice.publicKey, throwawayPrivateKey: throwaway.privateKey, throwawayPublicKey: throwaway.publicKey })
        socket.receive(['EVENT', 'nito-1', other])
        expect(received).toHaveLength(1)
    })

    it('requires relays, keys and a roundId', () => {
        expect(() => new CashShuffleTransport({ keys: key(), roundId: 'r' })).toThrow('relay')
        expect(() => new CashShuffleTransport({ relays: ['wss://x'], roundId: 'r' })).toThrow('keys')
        expect(() => new CashShuffleTransport({ relays: ['wss://x'], keys: key() })).toThrow('roundId')
    })
})
