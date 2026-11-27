/* Final branch coverage: the Send success state machine (with a stubbed
 * sendCrypto action), the Wallet shield/transfer/unshield scaffolds, and the
 * Setup create() path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import msgpack from 'msgpack-lite'

const { cluster, getClusterMock, sendCryptoMock } = vi.hoisted(() => ({
    cluster: {
        getBalance: vi.fn(async () => ({ confirmed: 1000, unconfirmed: 0 })),
        getHistory: vi.fn(async () => []),
        verboseGetTransaction: vi.fn(async () => ({})),
        getUtxos: vi.fn(async () => []),
        getUtxosWithTokens: vi.fn(async () => []),
        subscribeAddresses: vi.fn(async () => {}),
        unsubscribeAddresses: vi.fn(async () => {}),
        broadcast: vi.fn(async () => 'txid'),
    },
    getClusterMock: vi.fn(),
    sendCryptoMock: vi.fn(),
}))

vi.mock('@/lib/bch/provider.js', () => ({
    getCluster: getClusterMock,
    closeAllClusters: vi.fn(async () => {}),
    ElectrumMethods: {},
    FulcrumCluster: class {},
}))

vi.mock('@/lib/solana.js', () => ({
    SOLANA_RPC: 'https://rpc.test',
    solanaAccountFromEntropy: () => ({ address: 'So1', publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }),
    fetchSolBalance: vi.fn(async () => 0),
}))

/* B3 — the Wallet mount-scan's mailbox fetch must NEVER open real
   WebSockets from the suite (the CI crash: undici's global WebSocket
   dispatching jsdom Events). The module is covered by its own spec. */
vi.mock('@/lib/pool/note-mailbox', () => ({
    fetchNotePackets: vi.fn(async () => []),
    fetchReceipts: vi.fn(async () => new Set()),
    publishEvent: vi.fn(async () => ({ delivered: false })),
    buildNoteEvent: vi.fn(),
    buildReceiptEvent: vi.fn(() => ({ event: {} })),
    packetTag: () => 'tag',
    dpTag: () => 'dptag',
}))

import { useStore, getStoreFacade, StoreCompatPlugin, ensureStoreFacade } from '@/store'
import walletsModule from '@/store/modules/wallets'

import Send from '@/views/Send.vue'
import Wallet from '@/views/Wallet.vue'
import Setup from '@/views/Setup.vue'

const ENTROPY = 'ab'.repeat(32)
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }

const stubs = {
    Animation: true, BlazeBanner: true, Backup: true, Import: true, WizardConnect: true,
    SeedVault: true, Passkey: true, Warning: true, Concierge: true, Help: true, Transaction: true,
    QR: true, Spinner: true, svgicon: true, Tabs: true, Toggle: true, Dropdown: true,
    Address: { template: '<textarea />' },
    Amount: { template: '<input type="number" />' },
    Button: { template: '<button><slot /></button>' },
    Footer: { template: '<footer><slot /></footer>' },
    Header: { template: '<header><slot /></header>' },
    Modal: { template: '<div><slot /></div>' },
    Popup: { template: '<div><slot /></div>' },
}

const mountView = (component, params = {}) => shallowMount(component, {
    global: {
        mocks: {
            $store: getStoreFacade(),
            $router: router,
            $route: { params, query: {} },
            $t: (k) => k,
        },
        stubs,
    },
})

beforeEach(() => {
    /* Replace the send action BEFORE the facade captures the action map. */
    sendCryptoMock.mockReset()
    sendCryptoMock.mockResolvedValue('txid')
    walletsModule.actions.sendCrypto = sendCryptoMock

    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    const store = useStore()
    ensureStoreFacade(store)

    store.profile.ms = ENTROPY
    store.wallets.a = msgpack.encode({ BCH: { 0: { s: 'a', u: {} } } })
    store.wallets.c = msgpack.encode({ BCH: [0] })

    getClusterMock.mockReset()
    getClusterMock.mockResolvedValue(cluster)
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ 'bitcoin-cash': { usd: 500 } }) })))
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
})

describe('views/Send (success state machine)', () => {
    it('shows the completed state when the store accepts the payment', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.setReceiver('bitcoincash:qpv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf')
        wrapper.vm.updateAmount(1000)
        wrapper.vm.updateUnit('satoshis')

        await wrapper.vm.onSend()
        await new Promise((r) => setTimeout(r, 80))

        expect(sendCryptoMock).toHaveBeenCalled()
        expect(wrapper.vm.sendState).toBe('done')
    })

    it('resets to idle when the store rejects the payment', async () => {
        sendCryptoMock.mockRejectedValue(new Error('rejected'))

        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.setReceiver('bitcoincash:qpv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf')
        wrapper.vm.updateAmount(1000)
        wrapper.vm.updateUnit('satoshis')

        await wrapper.vm.onSend()
        await new Promise((r) => setTimeout(r, 80))

        expect(wrapper.vm.sendState).toBe('idle')
    })
})

describe('views/Wallet (action scaffolds)', () => {
    it('describes each shield / transfer / unshield flow', async () => {
        const wrapper = mountView(Wallet, { walletId: 'nito-cash' })
        await new Promise((r) => setTimeout(r, 80))

        for (const action of ['Shield', 'Transfer', 'Unshield']) {
            wrapper.vm.toggleAction(action)

            expect(wrapper.vm.actionDescription.length).toBeGreaterThan(20)
        }

        /* The default (unknown / cleared) branch returns an empty string. */
        wrapper.vm.activeAction = null
        expect(wrapper.vm.actionDescription).toBe('')
    })

    it('exposes the PUSD note and the shielded balance placeholder', async () => {
        const wrapper = mountView(Wallet, { walletId: 'naked-cash' })
        await new Promise((r) => setTimeout(r, 80))

        expect(wrapper.vm.pusdNote).toContain('decimals TBD')
        expect(wrapper.vm.shieldedBalance).toBeTruthy()
    })
})

describe('views/Setup (create path)', () => {
    it('creates a wallet when none exists and lands on the dashboard', async () => {
        getStoreFacade().state.wallets.a = null

        const wrapper = mountView(Setup)
        await new Promise((r) => setTimeout(r, 40))

        wrapper.vm.create()
        await new Promise((r) => setTimeout(r, 1300))

        expect(router.replace).toHaveBeenCalledWith('/dashboard')
    })
})
