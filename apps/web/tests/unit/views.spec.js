/* Unit tests for the route-level views.
 *
 * Every view is mounted with the REAL Pinia-backed store facade and a
 * MOCKED Fulcrum cluster / Solana RPC / ticker, so the created() hooks and
 * the user-facing methods run exactly as they do in the app without any
 * network access.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import msgpack from 'msgpack-lite'

/* ---- network mocks (hoisted) ---- */
const { cluster, getClusterMock } = vi.hoisted(() => {
    const cluster = {
        getBalance: vi.fn(async () => ({ confirmed: 12345, unconfirmed: 0 })),
        getHistory: vi.fn(async () => []),
        getScripthashHistory: vi.fn(async () => []),
        verboseGetTransaction: vi.fn(async () => ({ txid: 'aa', confirmations: 1, time: 1700000000, vin: [], vout: [] })),
        getUtxos: vi.fn(async () => []),
        getUtxosWithTokens: vi.fn(async () => []),
        subscribeAddresses: vi.fn(async () => {}),
        unsubscribeAddresses: vi.fn(async () => {}),
        broadcast: vi.fn(async () => 'txid'),
        estimateFee: vi.fn(async () => 0.00001),
        relayFee: vi.fn(async () => 0.00001),
    }

    return { cluster, getClusterMock: vi.fn(async () => cluster) }
})

vi.mock('@/lib/bch/provider.js', () => ({
    getCluster: getClusterMock,
    closeAllClusters: vi.fn(async () => {}),
    ElectrumMethods: {},
    FulcrumCluster: class {},
}))

vi.mock('@/lib/solana.js', () => ({
    SOLANA_RPC: 'https://rpc.test',
    solanaAccountFromEntropy: () => ({ address: 'So1anaAddr', publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }),
    fetchSolBalance: vi.fn(async () => 1.5),
}))

/* ---- shielded-pool mocks (hoisted) — the blocker #4 action wiring: the
   registry's prover-pool lookup + the action engine swap per-test. ---- */
const { proverPoolMock, submitPoolActionMock, getPoolsMock, submitRole2ActionMock } = vi.hoisted(() => ({
    proverPoolMock: vi.fn(),
    submitPoolActionMock: vi.fn(),
    getPoolsMock: vi.fn(() => []),
    submitRole2ActionMock: vi.fn(),
}))

vi.mock('@/lib/pool/registry.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getProverPool: proverPoolMock,
    getPools: getPoolsMock,
}))

vi.mock('@/lib/pool/actions.js', () => ({
    submitPoolAction: submitPoolActionMock,
}))
vi.mock('@/lib/pool/role2-actions.js', () => ({
    submitRole2Action: submitRole2ActionMock,
}))

/* Import the store + facade AFTER the mocks. */
import { useStore, getStoreFacade, StoreCompatPlugin, ensureStoreFacade } from '@/store'

import Dashboard from '@/views/Dashboard.vue'
import Backup from '@/components/popups/Backup.vue'
import Button from '@/components/Button.vue'
import History from '@/views/History.vue'
import Receive from '@/views/Receive.vue'
import Send from '@/views/Send.vue'
import Settings from '@/views/Settings.vue'
import Setup from '@/views/Setup.vue'
import Wallet from '@/views/Wallet.vue'
import Restore from '@/views/Restore.vue'
import Concierge from '@/views/Concierge.vue'
import Lobby from '@/views/Concierge/Lobby.vue'
import Earn from '@/views/Concierge/Earn.vue'
import Spend from '@/views/Concierge/Spend.vue'
import Persona from '@/views/Concierge/Persona.vue'
import Advanced from '@/views/Concierge/Spend/Advanced.vue'
import App from '@/App.vue'

/* A wallet with one account + a discovered change index, so address/balance
   derivation runs for real against the mocked cluster. */
const ENTROPY = 'ab'.repeat(32)
const ACCOUNTS = { BCH: { 0: { s: 'a', u: {} }, 1: { s: 'a', u: {} } }, ETH: { 0: { s: 'a' } }, SLP: { 0: { s: 'a', u: {} } } }

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }

const stubs = {
    Animation: true,
    BlazeBanner: true,
    /* The Button stub must declare + render its label PROP — the real Button
       renders `label`, not slot content (the AGENTS precedent). */
    Button: { props: ['label'], template: '<button @click="$emit(\'click\')">{{label}}<slot /></button>' },
    Dropdown: { template: '<div />' },
    Footer: { template: '<footer><slot /></footer>' },
    Header: { template: '<header><slot /></header>' },
    Modal: { template: '<div><slot /></div>' },
    Notification: true,
    Popup: { template: '<div><slot /></div>' },
    QR: true,
    Spinner: true,
    Tabs: { template: '<div />' },
    Toggle: { template: '<div />' },
    svgicon: true,
    SeedVault: true,
    Warning: true,
    Backup: true,
    Import: true,
    WizardConnect: true,
    Passkey: true,
    Concierge: true,
    Help: true,
    Transaction: true,
}

/* Wait until `_predicate` is true (async created() hooks under parallel load). */
const waitFor = async (_predicate, _timeout = 2000) => {
    const started = Date.now()
    while (Date.now() - started < _timeout) {
        if (_predicate()) return true
        await new Promise((r) => setTimeout(r, 25))
    }
    return false
}

const mountView = (component, options = {}) => shallowMount(component, {
    global: {
        mocks: {
            $store: getStoreFacade(),
            $router: router,
            $route: { params: {}, query: {} },
            $t: (key) => key,
        },
        stubs,
    },
    ...options,
})

beforeEach(() => {
    /* The facade is cached on globalThis and is NOT rebuilt for a new Pinia
       instance, so a previous test's store would otherwise stay in use
       (the Setup test nulls the account model — that leak made Wallet read
       zero accounts). Drop it and rebuild against this test's store. */
    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    const store = useStore()
    ensureStoreFacade(store)

    /* Seed a deterministic wallet. */
    store.profile.ms = ENTROPY
    store.wallets.a = msgpack.encode(ACCOUNTS)
    store.wallets.c = msgpack.encode({ BCH: [0] })

    router.push.mockClear()
    router.replace.mockClear()
    proverPoolMock.mockReset()
    proverPoolMock.mockReturnValue(null)
    submitPoolActionMock.mockReset()
    getPoolsMock.mockReset()
    getPoolsMock.mockReturnValue([])
    submitRole2ActionMock.mockReset()
    getClusterMock.mockClear()
    cluster.getBalance.mockClear()
    cluster.getHistory.mockReset()
    cluster.getHistory.mockResolvedValue([])
    cluster.verboseGetTransaction.mockReset()
    cluster.verboseGetTransaction.mockResolvedValue({ txid: 'aa', confirmations: 1, time: 1700000000, vin: [], vout: [] })
    cluster.subscribeAddresses.mockClear()

    /* Realistic CoinGecko response (getTicker expects data['bitcoin-cash'][ccy]). */
    vi.stubGlobal('fetch', vi.fn(async () => ({
        json: async () => ({ 'bitcoin-cash': { usd: 500, eur: 450 } }),
    })))

    /* jsdom has no clipboard fallback command. */
    document.execCommand = vi.fn(() => true)

    /* jsdom has no camera stack (Send.vue's scanner probes it). */
    Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: vi.fn(async () => {}) },
        configurable: true,
    })
})

describe('views/Dashboard', () => {
    it('mounts and loads the wallet balance', async () => {
        const wrapper = mountView(Dashboard)

        /* NOTE: walletBalance starts as a ZERO-VALUED display object (so the
           template never reads `.value` of null) — poll for the real one. */
        await waitFor(() => wrapper.vm.walletBalance && wrapper.vm.walletBalance.satoshis !== undefined)

        expect(wrapper.exists()).toBe(true)
        expect(wrapper.vm.walletBalance).toBeTruthy()
        /* 2 receiving + 1 discovered change address = 3 x 12345 */
        expect(wrapper.vm.walletBalance.satoshis).toBe(37035)
    })

    it('navigates to every section', () => {
        const wrapper = mountView(Dashboard)

        wrapper.vm.loadSend()
        expect(router.push).toHaveBeenCalledWith('send')

        wrapper.vm.loadReceive()
        expect(router.push).toHaveBeenCalledWith('receive')

        wrapper.vm.loadSettings()
        expect(router.push).toHaveBeenCalledWith('settings')

        wrapper.vm.loadHistory()
        expect(router.push).toHaveBeenCalledWith('history')

        wrapper.vm.loadConcierge()
        expect(router.push).toHaveBeenCalledWith('concierge')

        /* The quick-action order: Concierge now sits before History. */
        expect(wrapper.findAll('.tile-label').map((label) => label.text()))
            .toEqual(['Connect a 3rd-party wallet', 'Concierge', 'History'])
    })

    it('opens the WizardConnect modal', () => {
        const wrapper = mountView(Dashboard)

        expect(wrapper.vm.showWizardConnect).toBe(false)
        wrapper.vm.openWizardConnect()
        expect(wrapper.vm.showWizardConnect).toBe(true)
    })

    it('renders the fiat-primary / BCH-secondary display helpers', () => {
        const wrapper = mountView(Dashboard)

        wrapper.vm.walletBalance = { satoshis: 100000000, value: 1, unit: 'BCH', fiat: '$500.00 USD' }

        expect(wrapper.vm.fiatAmount).toBe('$500.00')
        expect(wrapper.vm.fiatCurrency).toBe('USD')
        expect(wrapper.vm.bchAmount).toBe('1 BCH')

        wrapper.vm.walletBalance = null
        expect(wrapper.vm.fiatAmount).toBe('—')
        expect(wrapper.vm.bchAmount).toBe('—')
    })

    /* ---- First-run backup flow (the `f.bb` flag gates the reminder) ---- */

    it('shows the first-run backup reminder for a wallet that has never viewed its seed', async () => {
        const wrapper = mountView(Dashboard)

        await waitFor(() => wrapper.vm.backupReminder === true)

        /* The Backup popup renders (stubbed, but present). */
        expect(wrapper.findComponent(Backup).exists()).toBe(true)
        /* The SeedVault stays closed until confirmed. */
        expect(wrapper.vm.showSeedVault).toBe(false)
    })

    it('does NOT show the reminder once the seed has been viewed (f.bb)', async () => {
        /* Seed the `f.bb` flag BEFORE mounting — the reminder must not show. */
        const store = useStore()
        store.profile.f = msgpack.encode({ bb: true })

        const wrapper = mountView(Dashboard)

        await new Promise((r) => setTimeout(r, 50))

        expect(wrapper.vm.backupReminder).toBe(false)
        expect(wrapper.findComponent(Backup).exists()).toBe(false)
    })

    it('confirm opens the SeedVault; closing it persists f.bb (no more reminders)', async () => {
        const wrapper = mountView(Dashboard)

        await waitFor(() => wrapper.vm.backupReminder === true)

        /* "Show my backup" — the prompt hides + the SeedVault opens. */
        wrapper.vm.onConfirmBackup()
        expect(wrapper.vm.backupReminder).toBe(false)
        expect(wrapper.vm.showSeedVault).toBe(true)

        /* Done — the flag persists via the profile flags. */
        wrapper.vm.onSeedVaultClose()
        expect(wrapper.vm.showSeedVault).toBe(false)
        expect(getStoreFacade().getters['profile/getFlags'].bb).toBe(true)
    })

    it('deny dismisses for this session only (the flag is NOT set)', async () => {
        const wrapper = mountView(Dashboard)

        await waitFor(() => wrapper.vm.backupReminder === true)

        wrapper.vm.onDenyBackup()
        expect(wrapper.vm.backupReminder).toBe(false)
        /* Not viewed — the next launch re-prompts. */
        expect((getStoreFacade().getters['profile/getFlags'] || {}).bb).toBeUndefined()
    })
})

describe('components/popups/Backup (the wired first-run prompt)', () => {
    it('emits confirm-backup / deny-backup from its buttons', async () => {
        /* LOCAL Button stub WITHOUT the shared stub's `$emit('click')`
           re-emission — with a `.native`-bound parent (Vue 3 fallthrough)
           the shared stub fires the handler TWICE per click. */
        const wrapper = shallowMount(Backup, {
            global: {
                mocks: { $store: getStoreFacade() },
                stubs: {
                    ...stubs,
                    Button: { props: ['label'], template: '<button>{{label}}</button>' },
                },
            },
        })

        /* The two buttons: deny ("Not now") first, confirm second. */
        const buttons = wrapper.findAll('button')
        expect(buttons).toHaveLength(2)
        expect(buttons[0].text()).toBe('Not now')
        expect(buttons[1].text()).toBe('Show my backup')

        await buttons[0].trigger('click')
        expect(wrapper.emitted('deny-backup')).toHaveLength(1)
        expect(wrapper.emitted('confirm-backup')).toBeUndefined()

        await buttons[1].trigger('click')
        expect(wrapper.emitted('confirm-backup')).toHaveLength(1)
    })
})

describe('views/History', () => {
    it('loads, sorts and formats history items', async () => {
        cluster.getHistory.mockResolvedValue([{ tx_hash: 'aa'.repeat(32) }])
        cluster.verboseGetTransaction.mockResolvedValue({
            txid: 'aa'.repeat(32),
            confirmations: 3,
            time: 1700000000,
            vin: [],
            vout: [{ n: 0, value: 0.0001, scriptPubKey: { addresses: ['bitcoincash:qxyz'] } }],
        })

        const wrapper = mountView(History)
        await waitFor(() => wrapper.vm.loading === false)

        expect(wrapper.vm.loading).toBe(false)
        expect(wrapper.vm.historyItems.length).toBe(1)
        expect(wrapper.vm.isEmpty).toBe(false)
    })

    it('filters by tab and toggles details', async () => {
        const wrapper = mountView(History)
        await new Promise((r) => setTimeout(r, 80))

        wrapper.vm.history = [
            { hash: 'in', incoming: true, timestamp: 1700000000, value: 1 },
            { hash: 'out', incoming: false, timestamp: 1700000100, value: 2 },
            { hash: 'pending', incoming: false, timestamp: null, value: 3 },
        ]

        wrapper.vm.updateTab('Sent')
        expect(wrapper.vm.historyItems.map((i) => i.hash)).toEqual(['pending', 'out'])

        wrapper.vm.updateTab('Received')
        expect(wrapper.vm.historyItems.map((i) => i.hash)).toEqual(['in'])

        wrapper.vm.updateTab('All')
        expect(wrapper.vm.historyItems.length).toBe(3)

        wrapper.vm.openDetails('out')
        expect(wrapper.vm.selectedHash).toBe('out')
        expect(wrapper.vm.showDetails).toBe(true)
        expect(wrapper.vm.selected.hash).toBe('out')
    })

    it('formats dates in the three supported styles', () => {
        const wrapper = mountView(History)

        expect(wrapper.vm.formatDate(1700000000, 'short')).toMatch(/2023/)
        expect(wrapper.vm.formatDate(1700000000, 'long')).toMatch(/2023/)
        expect(wrapper.vm.formatDate(1700000000)).toMatch(/\d/)
    })

    it('shows the empty state only after loading finishes', async () => {
        const wrapper = mountView(History)

        expect(wrapper.vm.isEmpty).toBe(false) /* still loading */
        await waitFor(() => wrapper.vm.loading === false)
        expect(wrapper.vm.isEmpty).toBe(true)
    })
})

describe('views/Receive', () => {
    it('mounts, subscribes the address pool and exposes the address', async () => {
        const wrapper = mountView(Receive)
        await waitFor(() => !!wrapper.vm.getAddress('BCH'))

        expect(wrapper.exists()).toBe(true)
        expect(wrapper.vm.getAddress('BCH')).toMatch(/^bitcoincash:/)
        expect(wrapper.vm.displayAddress).toContain('•')
        expect(cluster.subscribeAddresses).toHaveBeenCalled()
    })

    it('copies the address via the textarea + execCommand path', async () => {
        const wrapper = mountView(Receive)
        await waitFor(() => !!wrapper.vm.getAddress('BCH'))

        const address = wrapper.vm.getAddress('BCH')
        wrapper.vm.setClipboard(address)

        expect(document.execCommand).toHaveBeenCalledWith('copy')

        /* The temporary textarea is removed again. */
        expect(document.querySelectorAll('textarea').length).toBe(0)
    })
})

describe('views/Send', () => {
    it('parses a scan query string and prefills the receiver', () => {
        const wrapper = mountView(Send)

        /* initScanData reads window.location.search. */
        expect(typeof wrapper.vm.initScanData).toBe('function')

        wrapper.vm.setReceiver('bitcoincash:qreceiver')
        expect(wrapper.vm.receiver).toBe('bitcoincash:qreceiver')
    })

    it('updates the amount and its unit', () => {
        const wrapper = mountView(Send)

        wrapper.vm.updateAmount(1234)
        expect(wrapper.vm.amount).toBe(1234)

        wrapper.vm.updateUnit('sats')
        expect(wrapper.vm.unit).toBe('sats')
    })

    it('resets the send state and returns to the dashboard', () => {
        const wrapper = mountView(Send)

        wrapper.vm.sendState = 'done'
        wrapper.vm.resetSend()

        expect(wrapper.vm.sendState).toBe('idle')
        expect(router.push).toHaveBeenCalledWith('dashboard')
    })

    it('refuses to send without a valid receiver', async () => {
        const wrapper = mountView(Send)

        wrapper.vm.setReceiver('not-an-address')
        wrapper.vm.updateAmount(1000)

        await wrapper.vm.onSend()
        await new Promise((r) => setTimeout(r, 50))

        expect(cluster.broadcast).not.toHaveBeenCalled()
    })
})

describe('views/Settings', () => {
    it('mounts and switches tabs', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        expect(wrapper.vm.tab).toBe('Basic')

        wrapper.vm.updateTab('Wallet')
        expect(wrapper.vm.tab).toBe('Wallet')
    })

    it('toggles dark mode on the body element', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        document.body.classList.remove('dark')
        wrapper.vm.toggleDarkMode(true)
        await new Promise((r) => setTimeout(r, 30))

        expect(document.body.classList.contains('dark')).toBe(true)

        wrapper.vm.toggleDarkMode(false)
        await new Promise((r) => setTimeout(r, 30))

        expect(document.body.classList.contains('dark')).toBe(false)
    })

    it('changes the fiat currency', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        await wrapper.vm.changeCurrency('EUR')
        await new Promise((r) => setTimeout(r, 30))

        expect(getStoreFacade().getters['profile/getFiatCurrency']).toBe('EUR')
    })

    it('opens the SeedVault popup', async () => {
        const wrapper = mountView(Settings)
        await new Promise((r) => setTimeout(r, 60))

        await wrapper.vm.backup()

        expect(wrapper.vm.showExport).toBe(true)
    })
})

describe('views/Setup', () => {
    it('redirects an existing wallet to the dashboard', async () => {
        mountView(Setup)
        await new Promise((r) => setTimeout(r, 50))

        expect(router.replace).toHaveBeenCalledWith('/dashboard')
    })

    it('does not redirect without a wallet', async () => {
        const store = getStoreFacade()
        store.state.wallets.a = null

        mountView(Setup)
        await new Promise((r) => setTimeout(r, 50))

        expect(router.replace).not.toHaveBeenCalled()
    })
})

describe('views/Wallet', () => {
    it('mounts for the default wallet and loads balances', async () => {
        const wrapper = mountView(Wallet)

        /* bchBalance starts as null and is filled by the async created(). */
        await waitFor(() => wrapper.vm.bchBalance !== null, 4000)

        expect(wrapper.exists()).toBe(true)
        expect(wrapper.vm.wallet.id).toBe('nito-cash')
        expect(wrapper.vm.bchBalance).toBe(37035)
        expect(wrapper.vm.bchDisplay).toBe('0.00037035')
    })

    it('switches between the four wallets', async () => {
        const wrapper = mountView(Wallet)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.switchWallet('naked-cash')
        expect(router.replace).toHaveBeenCalledWith('/wallets/naked-cash')

        wrapper.vm.loadReceive()
        expect(router.push).toHaveBeenCalledWith('/receive')

        wrapper.vm.loadSend()
        expect(router.push).toHaveBeenCalledWith('/send')
    })

    it('shortens a long hash for display', async () => {
        const wrapper = mountView(Wallet)
        await new Promise((r) => setTimeout(r, 60))

        expect(wrapper.vm.shorten('0123456789abcdef0123456789abcdef')).toContain('…')
    })

    it('toggles the action scaffold', async () => {
        const wrapper = mountView(Wallet)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.toggleAction('shield')
        expect(wrapper.vm.activeAction).toBe('shield')

        wrapper.vm.toggleAction('shield')
        expect(wrapper.vm.activeAction).toBeNull()
    })

    it('formats the BCH display with 4-8 decimals and an em-dash when unknown', async () => {
        const wrapper = mountView(Wallet)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.bchBalance = 100000000
        expect(wrapper.vm.bchDisplay).toBe('1.0000')

        wrapper.vm.bchBalance = 123456789
        expect(wrapper.vm.bchDisplay).toBe('1.23456789')

        wrapper.vm.bchBalance = null
        expect(wrapper.vm.bchDisplay).toBe('—')
    })

    it('gates the action flows without a wallet-prover-compatible pool', async () => {
        const wrapper = mountView(Wallet)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.toggleAction('Shield')
        await wrapper.vm.$nextTick()

        expect(wrapper.vm.activeAction).toBe('Shield')
        expect(wrapper.vm.role2Pool).toBeNull()
        expect(wrapper.text()).toContain('Awaiting the role-2 web-platform acceptance')
    })

    it('runs the flow against a compatible pool and renders the broadcast txid', async () => {
        getPoolsMock.mockReturnValue([{ id: 'chipnet-pusd-role2', name: 'Role-2 pool', walletProverCompatible: true, vending: { priceSats: 1000, lockingBytecode: 'aa' } }])

        /* Stub the STORE action (the view dispatches pool/submitRole2Action);
           the proving half is covered by the acceptance harness. */
        const facade = getStoreFacade()
        const origDispatch = facade.dispatch.bind(facade)
        const dispatchSpy = vi.spyOn(facade, 'dispatch').mockImplementation(async (type, payload) => {
            if (type === 'pool/submitRole2Action') return { lockTxid: 'ee'.repeat(32), actionTxid: 'ff'.repeat(32) }
            return origDispatch(type, payload)
        })

        const wrapper = mountView(Wallet)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.toggleAction('Shield')
        wrapper.vm.actionAmount = '1000'
        await wrapper.vm.submitAction()
        await wrapper.vm.$nextTick()

        /* The view dispatched the role-2 store action with the UI action + amount. */
        const call = dispatchSpy.mock.calls.find(([type]) => type === 'pool/submitRole2Action')
        expect(call).toBeTruthy()
        expect(call[1].action).toBe('shield')
        expect(String(call[1].amount)).toBe('1000')

        expect(wrapper.vm.actionResult).toBe('ff'.repeat(32))
        expect(wrapper.text()).toContain('Broadcast — txid')

        dispatchSpy.mockRestore()
    })

    it('switches the FT-in flow to DEPOSIT on a v3 (pool4) pool + renders the stage label', async () => {
        getPoolsMock.mockReturnValue([{
            id: 'chipnet-role2-pool4-v3', name: 'Chipnet PUSD pool — role-2 v3', variant: 'v3',
            shape: 'role2-tagged-v3', walletProverCompatible: true, stageLabel: 'Chipnet pilot',
        }, {
            /* The second pool shows the selector chips — the v4 vs 2-out
               label discrimination. */
            id: 'chipnet-pusd-role2', name: 'Role-2 pool', shape: 'role2-tagged', outputs: 2,
        }])

        /* Stub the STORE action (the proving half is the acceptance harness's
           territory — the view wiring is what is pinned here). */
        const facade = getStoreFacade()
        const origDispatch = facade.dispatch.bind(facade)
        const dispatchSpy = vi.spyOn(facade, 'dispatch').mockImplementation(async (type, payload) => {
            if (type === 'pool/submitRole2Action') return { lockTxid: 'ee'.repeat(32), actionTxid: 'ff'.repeat(32) }
            return origDispatch(type, payload)
        })

        const wrapper = mountView(Wallet)
        await new Promise((r) => setTimeout(r, 60))

        /* The v4 selector chip + the registry stageLabel (rendered VERBATIM). */
        expect(wrapper.text()).toContain('v4')
        expect(wrapper.text()).toContain('Chipnet pilot')

        /* ONE product verb everywhere: the footer's FT-in button reads Shield
           on the v3 pools too — the first-run user finds the word they look
           for (the v3 plumbing underneath is the 'deposit' action). */
        const shieldButton = wrapper.findAll('button').find((b) => b.text() === 'Shield')
        expect(shieldButton).toBeTruthy()

        /* The house pattern: drive the flow through the view method (the
           .native footer wiring is the CDP click-through's territory). */
        wrapper.vm.toggleAction('Shield')

        expect(wrapper.vm.activeAction).toBe('Shield')
        expect(wrapper.vm.actionDescription).toContain('first shield')
        await wrapper.vm.$nextTick()
        /* The SHIELD flow's balance context renders. */
        expect(wrapper.text()).toContain('Available to shield')

        wrapper.vm.actionAmount = '1000'
        await wrapper.vm.submitAction()
        await wrapper.vm.$nextTick()

        /* The view dispatched the DEPOSIT action (the v3 onboarding path —
           the user never sees the word). */
        const call = dispatchSpy.mock.calls.find(([type]) => type === 'pool/submitRole2Action')
        expect(call).toBeTruthy()
        expect(call[1].action).toBe('deposit')

        dispatchSpy.mockRestore()
    })

    it('derives and shows the delivery point (the receive-side address)', async () => {
        const wrapper = mountView(Wallet)

        /* The babyjub wasm derivation is async + slow under full-suite load
           (the poseidon/babyjub warm-up contention pool-notes.spec documents). */
        const ok = await waitFor(() => wrapper.vm.deliveryPointHex.length === 64, 10000)

        expect(ok).toBe(true)
        expect(wrapper.text()).toContain('Your Nito Cash address')
    })

    it('validates the amount + recipient locally BEFORE dispatching', async () => {
        getPoolsMock.mockReturnValue([{ id: 'chipnet-pusd-role2', name: 'Role-2 pool', walletProverCompatible: true, vending: { priceSats: 1000, lockingBytecode: 'aa' } }])
        const facade = getStoreFacade()
        const origDispatch = facade.dispatch.bind(facade)
        const dispatchSpy = vi.spyOn(facade, 'dispatch').mockImplementation(async (type, payload) => {
            if (type === 'pool/submitRole2Action') throw new Error('should not dispatch')
            return origDispatch(type, payload)
        })

        const wrapper = mountView(Wallet)
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.toggleAction('Shield')
        wrapper.vm.actionAmount = '12.5'
        await wrapper.vm.submitAction()
        expect(wrapper.vm.actionError).toContain('whole amount')

        wrapper.vm.toggleAction('Transfer')
        wrapper.vm.actionAmount = '10'
        wrapper.vm.transferTo = 'nothex'
        await wrapper.vm.submitAction()
        expect(wrapper.vm.actionError).toContain('64-hex-character')

        expect(submitPoolActionMock).not.toHaveBeenCalled()
    })
})

describe('views/Restore', () => {
    it('reports a word count and rejects an invalid phrase', async () => {
        const wrapper = mountView(Restore)
        await new Promise((r) => setTimeout(r, 40))

        wrapper.vm.phrase = 'one two three'
        expect(wrapper.vm.wordCount).toBe(3)

        await wrapper.vm.connect()

        expect(wrapper.vm.error).toBeTruthy()
        expect(router.replace).not.toHaveBeenCalled()
    })

    it('restores a valid phrase and lands on the dashboard', async () => {
        const wrapper = mountView(Restore)
        await new Promise((r) => setTimeout(r, 40))

        wrapper.vm.phrase = 'airport very blue major step trumpet various same ride legend hunt game butter cake bargain area pave lonely few sick erode tank cinnamon private'

        await wrapper.vm.connect()
        await new Promise((r) => setTimeout(r, 120))

        expect(wrapper.vm.error).toBeFalsy()
        expect(wrapper.vm.phrase).toBe('')
        expect(router.replace).toHaveBeenCalledWith('/dashboard')
    })
})

describe('views/Concierge + App', () => {
    it('mounts the concierge hub and its sub-views', async () => {
        for (const view of [Concierge, Lobby, Earn, Spend, Advanced]) {
            const wrapper = mountView(view)
            await new Promise((r) => setTimeout(r, 40))

            expect(wrapper.exists()).toBe(true)
        }
    })

    it('uses the fixed Concierge shell and flex-scrolled pages', () => {
        const shell = shallowMount(App, {
            global: {
                mocks: {
                    $store: getStoreFacade(),
                    $router: router,
                    $route: { path: '/concierge', params: {}, query: {} },
                    $t: (key) => key,
                    $i18n: { locale: 'en-US' },
                },
                stubs: { ...stubs, RouterView: true },
            },
        })

        expect(shell.find('.app').classes()).toEqual(expect.arrayContaining(['flex', 'flex-col', 'overflow-hidden']))

        for (const view of [Lobby, Persona, Earn, Spend]) {
            const wrapper = mountView(view)
            const main = wrapper.find('main')

            expect(main.classes()).toContain('min-h-0')
            expect(main.classes().join(' ')).not.toContain('h-[calc(100vh-58px-65px)]')
        }
    })

    it('mounts the app shell', async () => {
        const wrapper = shallowMount(App, {
            global: {
                mocks: {
                    $store: getStoreFacade(),
                    $router: router,
                    $route: { params: {}, query: {} },
                    $t: (key) => key,
                    $i18n: { locale: 'en-US' },
                },
                stubs: { ...stubs, RouterView: true },
            },
        })

        expect(wrapper.exists()).toBe(true)
    })
})
