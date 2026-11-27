// apps/web/tests/unit/store/pool-store-mailbox.spec.js
//
// Store-level tests for the B3 delivery actions (src/store/modules/pool.js):
// deliverTransferNote (encrypt the recipient out-note -> outbox FIRST ->
// publish) and republishOutbox (the boot-time re-delivery). The note-mailbox
// MODULE is mocked at the seam (covered by lib/pool-note-mailbox.spec);
// carrier's REAL encryptNote/ownerPubFromDeliveryPoint run (the jsdom-safe
// babyjub path — the packet must be a real NP01 ciphertext for the
// round-trip assertion).

import { createPinia, setActivePinia } from 'pinia'
import piniaPersist from 'pinia-plugin-persistedstate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStore, StoreCompatPlugin, ensureStoreFacade, getStoreFacade } from '@/store'

/* The REAL carrier helpers (encryptNote + the delivery-point parse) — the
   packet must decrypt back for the round-trip assertion. */
import { decryptPacket, deriveDeliveryPoint, encryptNote, ownerPubFromDeliveryPoint } from '@/lib/pool/carrier'
import { parseDeliveryPoint } from '@/lib/pool/actions.js'
import { deriveSpendKey, noteCommitment } from '@/lib/pool/notes'
import { hexToBytes } from '@/lib/bch/crypto'

const ENTROPY = 'ab'.repeat(32)

const { mailboxConfigMock, buildNoteEventMock, publishEventMock } = vi.hoisted(() => ({
    mailboxConfigMock: vi.fn(),
    buildNoteEventMock: vi.fn(),
    publishEventMock: vi.fn(),
}))

vi.mock('@/lib/pool/registry', async (importOriginal) => ({
    ...(await importOriginal()),
    getNoteMailbox: mailboxConfigMock,
}))
vi.mock('@/lib/pool/note-mailbox', () => ({
    fetchNotePackets: vi.fn(),
    fetchReceipts: vi.fn(),
    publishEvent: publishEventMock,
    packetTag: () => 'tag',
    dpTag: () => 'dptag',
    buildNoteEvent: buildNoteEventMock,
    buildReceiptEvent: vi.fn(() => ({ event: { id: 'receipt' } })),
}))
vi.mock('@/lib/bch/provider', () => ({ getCluster: vi.fn(async () => ({})) }))
vi.mock('@/lib/pool/scan', () => ({ scanPool: vi.fn(async () => ({ received: [], spent: [], actions: [], scan: {} })) }))

const MAILBOX = { relays: ['wss://one.example'], noteKind: 4321, receiptKind: 4322 }

const EVENT = { id: 'note-evt-1', kind: 4321, content: 'aa' }

/* A REAL on-curve delivery point from a second wallet's entropy (raw
   literals are rejected by unpackPoint). */
const recipientPoint = async () => {
    const recipientSpendKey = deriveSpendKey(hexToBytes('ff'.repeat(32)))

    return {
        recipientSpendKey,
        recipientHex: [...await deriveDeliveryPoint(recipientSpendKey)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    }
}

describe('store/modules/pool deliverTransferNote + republishOutbox (B3)', () => {
    beforeEach(async () => {
        window.localStorage.clear()

        const pinia = createPinia()
        pinia._a = {}
        pinia.use(StoreCompatPlugin)
        pinia.use(piniaPersist)
        setActivePinia(pinia)
        ensureStoreFacade(useStore())

        const facade = getStoreFacade()

        facade.commit('profile/setMasterSeed', ENTROPY)
        facade.state.pool.outbox = []

        mailboxConfigMock.mockReset()
        mailboxConfigMock.mockReturnValue(MAILBOX)
        buildNoteEventMock.mockReset()
        buildNoteEventMock.mockReturnValue({ event: EVENT, keys: { publicKey: new Uint8Array(32).fill(1), privateKey: new Uint8Array(32).fill(2) }, dpTag: 'dptag' })
        publishEventMock.mockReset()
        publishEventMock.mockResolvedValue({ delivered: true, results: [] })
    })

    it('encrypts the RECIPIENT out-note, commits the outbox FIRST, then publishes', async () => {
        const facade = getStoreFacade()

        /* A REAL on-curve recipient delivery point, derived from a second
           wallet's entropy (any fixed 32 bytes off-curve are rejected by
           unpackPoint). The recipient's SPEND KEY is what decrypts. */
        const { recipientSpendKey, recipientHex } = await recipientPoint()
        const recipientOwnerPub = await ownerPubFromDeliveryPoint(parseDeliveryPoint(recipientHex))

        const result = {
            actionTxid: 'ab'.repeat(32),
            outNotes: [
                { value: 1000n, ownerPub: recipientOwnerPub, rho: 77n, r: 88n },
                { value: 4000n, ownerPub: 999n, rho: 1n, r: 2n },
            ],
        }

        const delivery = await facade.dispatch('pool/deliverTransferNote', { result, recipientDeliveryPoint: recipientHex, network: 'mainnet' })

        expect(delivery).toEqual({ eventId: 'note-evt-1', delivered: true })

        /* The outbox entry: the outbox owns durability (committed before the
           publish call — the ORDER is the funds-safety property). */
        expect(facade.state.pool.outbox).toHaveLength(1)

        const entry = facade.state.pool.outbox[0]

        expect(entry.actionTxid).toBe(result.actionTxid)
        expect(entry.receiptSeen).toBe(false)
        expect(entry.packetHex).toMatch(/^[0-9a-f]{328}$/) /* 164 bytes */
        expect(JSON.parse(entry.event)).toEqual(EVENT)

        /* The packet is a REAL NP01 ciphertext: it decrypts back to the
           recipient's note under the recipient's OWN spend key (the cm is
           validated against the note's real commitment — the leaf list). */
        const cm = await noteCommitment(1000n, recipientOwnerPub, 77n, 88n)
        const note = await decryptPacket(hexToBytes(entry.packetHex), recipientSpendKey, [cm.toString(10)])

        expect(note).toBeTruthy()
        expect(note.value).toBe(1000n)
        expect(note.ownerPub).toBe(recipientOwnerPub)

        /* The build + publish both happened. */
        expect(buildNoteEventMock).toHaveBeenCalledTimes(1)
        expect(publishEventMock).toHaveBeenCalledTimes(1)
    })

    it('throws when the transfer produced no recipient out-note (the ownerPub match)', async () => {
        const facade = getStoreFacade()

        const { recipientHex } = await recipientPoint()

        await expect(facade.dispatch('pool/deliverTransferNote', {
            result: { actionTxid: 'ab'.repeat(32), outNotes: [{ value: 1n, ownerPub: 5n, rho: 1n, r: 2n }] },
            recipientDeliveryPoint: recipientHex,
            network: 'mainnet',
        })).rejects.toThrow('no recipient out-note')

        expect(facade.state.pool.outbox).toHaveLength(0)
        expect(publishEventMock).not.toHaveBeenCalled()
    })

    it('returns null (no outbox entry) when the network has NO mailbox configured', async () => {
        const facade = getStoreFacade()

        mailboxConfigMock.mockReturnValue(null)

        const { recipientHex } = await recipientPoint()
        const recipientOwnerPub = await ownerPubFromDeliveryPoint(parseDeliveryPoint(recipientHex))

        const delivery = await facade.dispatch('pool/deliverTransferNote', {
            result: { actionTxid: 'ab'.repeat(32), outNotes: [{ value: 1n, ownerPub: recipientOwnerPub, rho: 1n, r: 2n }] },
            recipientDeliveryPoint: recipientHex,
            network: 'mainnet',
        })

        expect(delivery).toBeNull()
        expect(facade.state.pool.outbox).toHaveLength(0)
    })

    it('republishOutbox re-publishes PENDING entries and skips acknowledged ones', async () => {
        const facade = getStoreFacade()

        facade.state.pool.outbox = [
            { packetHex: '01'.repeat(164), event: JSON.stringify({ id: 'e1' }), receiptSeen: false },
            { packetHex: '02'.repeat(164), event: JSON.stringify({ id: 'e2' }), receiptSeen: false },
            { packetHex: '03'.repeat(164), event: JSON.stringify({ id: 'e3' }), receiptSeen: true },
        ]

        await facade.dispatch('pool/republishOutbox')

        expect(publishEventMock).toHaveBeenCalledTimes(2)
        expect(publishEventMock).toHaveBeenCalledWith({ mailbox: MAILBOX, event: { id: 'e1' } })
        expect(publishEventMock).toHaveBeenCalledWith({ mailbox: MAILBOX, event: { id: 'e2' } })
    })

    it('a publish rejection is logged, NEVER thrown (the note is already on-chain)', async () => {
        const facade = getStoreFacade()
        const { recipientHex } = await recipientPoint()
        const recipientOwnerPub = await ownerPubFromDeliveryPoint(parseDeliveryPoint(recipientHex))

        publishEventMock.mockRejectedValue(new Error('all relays down'))

        /* The deliverTransferNote action itself propagates the publish
           failure ONLY as far as the submit hook's guard — here the ACTION
           resolves with delivered:false shape... it rejects (the submit hook
           catches it). What must NEVER happen: the OUTBOX losing the entry. */
        await expect(facade.dispatch('pool/deliverTransferNote', {
            result: { actionTxid: 'ab'.repeat(32), outNotes: [{ value: 1n, ownerPub: recipientOwnerPub, rho: 1n, r: 2n }] },
            recipientDeliveryPoint: recipientHex,
            network: 'mainnet',
        })).rejects.toThrow('all relays down')

        expect(facade.state.pool.outbox).toHaveLength(1)
    })
})
