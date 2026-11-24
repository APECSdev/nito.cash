/* Unit tests for the cashaccount store module (store/modules/cashaccount.js).
 *
 * The resolver is mocked at the module boundary; the real Pinia-backed
 * facade is used so the namespaced action/getter wiring is exercised.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { resolveAccountMock } = vi.hoisted(() => ({ resolveAccountMock: vi.fn() }))

vi.mock('@/lib/cashaccount/resolver.js', () => ({
    resolveAccount: resolveAccountMock,
}))

vi.mock('@/lib/bch/provider.js', () => ({
    getCluster: vi.fn(async () => ({})),
    closeAllClusters: vi.fn(async () => {}),
    ElectrumMethods: {},
    FulcrumCluster: class {},
}))

vi.mock('@/lib/solana.js', () => ({
    SOLANA_RPC: 'https://rpc.test',
    solanaAccountFromEntropy: () => ({ address: 'So1anaAddr', publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }),
    fetchSolBalance: vi.fn(async () => 1.5),
}))

import { useStore, getStoreFacade, StoreCompatPlugin, ensureStoreFacade } from '@/store'
import { KALLISTI_CATEGORY } from '../fixtures/cashaccount-kallisti.js'

const account = {
    identifier: 'Kallisti#7B9A',
    name: 'Kallisti',
    category: KALLISTI_CATEGORY,
}

let facade

beforeEach(() => {
    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    facade = ensureStoreFacade(useStore())

    resolveAccountMock.mockReset()
    resolveAccountMock.mockResolvedValue(account)
})

describe('store/modules/cashaccount — resolve', () => {
    it('stores the resolved account and status', async () => {
        const result = await facade.dispatch('cashaccount/resolve', { identifier: 'Kallisti#7B9A' })

        expect(result).toEqual(account)
        expect(resolveAccountMock).toHaveBeenCalledWith({ identifier: 'Kallisti#7B9A' })
        expect(facade.state.cashaccount.account).toEqual(account)
        expect(facade.state.cashaccount.status).toBe('ready')
        expect(facade.state.cashaccount.error).toBeNull()
        expect(facade.getters['cashaccount/getAccount']).toEqual(account)
        expect(facade.getters['cashaccount/hasAccount']).toBe(true)
    })

    it('records the error, sets the status and rethrows', async () => {
        resolveAccountMock.mockRejectedValueOnce(new Error('ChainGraph down'))

        await expect(facade.dispatch('cashaccount/resolve', { txid: 'aa' })).rejects.toThrow('ChainGraph down')

        expect(facade.state.cashaccount.status).toBe('error')
        expect(facade.state.cashaccount.error).toBe('ChainGraph down')
        expect(facade.state.cashaccount.account).toBeNull()
    })

    it('clears the current account', async () => {
        await facade.dispatch('cashaccount/resolve', { identifier: 'Kallisti#7B9A' })
        facade.dispatch('cashaccount/clear')

        expect(facade.state.cashaccount.account).toBeNull()
        expect(facade.state.cashaccount.status).toBeNull()
        expect(facade.state.cashaccount.lastQuery).toBeNull()
        expect(facade.getters['cashaccount/hasAccount']).toBe(false)
    })
})
