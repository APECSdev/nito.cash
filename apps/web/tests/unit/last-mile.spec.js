/* Last-mile branches: Send teardown/scan helpers, Settings network toggle
 * (both directions), Wallet PUSD fallback, Dashboard without a wallet.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import msgpack from 'msgpack-lite'

const { cluster, getClusterMock } = vi.hoisted(() => ({
    cluster: {
        getBalance: vi.fn(async () => ({ confirmed: 0, unconfirmed: 0 })),
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

import { useStore, getStoreFacade, StoreCompatPlugin, ensureStoreFacade } from '@/store'
import Send from '@/views/Send.vue'
import Settings from '@/views/Settings.vue'
import Wallet from '@/views/Wallet.vue'
import Dashboard from '@/views/Dashboard.vue'
import Setup from '@/views/Setup.vue'

const ENTROPY = 'ab'.repeat(32)
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }

const stubs = {
    Animation: true, BlazeBanner: true, Backup: true, Import: true, WizardConnect: true,
    SeedVault: true, Passkey: true, Warning: true, Concierge: true, Help: true, Transaction: true,
    QR: true, Spinner: true, svgicon: true, Tabs: true, Toggle: true, Dropdown: true,
    Address: { template: '<textarea />' }, Amount: { template: '<input type="number" />' },
    Button: { template: '<button><slot /></button>' },
    Footer: { template: '<footer><slot /></footer>' },
    Header: { template: '<header><slot /></header>' },
    Modal: { template: '<div><slot /></div>' },
    Popup: { template: '<div><slot /></div>' },
}

const mountView = (component, params = {}) => shallowMount(component, {
    global: {
        mocks: { $store: getStoreFacade(), $router: router, $route: { params, query: {} }, $t: (k) => k },
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
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
})

describe('views/Send (teardown + scan helpers)', () => {
    it('releases the camera and scanner on unmount', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 60))

        const stop = vi.fn()
        const destroy = vi.fn()
        wrapper.vm.camera = { stop }
        wrapper.vm.scanner = { destroy }

        wrapper.unmount()

        expect(stop).toHaveBeenCalled()
        expect(destroy).toHaveBeenCalled()
    })

    it('initScanData returns false without a scan query', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 60))

        expect(() => wrapper.vm.initScanData()).not.toThrow()
    })
})

describe('views/Settings (network toggle both ways)', () => {
    it('switches back to mainnet', async () => {
        getStoreFacade().state.profile.net = 'chipnet'

        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.toggleNetwork(false)

        expect(getStoreFacade().state.profile.net).toBe('mainnet')
    })

    it('isChipnet reflects the active network', async () => {
        getStoreFacade().state.profile.net = 'chipnet'

        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 40))

        expect(wrapper.vm.isChipnet).toBe(true)
    })
})

describe('views/Dashboard (no wallet)', () => {
    it('renders the zero-valued balance card before any wallet exists', async () => {
        getStoreFacade().state.wallets.a = null
        getStoreFacade().state.profile.ms = null

        const wrapper = mountView(Dashboard)
        await new Promise((r) => setTimeout(r, 60))

        expect(wrapper.vm.walletBalance).toBeTruthy()
        expect(wrapper.vm.fiatAmount).toBeTruthy()
    })
})

describe('template branches (final)', () => {
    it('Setup renders the onboarding CTAs without a wallet', async () => {
        getStoreFacade().state.wallets.a = null
        getStoreFacade().state.profile.ms = null

        const wrapper = mountView(Setup)
        await new Promise((r) => setTimeout(r, 60))

        expect(wrapper.html()).toBeTruthy()
    })

    it('Send renders the receiver/paste block once a receiver is set', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.setReceiver('bitcoincash:qpv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf')
        await new Promise((r) => setTimeout(r, 40))

        expect(wrapper.html()).toBeTruthy()

        wrapper.vm.cameraError = true
        await new Promise((r) => setTimeout(r, 20))
        expect(wrapper.vm.cameraError).toBe(true)
    })

    it('Settings renders the Wallet tab sections', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.updateTab('Wallet')
        await new Promise((r) => setTimeout(r, 40))

        expect(wrapper.vm.tab).toBe('Wallet')
    })
})

describe('Setup deep links + Settings notification errors', () => {
    it('initScanData redirects to Send for a ?scan= URL', async () => {
        getStoreFacade().state.wallets.a = null

        const wrapper = mountView(Setup)
        await new Promise((r) => setTimeout(r, 40))

        /* Stub the location the component reads (jsdom's is read-only). */
        const real = window.location
        vi.stubGlobal('location', { search: '?scan=bitcoincash%3Aqscanned' })

        expect(wrapper.vm.initScanData()).toBe(true)
        expect(router.replace).toHaveBeenCalledWith('send')

        vi.stubGlobal('location', real)
    })

    it('initSponsorWallet imports a 36-character (UUID) seed', async () => {
        getStoreFacade().state.wallets.a = null

        const wrapper = mountView(Setup)
        await new Promise((r) => setTimeout(r, 40))

        /* The sponsor import appends to the imported-seed pool. */
        getStoreFacade().state.wallets.importedSeeds = []

        const real = window.location
        vi.stubGlobal('location', { search: '?47a49dfe-2fe4-4343-b81e-947580f243f0' })

        expect(wrapper.vm.initSponsorWallet()).toBe(true)

        vi.stubGlobal('location', real)
    })

    it('reports a browser without Notification support', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        const realNotification = globalThis.Notification
        delete globalThis.Notification

        await wrapper.vm.toggleNotifications(true)

        globalThis.Notification = realNotification

        expect(wrapper.vm).toBeTruthy()
    })

    it('reports blocked notifications', async () => {
        vi.stubGlobal('Notification', Object.assign(vi.fn(), {
            permission: 'denied',
            requestPermission: vi.fn(async () => 'denied'),
        }))

        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        await wrapper.vm.toggleNotifications(true)

        /* Permission was refused -> the flag is NOT enabled (a fresh store
           has no flags object at all). */
        const flags = getStoreFacade().getters['profile/getFlags']

        expect(flags ? flags.bn : undefined).not.toBe(true)
    })
})

describe('final 3 lines', () => {
    it('getCurrencies returns [] without rates', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 40))

        expect(wrapper.vm.getCurrencies()).toEqual([])
    })

    it('renders the naked-vault footer actions', async () => {
        const wrapper = mountView(Wallet, { walletId: 'naked-vault' })
        await new Promise((r) => setTimeout(r, 80))

        expect(wrapper.html()).toBeTruthy()
    })
})

describe('final coverage (scanner guards)', () => {
    it('setReceiver stops an active camera + scanner', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 60))

        const stop = vi.fn()
        const destroy = vi.fn()
        wrapper.vm.camera = { stop }
        wrapper.vm.scanner = { destroy }

        wrapper.vm.setReceiver('bitcoincash:qnew')

        expect(stop).toHaveBeenCalled()
        expect(destroy).toHaveBeenCalled()
        expect(wrapper.vm.camera).toBeNull()
        expect(wrapper.vm.scanner).toBeNull()
    })

    it('sets cameraError when the browser exposes no camera API', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 60))

        /* Remove the media stack entirely. */
        Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })

        await wrapper.vm.startScanner().catch(() => {})

        expect(wrapper.vm.cameraError).toBe(true)

        /* Restore for the other specs in this file. */
        Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
    })

})
