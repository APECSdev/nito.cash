// apps/web/tests/unit/store/pool-store-action.spec.js
//
// Store-level tests for the pool/submitPoolAction action (the blocker #4
// wiring in src/store/modules/pool.js): the seed + registry gates, the scan
// refresh, the wallets-getter wiring (hdNode / accounts / derivation paths /
// change + payout addresses), the record/spend bookkeeping on success, the
// onStage passthrough, and the displayError + rethrow failure path.
//
// The ENGINE (lib/pool/actions.js) and the scan (lib/pool/scan.js) are
// MOCKED so the store wiring is tested in isolation (the facade pattern of
// pool-store-scan.spec.js; the engine itself is covered by
// lib/pool-actions.spec.js).

import { createPinia, setActivePinia } from 'pinia'
import piniaPersist from 'pinia-plugin-persistedstate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useStore, StoreCompatPlugin, ensureStoreFacade, getStoreFacade } from '@/store'

/* Unmocked collaborators (real): the pool key derivation + byte helpers. */
import { deriveSpendKey } from '@/lib/pool/notes'
import { hexToBytes } from '@/lib/bch/crypto'

/* A 32-byte entropy hex string, as profile.ms holds it. */
const ENTROPY = 'ab'.repeat(32)

/* The mocked scan result (the shape lib/pool/scan.js returns). */
const SCAN_RESULT = {
    address: 'bchtest:fixture',
    actions: [{ txid: 'aa', height: 5 }],
    creationTxids: [],
    tipHeight: 5,
    tipTxid: 'aa',
    received: [],
    spent: [],
}

const { submitMock, scanPoolMock, proverPoolMock, defaultPoolMock, poolsMock, clusterMock } = vi.hoisted(() => ({
    submitMock: vi.fn(),
    scanPoolMock: vi.fn(),
    proverPoolMock: vi.fn(),
    defaultPoolMock: vi.fn(),
    poolsMock: vi.fn(() => []),
    clusterMock: vi.fn(async () => ({})),
}))

vi.mock('@/lib/pool/actions', () => ({ submitPoolAction: submitMock }))
vi.mock('@/lib/pool/scan', () => ({ scanPool: scanPoolMock }))
vi.mock('@/lib/pool/registry', () => ({
    getDefaultPool: defaultPoolMock,
    getProverPool: proverPoolMock,
    getPools: poolsMock,
}))
vi.mock('@/lib/bch/provider', () => ({ getCluster: clusterMock }))

/* The registry pool fixtures (only fields the store action reads). */
const SCAN_POOL = { id: 'scan-pool', genesisLeafCount: 2 }
const PROVER_POOL = { id: 'patha-pool', genesisLeafCount: 2 }

describe('store/modules/pool submitPoolAction', () => {
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

        submitMock.mockReset()
        scanPoolMock.mockReset()
        proverPoolMock.mockReset()
        defaultPoolMock.mockReset()
        poolsMock.mockReset()
        poolsMock.mockReturnValue([])
        clusterMock.mockClear()

        /* Defaults: a scan target exists, but NO prover-compatible pool. */
        defaultPoolMock.mockReturnValue(SCAN_POOL)
        proverPoolMock.mockReturnValue(null)
        scanPoolMock.mockResolvedValue(SCAN_RESULT)
    })

    it('rejects (displayError) without a wallet seed', async () => {
        const facade = getStoreFacade()

        facade.commit('profile/setMasterSeed', null)

        await expect(facade.dispatch('pool/submitPoolAction', { action: 'shield', amount: '1000' }))
            .rejects.toThrow('Open your wallet first')

        expect(submitMock).not.toHaveBeenCalled()
    })

    it('rejects (displayError) when the network has NO prover-compatible pool', async () => {
        const facade = getStoreFacade()

        await expect(facade.dispatch('pool/submitPoolAction', { action: 'shield', amount: '1000' }))
            .rejects.toThrow('No wallet-prover-compatible pool')

        expect(scanPoolMock).not.toHaveBeenCalled()
        expect(submitMock).not.toHaveBeenCalled()
    })

    it('wires the wallet material through to the engine and books the result', async () => {
        const facade = getStoreFacade()

        proverPoolMock.mockReturnValue(PROVER_POOL)

        /* Snapshot the params at CALL time — `ownNotes` is a LIVE reference
           to state.notes that the store's post-broadcast recordNote mutates
           before any post-await assertion could read it. */
        let captured = null

        submitMock.mockImplementation(async (params) => {
            captured = { ...params, ownNotes: [...params.ownNotes] }

            return {
                txid: 'ff'.repeat(32),
                outNotes: [
                    { value: 2000n, ownerPub: 1n, rho: 2n, r: 3n, cm: 4n, nf: '9', leafIndex: 2 },
                ],
                spentNfs: ['888'],
            }
        })

        /* A pre-existing note whose nullifier the action spends. */
        await facade.dispatch('pool/recordNote', {
            value: '100', ownerPub: '1', rho: '13', r: '14', nk: '7', cm: '999', nf: '888', leafIndex: 0,
        })

        const onStage = vi.fn()

        const result = await facade.dispatch('pool/submitPoolAction', {
            action: 'unshield', amount: '1000', onStage,
        })

        expect(result.txid).toBe('ff'.repeat(32))

        /* The engine received the full wiring. */
        expect(submitMock).toHaveBeenCalledTimes(1)

        const call = captured

        expect(call.pool).toBe(PROVER_POOL)
        expect(call.scan).toBe(SCAN_RESULT)
        expect(call.action).toBe('unshield')
        expect(call.amount).toBe(1000n)
        expect(call.onStage).toBe(onStage)

        /* The pool spend key is the deterministic function of the seed. */
        expect(call.spendKey).toBe(deriveSpendKey(hexToBytes(ENTROPY)))

        /* The funding material comes from the wallets getters themselves. */
        expect(call.hdNode.privateKey).toBeTruthy()
        expect(call.derivationPath).toBe(facade.getters['wallets/getDerivationPath']('BCH'))
        expect(call.accountBase).toBe(call.derivationPath.split('/').slice(0, 4).join('/'))
        expect(Array.isArray(call.accounts)).toBe(true)
        expect(call.ownNotes).toHaveLength(1)

        /* The engine's own output note was recorded + the spent one marked. */
        expect(facade.state.pool.notes).toHaveLength(2)
        expect(facade.state.pool.notes[0].spent).toBe(true)
        expect(facade.state.pool.notes[1].cm).toBe(4n)
        expect(facade.state.pool.notes[1].spent).toBe(false)

        /* Both commitments were appended to the leaf list (the pre-seeded
           note's at its recordNote, the engine's at the success path). */
        expect(facade.state.pool.leaves).toEqual(['999', 4n])
    })

    it('passes the onStage callback through to the engine', async () => {
        const facade = getStoreFacade()

        proverPoolMock.mockReturnValue(PROVER_POOL)

        submitMock.mockResolvedValue({ txid: 'ab', outNotes: [], spentNfs: [] })

        const onStage = vi.fn()

        await facade.dispatch('pool/submitPoolAction', { action: 'transfer', amount: '5', onStage })

        expect(submitMock.mock.calls[0][0].onStage).toBe(onStage)
    })

    it('displayError + rethrow when the engine fails — NO notes recorded', async () => {
        const facade = getStoreFacade()

        proverPoolMock.mockReturnValue(PROVER_POOL)

        submitMock.mockRejectedValue(new Error('two input notes'))

        await expect(facade.dispatch('pool/submitPoolAction', { action: 'shield', amount: '1000' }))
            .rejects.toThrow('two input notes')

        expect(facade.state.pool.notes).toHaveLength(0)
        expect(facade.state.pool.leaves).toEqual([])
    })

    it('rejects when the scan yields no action chain', async () => {
        const facade = getStoreFacade()

        proverPoolMock.mockReturnValue(PROVER_POOL)
        scanPoolMock.mockResolvedValue(null)

        await expect(facade.dispatch('pool/submitPoolAction', { action: 'shield', amount: '1000' }))
            .rejects.toThrow()

        expect(submitMock).not.toHaveBeenCalled()
    })

    it('submitRole2Action: rejects (displayError) without a wallet seed', async () => {
        const facade = getStoreFacade()

        facade.commit('profile/setMasterSeed', null)

        await expect(facade.dispatch('pool/submitRole2Action', { action: 'shield', amount: '1000' }))
            .rejects.toThrow('Open your wallet first')

        expect(scanPoolMock).not.toHaveBeenCalled()
    })

    it('submitRole2Action: rejects when the role-2 pool is not registered', async () => {
        const facade = getStoreFacade()

        await expect(facade.dispatch('pool/submitRole2Action', { action: 'shield', amount: '1000' }))
            .rejects.toThrow('role-2 pool is not registered')

        expect(scanPoolMock).not.toHaveBeenCalled()
    })

    it('submitRole2Action: rejects until the pool is walletProverCompatible', async () => {
        const facade = getStoreFacade()

        poolsMock.mockReturnValue([{ id: 'chipnet-pusd-role2', walletProverCompatible: false }])

        await expect(facade.dispatch('pool/submitRole2Action', { action: 'shield', amount: '1000' }))
            .rejects.toThrow('not wallet-prover-compatible')

        expect(scanPoolMock).not.toHaveBeenCalled()
    })
})
