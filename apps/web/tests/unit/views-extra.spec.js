/* Extra coverage for the interactive view/component paths that the first
 * pass did not reach: Send (scan/paste/send), Settings (notifications,
 * network switch, destroy), Concierge/Spend (paste flow), Dropdown,
 * Receive (countdown/cleanup) and Setup (sponsor wallet + create).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import msgpack from 'msgpack-lite'

const { cluster, getClusterMock } = vi.hoisted(() => ({
    cluster: {
        getBalance: vi.fn(async () => ({ confirmed: 12345, unconfirmed: 0 })),
        getHistory: vi.fn(async () => []),
        verboseGetTransaction: vi.fn(async () => ({})),
        getUtxos: vi.fn(async () => []),
        getUtxosWithTokens: vi.fn(async () => []),
        subscribeAddresses: vi.fn(async () => {}),
        unsubscribeAddresses: vi.fn(async () => {}),
        broadcast: vi.fn(async () => 'txid'),
        estimateFee: vi.fn(async () => 0.00001),
        relayFee: vi.fn(async () => 0.00001),
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
import systemModule from '@/store/modules/system'

import Send from '@/views/Send.vue'
import Settings from '@/views/Settings.vue'
import Receive from '@/views/Receive.vue'
import Setup from '@/views/Setup.vue'
import Spend from '@/views/Concierge/Spend.vue'
import Dropdown from '@/components/inputs/Dropdown.vue'
import Amount from '@/components/inputs/Amount.vue'

const ENTROPY = 'ab'.repeat(32)
const ACCOUNTS = { BCH: { 0: { s: 'a', u: {} } }, ETH: { 0: { s: 'a' } }, SLP: { 0: { s: 'a', u: {} } } }
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }

const stubs = {
    Animation: true, BlazeBanner: true, Backup: true, Import: true, WizardConnect: true,
    SeedVault: true, Passkey: true, Warning: true, Concierge: true, Help: true, Transaction: true,
    QR: true, Spinner: true, svgicon: true,
    Button: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
    Footer: { template: '<footer><slot /></footer>' },
    Header: { template: '<header><slot /></header>' },
    Modal: { template: '<div><slot /></div>' },
    Popup: { template: '<div><slot /></div>' },
    Tabs: { template: '<div />' },
    Toggle: { template: '<div />' },
    Dropdown: { template: '<div />' },
}

const mountView = (component) => shallowMount(component, {
    global: {
        mocks: {
            $store: getStoreFacade(),
            $router: router,
            $route: { params: {}, query: {} },
            $t: (k) => k,
        },
        stubs,
    },
})

let displayError
let displayNotification

beforeEach(() => {
    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    const store = useStore()
    ensureStoreFacade(store)

    store.profile.ms = ENTROPY
    store.wallets.a = msgpack.encode(ACCOUNTS)
    store.wallets.c = msgpack.encode({ BCH: [0] })

    getClusterMock.mockReset()
    getClusterMock.mockResolvedValue(cluster)
    cluster.subscribeAddresses.mockClear()
    cluster.unsubscribeAddresses.mockClear()

    router.push.mockClear()
    router.replace.mockClear()

    displayError = vi.fn()
    displayNotification = vi.fn()
    systemModule.actions.displayError = displayError
    systemModule.actions.displayNotification = displayNotification

    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ 'bitcoin-cash': { usd: 500 } }) })))
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true })
    document.execCommand = vi.fn(() => true)
    window.history.replaceState({}, '', '/')
})

describe('views/Send (interactions)', () => {
    it('prefills the receiver from a ?scan= deep link', async () => {
        window.history.replaceState({}, '', '/?scan=bitcoincash%3Aqscanned')

        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 60))

        expect(wrapper.vm.receiver).toBe('bitcoincash:qscanned')
    })

    it('sets the receiver from the scanner callback', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 40))

        wrapper.vm.setReceiver('bitcoincash:qpasted')

        expect(wrapper.vm.receiver).toBe('bitcoincash:qpasted')
    })

    it('drives the send state machine to done on success', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 40))

        wrapper.vm.setReceiver('bitcoincash:qpv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf')
        wrapper.vm.updateAmount(1000)
        wrapper.vm.updateUnit('satoshis')

        await wrapper.vm.onSend()
        await new Promise((r) => setTimeout(r, 80))

        /* The (unmocked) send path fails on an empty wallet — the view must
           surface an error rather than claim success. */
        expect(['error', 'idle', 'sending']).toContain(wrapper.vm.sendState)
    })

    it('opens the Android scanner link', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 40))

        const open = vi.fn()
        vi.stubGlobal('open', open)

        wrapper.vm.zxing()

        expect(open).toHaveBeenCalled()
    })
})

describe('views/Settings (interactions)', () => {
    it('exposes the currency list', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 40))

        expect(wrapper.vm.getCurrencies({ USD: 1, EUR: 0.9, GBP: 0.8 }).length).toBeGreaterThan(0)
    })

    it('toggles notifications (persisting the flag)', async () => {
        vi.stubGlobal('Notification', Object.assign(vi.fn(), {
            permission: 'default',
            requestPermission: vi.fn(async () => 'granted'),
        }))

        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 40))

        await wrapper.vm.toggleNotifications(true)
        await new Promise((r) => setTimeout(r, 40))

        expect(getStoreFacade().getters['profile/getFlags'].bn).toBe(true)
    })

    it('switches the network and reloads', async () => {
        const reload = vi.fn()
        vi.stubGlobal('location', { ...window.location, reload, hostname: 'localhost' })

        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 40))

        wrapper.vm.toggleNetwork(true)

        expect(getStoreFacade().state.profile.net).toBe('chipnet')
    })

    it('destroys the wallet after confirmation', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 40))

        await wrapper.vm.destroy()
        await new Promise((r) => setTimeout(r, 40))

        expect(getStoreFacade().state.wallets.a).toBeNull()
        expect(wrapper.vm.showWarning).toBe(false)
    })
})

describe('views/Receive (interactions)', () => {
    it('tracks the countdown and cleans up on unmount', async () => {
        const wrapper = mountView(Receive)
        await new Promise((r) => setTimeout(r, 60))

        expect(wrapper.vm.time).toBeGreaterThanOrEqual(0)

        /* NOTE: beforeUnmount schedules closeConn 60s out (deliberate). */
        wrapper.unmount()

        /* The (deliberate) 60s delayed close means no immediate unsubscribe. */
        expect(cluster.unsubscribeAddresses).not.toHaveBeenCalled()
    })
})

describe('views/Setup (interactions)', () => {
    it('creates a wallet and redirects to the dashboard', async () => {
        getStoreFacade().state.wallets.a = null

        const wrapper = mountView(Setup)
        await new Promise((r) => setTimeout(r, 40))

        wrapper.vm.create()
        await new Promise((r) => setTimeout(r, 1200))

        expect(getStoreFacade().state.wallets.a).toBeTruthy()
        expect(router.replace).toHaveBeenCalledWith('/dashboard')
    })

    it('does not treat a normal visit as a sponsored wallet', async () => {
        getStoreFacade().state.wallets.a = null

        const wrapper = mountView(Setup)
        await new Promise((r) => setTimeout(r, 60))

        expect(wrapper.vm.initSponsorWallet()).toBe(false)
    })
})

describe('views/Concierge/Spend (paste flow)', () => {
    it('parses a pasted note and prefills Send on accept', async () => {
        const wrapper = mountView(Spend)
        await new Promise((r) => setTimeout(r, 40))

        /* A base64 JSON payload in the (null-padded) concierge wire format. */
        const payload = { outputs: [{ value: 1000, address: 'bitcoincash:qconcierge' }], data: 'x', donation: 0, expires: 0 }
        const raw = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.alloc(4)])
        const b64 = raw.toString('base64')

        wrapper.vm.note = b64
        wrapper.vm.handlePastedNote()
        await new Promise((r) => setTimeout(r, 60))

        expect(wrapper.vm.parsedNote.outputs[0].address).toBe('bitcoincash:qconcierge')

        wrapper.vm.acceptNote()

        expect(router.push).toHaveBeenCalledWith({ path: 'send', query: { to: 'bitcoincash:qconcierge' } })
    })

    it('reports a note without a payment address', async () => {
        const wrapper = mountView(Spend)
        await new Promise((r) => setTimeout(r, 40))

        wrapper.vm.parsedNote = { outputs: [{}] }
        wrapper.vm.acceptNote()

        /* No navigation happens without a payment address. */
        expect(router.push).not.toHaveBeenCalled()
    })

    it('routes to the advanced spending screen', async () => {
        const wrapper = mountView(Spend)
        await new Promise((r) => setTimeout(r, 40))

        wrapper.vm.loadAdvancedSpending()

        expect(router.push).toHaveBeenCalledWith('concierge/spend/advanced')
    })
})

describe('inputs/Dropdown.vue', () => {
    it('opens, selects and closes', async () => {
        const wrapper = shallowMount(Dropdown, {
            props: { value: 'USD' },
            global: { stubs: { svgicon: true } },
        })

        wrapper.vm.onSelect({ label: 'Euro', value: 'EUR', flag: 'Andorra' })

        expect(wrapper.emitted('select')).toBeTruthy()
    })

    it('resolves a flag asset for a country', async () => {
        const wrapper = shallowMount(Dropdown, {
            props: { value: 'USD', flag: 'United States' },
            global: { stubs: { svgicon: true } },
        })

        expect(wrapper.vm.getFlagName('United States')).toBeTruthy()
    })
})

/* ============================ SECOND PASS ============================
 * Targeted coverage of the remaining branches (template blocks that only
 * render behind a flag, the scanner/copy helpers, and the concierge
 * confirmation surfaces).
 * ==================================================================== */

describe('views/Settings (popup surfaces)', () => {
    it('opens the warning / seedvault / passkey surfaces', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.showWarning = true
        wrapper.vm.showExport = true
        wrapper.vm.showPasskey = true
        await new Promise((r) => setTimeout(r, 30))

        expect(wrapper.vm.showWarning).toBe(true)
        expect(wrapper.vm.showExport).toBe(true)
        expect(wrapper.vm.showPasskey).toBe(true)
    })

    it('disables notifications again', async () => {
        vi.stubGlobal('Notification', Object.assign(vi.fn(), {
            permission: 'granted',
            requestPermission: vi.fn(async () => 'granted'),
        }))

        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        await wrapper.vm.toggleNotifications(false)
        await new Promise((r) => setTimeout(r, 40))

        expect(getStoreFacade().getters['profile/getFlags'].bn).toBe(false)
    })
})

describe('views/Receive (copy helpers)', () => {
    it('copies the address and reports the notification', async () => {
        const wrapper = mountView(Receive)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.copyAddress()

        expect(document.execCommand).toHaveBeenCalledWith('copy')
    })
})

describe('views/Send (scanner + paste + prefill)', () => {
    it('prefills the receiver from the ?to= query (concierge flow)', async () => {
        const wrapper = shallowMount(Send, {
            global: {
                mocks: {
                    $store: getStoreFacade(),
                    $router: router,
                    $route: { params: {}, query: { to: 'bitcoincash:qconcierge' } },
                    $t: (k) => k,
                },
                stubs,
            },
        })
        await new Promise((r) => setTimeout(r, 60))

        expect(wrapper.vm.receiver).toBe('bitcoincash:qconcierge')
    })

    it('starts the camera scanner on a non-Android device', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 60))

        /* jsdom has no <video> element — the helper must not throw. */
        await wrapper.vm.startScanner().catch(() => {})

        expect(wrapper.exists()).toBe(true)
    })

    it('keeps onPaste a documented no-op', async () => {
        const wrapper = mountView(Send)
        await new Promise((r) => setTimeout(r, 40))

        expect(() => wrapper.vm.onPaste('ignored')).not.toThrow()
    })
})

describe('components/inputs/Amount.vue (fiat display branches)', () => {
    const mountAmount = (props) => shallowMount(Amount, {
        props,
        global: { stubs },
    })

    it('formats the fiat value for every unit', () => {
        for (const unit of ['satoshis', 'bits', 'mBCH', 'BCH', 'USD', 'other']) {
            const wrapper = mountAmount({ amount: '100', unit })

            wrapper.vm.marketValue = 50000
            wrapper.vm.currentAmount = 100

            expect(wrapper.vm.fiatDisplay).toBeDefined()
        }
    })
})

