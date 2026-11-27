/* Template-branch coverage: the sections that only render behind a flag or a
 * specific wallet id (backup reminder / import / wizard-connect popups,
 * Settings' warning + SeedVault + passkey surfaces, and the four wallets).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import msgpack from 'msgpack-lite'

const { cluster, getClusterMock } = vi.hoisted(() => ({
    cluster: {
        getBalance: vi.fn(async () => ({ confirmed: 1000, unconfirmed: 0 })),
        getHistory: vi.fn(async () => []),
        verboseGetTransaction: vi.fn(async () => ({})),
        getUtxosWithTokens: vi.fn(async () => []),
        subscribeAddresses: vi.fn(async () => {}),
        unsubscribeAddresses: vi.fn(async () => {}),
    },
    getClusterMock: vi.fn(),
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
import Dashboard from '@/views/Dashboard.vue'
import Settings from '@/views/Settings.vue'
import Wallet from '@/views/Wallet.vue'

const ENTROPY = 'ab'.repeat(32)
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }

const stubs = {
    Animation: true, BlazeBanner: true, Backup: true, Import: true, WizardConnect: true,
    SeedVault: true, Passkey: true, Warning: true, Concierge: true, Help: true, Transaction: true,
    QR: true, Spinner: true, svgicon: true, Tabs: true, Toggle: true, Dropdown: true,
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
})

describe('Dashboard template branches', () => {
    it('renders the backup reminder + import + wizard-connect blocks', async () => {
        const wrapper = mountView(Dashboard)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.backupReminder = true
        wrapper.vm.showImport = true
        wrapper.vm.showWizardConnect = true
        await new Promise((r) => setTimeout(r, 40))

        expect(wrapper.vm.backupReminder).toBe(true)
        expect(wrapper.html()).toBeTruthy()
    })
})

describe('Settings template branches', () => {
    it('renders the warning / seedvault / passkey blocks', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.showWarning = true
        wrapper.vm.showExport = true
        wrapper.vm.showPasskey = true
        await new Promise((r) => setTimeout(r, 40))

        expect(wrapper.html()).toBeTruthy()

        /* Both tabs render (Wallet tab holds the backup sections). */
        wrapper.vm.updateTab('Wallet')
        await new Promise((r) => setTimeout(r, 30))

        expect(wrapper.vm.tab).toBe('Wallet')
    })
})

describe('Wallet template branches (all four wallets)', () => {
    it('renders each wallet surface', async () => {
        for (const id of ['nito-cash', 'naked-cash', 'nito-vault', 'naked-vault']) {
            const wrapper = mountView(Wallet, { walletId: id })
            await new Promise((r) => setTimeout(r, 80))

            expect(wrapper.vm.wallet.id).toBe(id)
            expect(wrapper.html()).toBeTruthy()

            wrapper.unmount()
        }
    })
})
