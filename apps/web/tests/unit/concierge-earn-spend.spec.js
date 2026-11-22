/* Unit tests for the Concierge Earn + Spend mockup wings
 * (views/Concierge/Earn.vue + views/Concierge/Spend.vue).
 *
 * Both screens are MOCKUPS around preserved features: every test below pins
 * LOCAL behaviour — the rendered research transcription, the dossier
 * toggles, the tone mappings, the preserved interest counter (Earn) and the
 * REAL paste-flow (Spend: parse -> popup -> accept -> Send prefilled).
 * Nothing may contact a relay, coordinator or chain.
 *
 * Conventions follow concierge-desk.spec.js: the REAL Pinia-backed store
 * facade (notification toasts go through the real system action) and a
 * MOCKED Fulcrum cluster (the store's import chain must not open sockets).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/* ---- network mocks (hoisted; same shape as views.spec.js) ---- */
const { cluster, getClusterMock } = vi.hoisted(() => {
    const cluster = {
        getBalance: vi.fn(async () => ({ confirmed: 12345, unconfirmed: 0 })),
        getHistory: vi.fn(async () => []),
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

/* Import the store + facade AFTER the mocks. */
import { useStore, getStoreFacade, StoreCompatPlugin, ensureStoreFacade } from '@/store'

import Earn from '@/views/Concierge/Earn.vue'
import Spend from '@/views/Concierge/Spend.vue'

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }

const stubs = {
    Animation: true,
    BlazeBanner: true,
    /* NOTE: the real Button renders its `label` PROP (not slot content),
       so the stub must declare + render it or button text never appears. */
    Button: { props: ['label'], template: '<button @click="$emit(\'click\')">{{ label }}<slot /></button>' },
    /* The Concierge popup renders its confirmation slot (so the paste-flow
       assertions can see the parsed outputs). */
    Concierge: { template: '<div><slot /></div>' },
    Footer: { template: '<footer><slot /></footer>' },
    Header: { template: '<header><slot /></header>' },
    Modal: { template: '<div><slot /></div>' },
    Notification: true,
    Popup: { template: '<div><slot /></div>' },
    Tabs: { template: '<div />' },
    svgicon: true,
}

const mountView = (view, options = {}) => shallowMount(view, {
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
       instance (see views.spec.js) — drop it and rebuild for this test. */
    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    ensureStoreFacade(useStore())

    router.push.mockClear()
})

describe('views/Concierge/Earn — the vault desk rendering', () => {
    it('renders the plaque, the ribbon and both suites (01a + 05)', () => {
        const wrapper = mountView(Earn)

        const text = wrapper.text()

        /* The plaque. */
        expect(text).toContain('The Vault Desk')
        expect(text).toContain('Park value where the chain')

        /* The mockup ribbon. */
        expect(text).toContain('Mockup')
        expect(text).toContain('Vault desk · by appointment')

        /* Suite 01a — the shielded pool. */
        expect(text).toContain('The Shielded Pool')
        expect(text).toContain('Chipnet · mainnet demo')
        expect(text).toContain('183,472 constraints · 107 private inputs · 2 public inputs')

        /* Suite 05 — the ceremony gate. */
        expect(text).toContain('The Hush Ceremony')
        expect(text).toContain('In design')
        expect(text).toContain('Perpetual Powers-of-Tau')

        /* Door chips. */
        expect(wrapper.vm.services[0].suite).toBe('01a')
        expect(wrapper.vm.services[1].suite).toBe('05')

        /* The preserved teller actions. */
        expect(text).toContain('Add Funds')
        expect(text).toContain('Withdraw Funds')
        expect(wrapper.vm.isInvested).toBe(false)
    })

    it('transcribes the measured research record into the data model', () => {
        const wrapper = mountView(Earn)
        const vm = wrapper.vm

        /* Three lifecycle steps, all confirmed on chipnet. */
        expect(vm.itinerary).toHaveLength(3)
        expect(vm.itinerary.map((s) => s.name)).toEqual(['Shield', 'Transfer', 'Unshield'])
        expect(vm.itinerary.every((s) => s.state === 'Confirmed')).toBe(true)

        /* The measured pool numbers. */
        const register = vm.register.map((r) => r.v).join(' ')
        expect(register).toContain('183,472 constraints')
        expect(register).toContain('35,626 B inside one standard transaction')
        expect(register).toContain('26/26 attack runs rejected')
        expect(register).toContain('16.967 s')
        expect(register).toContain('~36.8 – 37.8 KB')

        /* The boundary list keeps the honest gaps. */
        const boundaries = vm.boundaries.join(' ')
        expect(boundaries).toContain('solo 1-of-1 ceremony')
        expect(boundaries).toContain('No audits yet')
        expect(boundaries).toContain('per-category conservation is enforced in-circuit')
    })

    it('toggles the house-rules panel', async () => {
        const wrapper = mountView(Earn)

        expect(wrapper.text()).not.toContain('no bank backs it')

        await (wrapper.vm.houseRules = true)

        expect(wrapper.text()).toContain('no bank backs it')
    })

    it('toggles the vault ledger open and closed', async () => {
        const wrapper = mountView(Earn)

        expect(wrapper.text()).not.toContain('The vault itinerary')

        wrapper.vm.toggleLedger()
        await wrapper.vm.$nextTick()

        expect(wrapper.vm.openLedger).toBe('pool')
        expect(wrapper.text()).toContain('The vault itinerary')
        expect(wrapper.text()).toContain('DO NOT DISTURB')
        expect(wrapper.text()).toContain('In this wallet')

        wrapper.vm.toggleLedger()
        await wrapper.vm.$nextTick()

        expect(wrapper.vm.openLedger).toBe(null)
        expect(wrapper.text()).not.toContain('DO NOT DISTURB')
    })

    it('books a deposit box through the real system notification action', () => {
        const wrapper = mountView(Earn)

        wrapper.vm.bookBox()

        expect(getStoreFacade().state.system.nm)
            .toBe('Vault desk · your deposit box is a mockup — nothing was deposited. (No relay, no chain.)')
    })

    it('opens the ceremony page (topic 05)', () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => {})

        const wrapper = mountView(Earn)

        wrapper.vm.openCeremony()

        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith('https://hushyourmoney.com/ceremony', '_blank', 'noopener,noreferrer')

        open.mockRestore()
    })

    it('maps tones to literal Tailwind class pairs', () => {
        const wrapper = mountView(Earn)

        expect(wrapper.vm.toneClass('gold')).toBe('bg-secondary text-secondary-fg')
        expect(wrapper.vm.toneClass('primary')).toBe('bg-primary text-primary-fg')
        expect(wrapper.vm.toneClass('muted')).toBe('bg-tab-bg text-fg-muted')
        expect(wrapper.vm.toneClass('anything-else')).toBe('bg-tab-bg text-fg-muted')
    })

    it('keeps the teller buttons wired: log first, then a mockup toast', () => {
        const wrapper = mountView(Earn)
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})

        wrapper.vm.addFunds()

        expect(log).toHaveBeenCalledWith('ADDING FUNDS')
        expect(getStoreFacade().state.system.nm).toContain('no funds were added')

        wrapper.vm.withdrawFunds()

        expect(log).toHaveBeenCalledWith('WITHDRAWING FUNDS')
        expect(getStoreFacade().state.system.nm).toContain('holds nothing of yours yet')

        log.mockRestore()
    })
})

describe('views/Concierge/Earn — the house counter (preserved timer)', () => {
    beforeEach(() => {
        /* The counter ticks a 100ms setInterval; fake timers keep the
           (preserved) session-20 leak fix observable and the test fast. */
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('ticks the display counter while mounted and stops it on unmount', async () => {
        const wrapper = mountView(Earn)
        const vm = wrapper.vm

        /* Resting state. */
        expect(vm.interestIncrement).toBe(0)
        expect(vm.interestCore).toBe(12.54)

        const before = vm.interestRunning

        /* Three ticks at 100ms each. */
        await vi.advanceTimersByTimeAsync(300)
        expect(vm.interestIncrement).toBe(3)
        expect(vm.interestRunning - before).toBe(3)

        /* The user leaves the vault — the interval must be cleared. */
        wrapper.unmount()

        await vi.advanceTimersByTimeAsync(1000)

        expect(vm.interestIncrement).toBe(3)
    })
})

describe('views/Concierge/Spend — the courier desk rendering', () => {
    it('renders the plaque, the paste-drop and both suites (03 + 04)', () => {
        const wrapper = mountView(Spend)

        const text = wrapper.text()

        /* The plaque + ribbon. */
        expect(text).toContain('The Courier Desk')
        expect(text).toContain('Pay without leaving a forwarding address')
        expect(text).toContain('Courier desk · same-day delivery')

        /* The REAL paste-drop (preserved feature). */
        expect(text).toContain('Payment Processor')
        expect(text).toContain('paste it in the form field below')
        expect(wrapper.find('textarea').exists()).toBe(true)

        /* Suite 03 — shielded addresses (external survey). */
        expect(text).toContain('Shielded Addresses')
        expect(text).toContain('External survey')
        expect(text).toContain('P_stealth = B + c·G')

        /* Suite 04 — CoinJoin. */
        expect(text).toContain('CoinJoin')
        expect(text).toContain('Live on BCH')
        expect(text).toContain('Live today through CashFusion')

        /* Door chips. */
        expect(wrapper.vm.services[0].suite).toBe('03')
        expect(wrapper.vm.services[1].suite).toBe('04')

        /* The preserved actions. */
        expect(text).toContain('Shopping')
        expect(text).toContain('Giving')
        expect(text).toContain('Advanced Spending')
        expect(wrapper.vm.hasFunds).toBe(true)
    })

    it('transcribes the survey into the data model', () => {
        const wrapper = mountView(Spend)
        const vm = wrapper.vm

        /* The scheme facts (cited topic 1773). */
        const scheme = vm.scheme.map((r) => r.v).join(' ')
        expect(scheme).toContain("m/44'/145'/0'/2'/0 → scan (a, A)")
        expect(scheme).toContain('c = SHA256( SHA256(ECDH_x) ‖ outpoint )')

        /* The boundary list keeps the honest gaps. */
        const boundaries = vm.boundaries.join(' ')
        expect(boundaries).toContain('Not our implementation')
        expect(boundaries).toContain('design direction, not built yet')
    })

    it('toggles the stealth dossier open and closed', async () => {
        const wrapper = mountView(Spend)

        expect(wrapper.text()).not.toContain('The scheme, as implemented')

        wrapper.vm.toggleDossier()
        await wrapper.vm.$nextTick()

        expect(wrapper.vm.openDossier).toBe('stealth')
        expect(wrapper.text()).toContain('The scheme, as implemented')
        expect(wrapper.text()).toContain('DO NOT DISTURB')
        expect(wrapper.text()).toContain('Where it meets the pool')

        wrapper.vm.toggleDossier()
        await wrapper.vm.$nextTick()

        expect(wrapper.vm.openDossier).toBe(null)
        expect(wrapper.text()).not.toContain('DO NOT DISTURB')
    })

    it('opens the CoinJoin survey (topic 04)', () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => {})

        const wrapper = mountView(Spend)

        wrapper.vm.openCoinjoin()

        expect(open).toHaveBeenCalledTimes(1)
        expect(open).toHaveBeenCalledWith('https://hushyourmoney.com/research/coinjoin', '_blank', 'noopener,noreferrer')

        open.mockRestore()
    })

    it('rings the courier through the real system notification action', () => {
        const wrapper = mountView(Spend)

        wrapper.vm.ringCourier()

        expect(getStoreFacade().state.system.nm)
            .toBe('Courier desk · a mock courier will be with you shortly. (Nothing was sent.)')
    })

    it('keeps the courier buttons wired: log first, then a mockup toast', () => {
        const wrapper = mountView(Spend)
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})

        wrapper.vm.shopping()

        expect(log).toHaveBeenCalledWith('SHOPPING')
        expect(getStoreFacade().state.system.nm).toContain('no shopping run was arranged')

        wrapper.vm.giving()

        expect(log).toHaveBeenCalledWith('GIVING')
        expect(getStoreFacade().state.system.nm).toContain('no donation was arranged')

        wrapper.vm.loadAdvancedSpending()

        expect(router.push).toHaveBeenCalledWith('concierge/spend/advanced')

        log.mockRestore()
    })
})

describe('views/Concierge/Spend — the paste flow (preserved, REAL)', () => {
    it('parses a pasted note, confirms in the popup and prefills Send on accept', async () => {
        const wrapper = mountView(Spend)

        /* The empty popup branch renders while nothing is parsed. */
        expect(wrapper.text()).toContain('No payment details could be parsed from the pasted data.')

        /* A base64 JSON payload in the (null-padded) concierge wire format. */
        const payload = { outputs: [{ value: 1000, address: 'bitcoincash:qconcierge' }], data: 'x', donation: 0, expires: 0 }
        const raw = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.alloc(4)])
        const b64 = raw.toString('base64')

        wrapper.vm.note = b64
        wrapper.vm.handlePastedNote()
        await new Promise((r) => setTimeout(r, 60))

        /* The parsed note is kept and the popup shows the outputs. */
        expect(wrapper.vm.parsedNote.outputs[0].address).toBe('bitcoincash:qconcierge')
        expect(wrapper.vm.showConcierge).toBe(true)
        expect(wrapper.text()).toContain('Accept the recommendation?')
        expect(wrapper.text()).toContain('bitcoincash:qconcierge')

        wrapper.vm.acceptNote()

        expect(router.push).toHaveBeenCalledWith({ path: 'send', query: { to: 'bitcoincash:qconcierge' } })
    })

    it('reports an unparseable paste through the error action', async () => {
        const wrapper = mountView(Spend)

        wrapper.vm.note = 'not-a-payment-note'
        wrapper.vm.handlePastedNote()
        await new Promise((r) => setTimeout(r, 60))

        expect(wrapper.vm.showConcierge).toBe(false)
        expect(getStoreFacade().state.system.em)
            .toBe('Could not parse the pasted payment details.')
    })

    it('accepts nothing when the note carries no payment address', async () => {
        const wrapper = mountView(Spend)

        wrapper.vm.parsedNote = { outputs: [{}] }
        wrapper.vm.acceptNote()

        /* No navigation happens without a payment address. */
        expect(router.push).not.toHaveBeenCalled()
        expect(getStoreFacade().state.system.em)
            .toBe('No payment address in the pasted details.')
    })
})
