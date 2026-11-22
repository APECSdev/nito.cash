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

const { scanPoolMock, defaultPoolMock } = vi.hoisted(() => ({
    scanPoolMock: vi.fn(),
    defaultPoolMock: vi.fn(),
}))

vi.mock('@/lib/pool/scan', () => ({ scanPool: scanPoolMock }))
vi.mock('@/lib/pool/registry', () => ({ getDefaultPool: defaultPoolMock }))
vi.mock('@/lib/bch/provider', () => ({ getCluster: vi.fn(async () => ({})) }))

/* The registry pool fixture (only fields the store action reads). */
const POOL = { id: 'test-pool', genesisLeafCount: 2 }

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
        defaultPoolMock.mockReturnValue(POOL)
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

    it('resetPool clears the scan checkpoint (destroy parity)', async () => {
        const facade = getStoreFacade()

        scanPoolMock.mockResolvedValue(fixtureScan())

        await facade.dispatch('pool/scanPool')

        expect(facade.state.pool.scan).not.toBeNull()

        facade.dispatch('pool/resetPool')

        expect(facade.state.pool.scan).toBeNull()
    })
})
