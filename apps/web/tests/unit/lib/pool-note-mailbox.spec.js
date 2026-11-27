// apps/web/tests/unit/lib/pool-note-mailbox.spec.js
//
// B3 — the off-chain note delivery: the Nostr note mailbox
// (src/lib/pool/note-mailbox.js; the design docs/B3-NOTE-DELIVERY-DESIGN-
// 2026-11-27.md §3.1). The wire format (kinds/tags/hex content), the
// fresh-key events (verified signatures), the fetch path (REQ → events →
// EOSE; dedupe + validation), the publish path (OK per relay; one accept =
// delivered), and the receipts.
//
// The relay layer is tested through the MockWebSocket pattern of
// tests/unit/nostr-relay.spec.js (no network, no jsdom WebSocket needed).

import { describe, expect, it, vi } from 'vitest'
import { hexToBytes } from '@noble/hashes/utils.js'

import { verifyEvent } from '@/lib/nostr/event.js'

import {
    RECEIPT_KIND_DEFAULT,
    NOTE_KIND_DEFAULT,
    buildNoteEvent,
    buildReceiptEvent,
    dpTag,
    fetchNotePackets,
    fetchReceipts,
    freshKeys,
    packetTag,
    parseNoteEvent,
    publishEvent,
} from '@/lib/pool/note-mailbox'

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

const MAILBOX = { relays: ['wss://one.example', 'wss://two.example'], noteKind: 4321, receiptKind: 4322 }

/* A deterministic 164-B stand-in for an NP01 packet (the real encryptNote
   round-trip lives in pool-carrier.spec + the scan/store specs). */
const PACKET = new Uint8Array(164).fill(0xab)
PACKET[0] = 0x6e
const PACKET_HEX = [...PACKET].map((b) => b.toString(16).padStart(2, '0')).join('')

/* A valid 32-B delivery point (any 32 bytes — the mailbox never checks the
   point itself, carrier.js does at encrypt time). */
const DP = 'aa'.repeat(32)

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

describe('lib/pool/note-mailbox', () => {
    it('dpTag hashes the delivery point bytes (accepts hex + raw)', () => {
        const fromHex = dpTag(DP)
        const fromBytes = dpTag(hexToBytes(DP))

        expect(fromHex).toBe(fromBytes)
        expect(fromHex).toMatch(/^[0-9a-f]{64}$/)
        /* NOT the identity — a real hash. */
        expect(fromHex).not.toBe(DP)

        expect(() => dpTag('ff')).toThrow('32 bytes')
    })

    it('freshKeys makes a NEW throwaway keypair per call', () => {
        const a = freshKeys()
        const b = freshKeys()

        expect(a.privateKey).not.toEqual(b.privateKey)
        expect(a.publicKey.length).toBe(32)
    })

    it('buildNoteEvent signs a valid kind/tags/content event for the recipient', () => {
        const { event, keys, dpTag: tag } = buildNoteEvent({
            mailbox: MAILBOX,
            recipientDeliveryPoint: DP,
            packet: PACKET,
            actionTxid: 'ab'.repeat(32),
        })

        expect(event.kind).toBe(NOTE_KIND_DEFAULT)
        expect(event.content).toBe(PACKET_HEX)
        expect(tag).toBe(dpTag(DP))
        expect(event.tags).toEqual([
            ['d', tag],
            ['action', 'ab'.repeat(32)],
        ])

        /* A REAL, verified BIP-340 signature over the canonical id. */
        expect(verifyEvent(event)).toBe(true)

        /* The keys are returned (the outbox persists them for id-stable
           re-publishes). */
        expect(keys.publicKey.length).toBe(32)

        /* Deterministic keys + timestamp reproduce the SAME event id (the
           relay-dedupe guarantee). */
        const again = buildNoteEvent({ mailbox: MAILBOX, recipientDeliveryPoint: DP, packet: PACKET, actionTxid: 'ab'.repeat(32), keys, createdAt: event.created_at })
        expect(again.event.id).toBe(event.id)
    })

    it('buildNoteEvent validates its inputs (no relays / wrong packet size)', () => {
        expect(() => buildNoteEvent({ mailbox: { relays: [] }, recipientDeliveryPoint: DP, packet: PACKET })).toThrow('no relays')
        expect(() => buildNoteEvent({ mailbox: MAILBOX, recipientDeliveryPoint: DP, packet: new Uint8Array(10) })).toThrow('164 bytes')
    })

    it('parseNoteEvent accepts ONLY the right kind + tag + size (never throws)', () => {
        const tag = dpTag(DP)
        const good = { id: 'e1', kind: NOTE_KIND_DEFAULT, content: PACKET_HEX, tags: [['d', tag], ['action', 'cd'.repeat(32)]] }

        expect(parseNoteEvent({ event: good, tag, noteKind: NOTE_KIND_DEFAULT })).toEqual({
            packet: PACKET,
            actionTxid: 'cd'.repeat(32),
            eventId: 'e1',
        })

        expect(parseNoteEvent({ event: { ...good, kind: 1 }, tag, noteKind: NOTE_KIND_DEFAULT })).toBeNull()
        expect(parseNoteEvent({ event: { ...good, tags: [['d', '00'.repeat(32)]] }, tag, noteKind: NOTE_KIND_DEFAULT })).toBeNull()
        expect(parseNoteEvent({ event: { ...good, content: 'zz' }, tag, noteKind: NOTE_KIND_DEFAULT })).toBeNull()
        expect(parseNoteEvent({ event: { ...good, content: 'ab'.repeat(10) }, tag, noteKind: NOTE_KIND_DEFAULT })).toBeNull()
        expect(parseNoteEvent({ event: null, tag, noteKind: NOTE_KIND_DEFAULT })).toBeNull()
    })

    it('publishEvent resolves delivered=true when ANY relay accepts (one down is fine)', async () => {
        MockWebSocket.instances = []

        const { event } = buildNoteEvent({ mailbox: MAILBOX, recipientDeliveryPoint: DP, packet: PACKET, actionTxid: 'ab'.repeat(32) })

        const promise = publishEvent({ mailbox: MAILBOX, event, WebSocketImpl: MockWebSocket })

        await wait(10)

        for (const socket of MockWebSocket.instances) {
            socket.open()
        }

        await wait(10)

        /* Relay ONE accepts; relay TWO stays silent (rejects on timeout). */
        MockWebSocket.instances[0].receive(['OK', event.id, true, ''])

        const { delivered, results } = await promise

        expect(delivered).toBe(true)
        expect(results[0].ok).toBe(true)
        expect(results[1].ok).toBe(false)
    })

    it('fetchNotePackets collects until EOSE, dedupes by id, skips invalid events', async () => {
        MockWebSocket.instances = []

        const tag = dpTag(DP)
        const { event } = buildNoteEvent({ mailbox: MAILBOX, recipientDeliveryPoint: DP, packet: PACKET, actionTxid: 'ab'.repeat(32) })

        const promise = fetchNotePackets({ mailbox: MAILBOX, ownDeliveryPoint: DP, WebSocketImpl: MockWebSocket, timeout: 2000 })

        await wait(10)

        for (const socket of MockWebSocket.instances) {
            socket.open()
        }

        await wait(10)

        /* Both relays return the SAME event (dedupe) + one invalid one. */
        const subIdOne = MockWebSocket.instances[0].sent[0][1]
        MockWebSocket.instances[0].receive(['EVENT', subIdOne, event])
        MockWebSocket.instances[0].receive(['EVENT', subIdOne, { id: 'bad', kind: NOTE_KIND_DEFAULT, content: 'zz', tags: [['d', tag]] }])
        MockWebSocket.instances[0].receive(['EOSE', subIdOne])

        const subIdTwo = MockWebSocket.instances[1].sent[0][1]
        MockWebSocket.instances[1].receive(['EVENT', subIdTwo, event])
        /* The second relay goes SILENT — the timeout guard ends the fetch. */
        const packets = await promise

        expect(packets).toHaveLength(1)
        expect(packets[0].eventId).toBe(event.id)
        expect(packets[0].actionTxid).toBe('ab'.repeat(32))
        expect([...packets[0].packet]).toEqual([...PACKET])

        /* The REQ filters by the d-tag + kind. */
        for (const socket of MockWebSocket.instances) {
            expect(socket.sent[0][0]).toBe('REQ')
            expect(socket.sent[0][2]).toMatchObject({ kinds: [NOTE_KIND_DEFAULT], '#d': [tag] })
        }
    })

    it('buildReceiptEvent + packetTag + fetchReceipts close the loop', async () => {
        const hash = packetTag(PACKET)

        expect(hash).toMatch(/^[0-9a-f]{64}$/)

        const { event } = buildReceiptEvent({ mailbox: MAILBOX, packet: PACKET })

        expect(event.kind).toBe(RECEIPT_KIND_DEFAULT)
        expect(event.tags).toEqual([['d', hash]])
        expect(event.content).toBe('')
        expect(verifyEvent(event)).toBe(true)

        /* The outbox sweep: both packet hashes requested, one acknowledged. */
        MockWebSocket.instances = []

        const other = new Uint8Array(164).fill(0xcd)
        const promise = fetchReceipts({ mailbox: MAILBOX, packets: [PACKET, other], WebSocketImpl: MockWebSocket, timeout: 2000 })

        await wait(10)

        for (const socket of MockWebSocket.instances) {
            socket.open()
        }

        await wait(10)

        const subId = MockWebSocket.instances[0].sent[0][1]
        expect(MockWebSocket.instances[0].sent[0][2]).toMatchObject({ kinds: [RECEIPT_KIND_DEFAULT], '#d': [hash, packetTag(other)] })
        MockWebSocket.instances[0].receive(['EVENT', subId, { id: 'r1', kind: RECEIPT_KIND_DEFAULT, tags: [['d', hash]] }])
        MockWebSocket.instances[0].receive(['EOSE', subId])

        const seen = await promise

        expect([...seen]).toEqual([hash])
    })
})
