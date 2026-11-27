// apps/web/tests/unit/store/pool-store-scan.spec.js
//
// Store-level tests for the pool/scanPool note-detection action (the blocker
// #2 wiring in src/store/modules/pool.js): full rescan -> received notes are
// recorded (with their REAL on-chain leaf indices), on-chain-spent notes are
// marked, and a scan checkpoint is set. Idempotency: a rescan must not
// double-record (dedupe by commitment).
//
// The scan ENGINE (lib/pool/scan.js) is fully covered by its own spec against
// the real decoder; here the engine + provider + registry are MOCKED so the
// store wiring is tested in isolation (same facade pattern as pool-store.spec).

import { createPinia, setActivePinia } from 'pinia'
import piniaPersist from 'pinia-plugin-persistedstate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStore, StoreCompatPlugin, ensureStoreFacade, getStoreFacade } from '@/store'

/* A 32-byte entropy hex string, as profile.ms holds it. */
const ENTROPY = 'ab'.repeat(32)

/* The mocked scan result (the shape lib/pool/scan.js returns). */
const RECEIVED_NOTE = {
    value: '100', ownerPub: '7', rho: '11', r: '12',
    cm: '55', nf: '66', nk: '7',
    leafIndex: 4, txid: 'aa', height: 5,
}

/* A note the scan reports as SPENT on-chain (nf '888'). */
const SPENT_NOTE = {
    value: '1000', ownerPub: '1234', rho: '13', r: '14',
    nk: '7', cm: '999', nf: '888',
}

const { scanPoolMock, defaultPoolMock, getPoolsMock, mailboxConfigMock, fetchPacketsMock, publishEventMock, buildReceiptMock, fetchReceiptsMock } = vi.hoisted(() => ({
    scanPoolMock: vi.fn(),
    defaultPoolMock: vi.fn(),
    getPoolsMock: vi.fn(),
    mailboxConfigMock: vi.fn(),
    fetchPacketsMock: vi.fn(),
    publishEventMock: vi.fn(),
    buildReceiptMock: vi.fn(),
    fetchReceiptsMock: vi.fn(),
}))

vi.mock('@/lib/pool/scan', () => ({ scanPool: scanPoolMock }))
vi.mock('@/lib/pool/registry', () => ({ getDefaultPool: defaultPoolMock, getPools: getPoolsMock, getNoteMailbox: mailboxConfigMock }))
vi.mock('@/lib/bch/provider', () => ({ getCluster: vi.fn(async () => ({})) }))

/* B3 — the note mailbox is MOCKED at the module seam (the real module is
   covered by lib/pool-note-mailbox.spec); carrier's deriveDeliveryPoint is
   stubbed so the scan spec stays free of the babyjub wasm. */
vi.mock('@/lib/pool/note-mailbox', () => ({
    fetchNotePackets: fetchPacketsMock,
    publishEvent: publishEventMock,
    buildReceiptEvent: buildReceiptMock,
    fetchReceipts: fetchReceiptsMock,
    packetTag: (packet) => 'tag:' + [...packet].join(','),
    dpTag: () => 'dptag',
    buildNoteEvent: vi.fn(),
}))
vi.mock('@/lib/pool/carrier', async (importOriginal) => ({
    ...(await importOriginal()),
    deriveDeliveryPoint: vi.fn(async () => new Uint8Array(32).fill(0xee)),
    encryptNote: vi.fn(async () => new Uint8Array(164).fill(0xab)),
}))

/* The registry pool fixtures (only fields the store action reads). */
const POOL = { id: 'test-pool', genesisLeafCount: 2 }
const OTHER_POOL = { id: 'test-pool-3out', genesisLeafCount: 2, outputs: 3 }

function fixtureScan(overrides = {}) {
    return {
        address: 'bchtest:fixture',
        actions: [{ txid: 'aa', height: 5 }],
        creationTxids: [],
        tipHeight: 5,
        tipTxid: 'aa',
        received: [RECEIVED_NOTE],
        spent: [],
        ...overrides,
    }
}

describe('store/modules/pool scanPool', () => {
    beforeEach(async () => {
        window.localStorage.clear()

        const pinia = createPinia()
        pinia._a = {}
        pinia.use(StoreCompatPlugin)
        pinia.use(piniaPersist)
        setActivePinia(pinia)
        ensureStoreFacade(useStore())

        const facade = getStoreFacade()

        facade.state.pool.notes = []
        facade.state.pool.leaves = []
        facade.state.pool.sealed = null
        facade.state.pool.scan = null
        facade.dispatch('pool/lockPool')

        facade.commit('profile/setMasterSeed', ENTROPY)

        scanPoolMock.mockReset()
        defaultPoolMock.mockReset()
        getPoolsMock.mockReset()
        defaultPoolMock.mockReturnValue(POOL)
        getPoolsMock.mockReturnValue([POOL, OTHER_POOL])

        /* B3 defaults: NO mailbox configured + empty fetches. */
        mailboxConfigMock.mockReset()
        mailboxConfigMock.mockReturnValue(null)
        fetchPacketsMock.mockReset()
        fetchPacketsMock.mockResolvedValue([])
        publishEventMock.mockReset()
        publishEventMock.mockResolvedValue({ delivered: true })
        buildReceiptMock.mockReset()
        buildReceiptMock.mockReturnValue({ event: { id: 'receipt-evt' } })
        fetchReceiptsMock.mockReset()
        fetchReceiptsMock.mockResolvedValue(new Set())
    })

    it('records received notes with their real leaf indices + checkpoints the scan', async () => {
        const facade = getStoreFacade()

        scanPoolMock.mockResolvedValue(fixtureScan())

        const result = await facade.dispatch('pool/scanPool')

        expect(result).toEqual({ received: 1, spent: 0, actions: 1, scan: fixtureScan() })

        /* The received note is stored with the scan-assigned leaf index. */
        expect(facade.state.pool.notes).toHaveLength(1)
        expect(facade.state.pool.notes[0].cm).toEqual('55')
        expect(facade.state.pool.notes[0].leafIndex).toEqual(4)
        expect(facade.state.pool.notes[0].spent).toEqual(false)

        /* Its commitment was appended to the leaf list. */
        expect(facade.state.pool.leaves).toEqual(['55'])

        /* Checkpoint set. */
        expect(facade.state.pool.scan).toEqual({ height: 5, txid: 'aa', actionCount: 1 })

        /* The engine was called with the wallet's pool spend key material. */
        expect(scanPoolMock).toHaveBeenCalledTimes(1)
        expect(scanPoolMock.mock.calls[0][0].pool).toEqual(POOL)
        expect(scanPoolMock.mock.calls[0][0].networkId).toEqual('mainnet')
    })

    it('scans the SELECTED pool when the payload names one (the 3-out selector)', async () => {
        const facade = getStoreFacade()

        scanPoolMock.mockResolvedValue(fixtureScan())

        await facade.dispatch('pool/scanPool', { poolId: OTHER_POOL.id })

        expect(scanPoolMock.mock.calls[0][0].pool).toEqual(OTHER_POOL)
        expect(defaultPoolMock).not.toHaveBeenCalled()
    })

    it('falls back to the network default pool when the payload names none', async () => {
        const facade = getStoreFacade()

        scanPoolMock.mockResolvedValue(fixtureScan())

        await facade.dispatch('pool/scanPool')

        expect(scanPoolMock.mock.calls[0][0].pool).toEqual(POOL)
    })

    it('is idempotent: a rescan does not double-record (dedupe by cm)', async () => {
        const facade = getStoreFacade()

        scanPoolMock.mockResolvedValue(fixtureScan())

        await facade.dispatch('pool/scanPool')
        await facade.dispatch('pool/scanPool')

        expect(facade.state.pool.notes).toHaveLength(1)
        expect(facade.state.pool.leaves).toEqual(['55'])
    })

    it('marks a note spent when the scan reveals its nullifier', async () => {
        const facade = getStoreFacade()

        /* Seed the store with the note the scan will report as spent. */
        await facade.dispatch('pool/recordNote', { ...SPENT_NOTE, leafIndex: 2 })

        expect(facade.state.pool.notes[0].spent).toEqual(false)

        scanPoolMock.mockResolvedValue(fixtureScan({ received: [], spent: ['888'] }))

        const result = await facade.dispatch('pool/scanPool')

        expect(result.received).toEqual(0)
        expect(result.spent).toEqual(1)
        expect(facade.state.pool.notes[0].spent).toEqual(true)
    })

    it('returns null without a wallet seed (nothing to decrypt with)', async () => {
        const facade = getStoreFacade()

        facade.commit('profile/setMasterSeed', null)

        expect(await facade.dispatch('pool/scanPool')).toBeNull()

        expect(scanPoolMock).not.toHaveBeenCalled()
    })

    it('returns null when the network has no registered pool', async () => {
        const facade = getStoreFacade()

        defaultPoolMock.mockReturnValue(null)

        expect(await facade.dispatch('pool/scanPool')).toBeNull()

        expect(scanPoolMock).not.toHaveBeenCalled()
    })

    /* ---- B3 — the note mailbox wiring (the off-chain receive leg) ---- */

    it('SINGLE-FLIGHT: two concurrent scans of the SAME pool run the engine once', async () => {
        const facade = getStoreFacade()

        scanPoolMock.mockImplementation(async () => {
            await new Promise((r) => setTimeout(r, 50))
            return fixtureScan()
        })

        const [a, b] = await Promise.all([
            facade.dispatch('pool/scanPool'),
            facade.dispatch('pool/scanPool'),
        ])

        expect(scanPoolMock).toHaveBeenCalledTimes(1)
        expect(a).toEqual(b)

        /* A scan of a DIFFERENT pool is NOT blocked by the in-flight one. */
        const c = await facade.dispatch('pool/scanPool', { poolId: 'test-pool-3out' })
        expect(c.actions).toBe(1)
        expect(scanPoolMock).toHaveBeenCalledTimes(2)
    })

    it('fetches the note mailbox + passes the packets to the scan engine', async () => {
        const facade = getStoreFacade()

        mailboxConfigMock.mockReturnValue({ relays: ['wss://one'], noteKind: 4321, receiptKind: 4322 })
        const packet = new Uint8Array(164).fill(0xab)
        fetchPacketsMock.mockResolvedValue([{ packet, actionTxid: 'aa', eventId: 'e1' }])
        scanPoolMock.mockResolvedValue(fixtureScan())

        await facade.dispatch('pool/scanPool')

        /* The fetch used the wallet's OWN delivery point. */
        expect(fetchPacketsMock).toHaveBeenCalledTimes(1)
        expect(fetchPacketsMock.mock.calls[0][0].mailbox.relays).toEqual(['wss://one'])
        expect(fetchPacketsMock.mock.calls[0][0].ownDeliveryPoint).toEqual(new Uint8Array(32).fill(0xee))

        /* The packets rode into the engine's mailboxPackets. */
        expect(scanPoolMock.mock.calls[0][0].mailboxPackets).toEqual([{ packet, actionTxid: 'aa', eventId: 'e1' }])
    })

    it('a relay outage NEVER breaks the chain scan (the fetch is guarded)', async () => {
        const facade = getStoreFacade()

        mailboxConfigMock.mockReturnValue({ relays: ['wss://one'], noteKind: 4321, receiptKind: 4322 })
        fetchPacketsMock.mockRejectedValue(new Error('relay down'))
        scanPoolMock.mockResolvedValue(fixtureScan())

        const result = await facade.dispatch('pool/scanPool')

        expect(result.received).toBe(1)
        expect(scanPoolMock.mock.calls[0][0].mailboxPackets).toEqual([])
    })

    it('acknowledges every fetched packet with a receipt event (fire-and-forget)', async () => {
        const facade = getStoreFacade()

        mailboxConfigMock.mockReturnValue({ relays: ['wss://one'], noteKind: 4321, receiptKind: 4322 })
        fetchPacketsMock.mockResolvedValue([
            { packet: new Uint8Array(164).fill(1), actionTxid: 'aa', eventId: 'e1' },
            { packet: new Uint8Array(164).fill(2), actionTxid: 'aa', eventId: 'e2' },
        ])
        scanPoolMock.mockResolvedValue(fixtureScan())

        await facade.dispatch('pool/scanPool')

        await vi.waitFor(() => expect(buildReceiptMock).toHaveBeenCalledTimes(2))
        await vi.waitFor(() => expect(publishEventMock).toHaveBeenCalledTimes(2))
    })

    it('the outbox sweep: acknowledged entries clear, pending ones re-publish', async () => {
        const facade = getStoreFacade()

        mailboxConfigMock.mockReturnValue({ relays: ['wss://one'], noteKind: 4321, receiptKind: 4322 })
        scanPoolMock.mockResolvedValue(fixtureScan({ received: [] }))

        const acked = { packetHex: '01'.repeat(164), actionTxid: 'aa', event: JSON.stringify({ id: 'e1' }), receiptSeen: false }
        const pending = { packetHex: '02'.repeat(164), actionTxid: 'bb', event: JSON.stringify({ id: 'e2' }), receiptSeen: false }
        facade.state.pool.outbox = [acked, pending]

        /* The sweep's receipt check acknowledges only the FIRST packet
           (the outbox order: the acked entry was passed first). */
        fetchReceiptsMock.mockImplementation(async ({ packets }) =>
            new Set(['tag:' + [...packets[0]].join(',')]))

        await facade.dispatch('pool/scanPool')

        /* The acknowledged entry is cleared; the pending one re-published. */
        await vi.waitFor(() => expect(publishEventMock).toHaveBeenCalledWith({
            mailbox: { relays: ['wss://one'], noteKind: 4321, receiptKind: 4322 },
            event: JSON.parse(pending.event),
        }))
        await vi.waitFor(() => {
            expect(facade.state.pool.outbox).toHaveLength(1)
            expect(facade.state.pool.outbox[0].eventId ?? JSON.parse(facade.state.pool.outbox[0].event).id).toBe('e2')
        })
    })

    it('no mailbox configured: the scan runs clean with zero mailbox calls', async () => {
        const facade = getStoreFacade()

        scanPoolMock.mockResolvedValue(fixtureScan())

        await facade.dispatch('pool/scanPool')

        expect(fetchPacketsMock).not.toHaveBeenCalled()
        expect(fetchReceiptsMock).not.toHaveBeenCalled()
        expect(scanPoolMock.mock.calls[0][0].mailboxPackets).toEqual([])
    })

    it('resetPool clears the scan checkpoint (destroy parity)', async () => {
        const facade = getStoreFacade()

        scanPoolMock.mockResolvedValue(fixtureScan())

        await facade.dispatch('pool/scanPool')

        expect(facade.state.pool.scan).not.toBeNull()

        facade.dispatch('pool/resetPool')

        expect(facade.state.pool.scan).toBeNull()
    })
})
