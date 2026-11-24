/* Unit tests for the Concierge Desk (views/Concierge/Lobby.vue + hub tab).
 *
 * The desk is a MOCKUP: every test below pins its LOCAL behaviour — the
 * rendered research transcription, the in-place service swap, the tone/state
 * mappings, and the timed demo round (asking -> seating -> phases ->
 * settled -> reset). Nothing may contact a relay, coordinator or chain.
 *
 * Conventions follow views.spec.js: the REAL Pinia-backed store facade
 * (notification toasts go through the real system action) and a MOCKED
 * Fulcrum cluster (the store's import chain must not open sockets).
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

import Concierge from '@/views/Concierge.vue'
import Lobby from '@/views/Concierge/Lobby.vue'
import Quantumroot from '@/views/Concierge/Desk/Quantumroot.vue'

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }

const stubs = {
    Animation: true,
    BlazeBanner: true,
    /* NOTE: the real Button renders its `label` PROP (not slot content),
       so the stub must declare + render it or button text never appears. */
    Button: { props: ['label'], template: '<button @click="$emit(\'click\')">{{ label }}<slot /></button>' },
    Footer: { template: '<footer><slot /></footer>' },
    Header: { template: '<header><slot /></header>' },
    Modal: { template: '<div><slot /></div>' },
    Notification: true,
    Popup: { template: '<div><slot /></div>' },
    Persona: { template: '<div class="persona-stub" />' },
    Tabs: { template: '<div />' },
    svgicon: true,
}

const mountDesk = (options = {}) => shallowMount(Lobby, {
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

const openCashfusion = async (wrapper) => {
    const door = wrapper.findAll('article').find((d) => d.text().includes('CashFusion'))

    await door.trigger('click')
}

beforeEach(() => {
    /* The facade is cached on globalThis and is NOT rebuilt for a new Pinia
       instance (see views.spec.js) — drop it and rebuild for this test. */
    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    ensureStoreFacade(useStore())
})

describe('views/Concierge — the Desk tab', () => {
    it('defaults the hub to the hotel-style Desk tab', () => {
        const wrapper = shallowMount(Concierge, {
            global: {
                mocks: {
                    $store: getStoreFacade(),
                    $router: router,
                    $route: { params: {}, query: {} },
                    $t: (key) => key,
                },
                stubs,
            },
        })

        expect(wrapper.vm.tab).toBe('Desk')
        expect(wrapper.vm.tabs).toEqual(['Desk', 'Persona', 'Earn', 'Spend'])
    })

    it('renders the Persona tab when selected', async () => {
        const wrapper = shallowMount(Concierge, {
            global: {
                mocks: {
                    $store: getStoreFacade(),
                    $router: router,
                    $route: { params: {}, query: {} },
                    $t: (key) => key,
                },
                stubs,
            },
        })

        expect(wrapper.find('.persona-stub').exists()).toBe(false)

        wrapper.vm.tab = 'Persona'
        await wrapper.vm.$nextTick()

        expect(wrapper.find('.persona-stub').exists()).toBe(true)
    })
})

describe('views/Concierge/Lobby — the desk rendering', () => {
    it('renders the Guest Services landing with the two side-by-side doors', () => {
        const wrapper = mountDesk()

        const text = wrapper.text()

        /* The plaque. */
        expect(text).toContain('The Concierge Desk')
        expect(text).toContain('Guest services.')
        expect(text).toContain('Two quiet ways to move.')

        /* The mockup ribbon. */
        expect(text).toContain('Mockup')
        expect(text).toContain('Guest services · open 24h')

        /* Door 01 — Quantumroot (the new orchestration). */
        expect(text).toContain('Quantumroot')
        expect(text).toContain('New orchestration')
        expect(text).toContain('256-bit classical · 128-bit quantum (Grover)')
        expect(text).toContain('LM-OTS (RFC 8554) · 2,144 B · ~2.5 KB unlock')

        /* Door 02 — CashFusion, Nostr only (no classic pool). */
        expect(text).toContain('CashFusion')
        expect(text).toContain('Nostr only')
        expect(text).toContain('NIP-59 gift wrap (kind 1059) + NIP-44 v2')
        expect(text).toContain('None — no existing CashFusion pool')

        /* The classic 02a card + its survey link are gone. */
        expect(text).not.toContain('Classic coinjoin, arranged by an outside coordinator.')
        expect(text).not.toContain('Read the survey')
        expect(text).not.toContain('External server, trusted for round integrity')
        expect(text).not.toContain('Shielded Pool')

        /* The two doors share one grid, side by side on desktop. */
        expect(wrapper.vm.services.map((s) => s.id)).toEqual(['quantumroot', 'cashfusion'])
        expect(wrapper.vm.services.map((s) => s.suite)).toEqual(['01', '02'])

        const doors = wrapper.findAll('article')
        expect(doors).toHaveLength(2)
        expect(doors[0].element.parentElement.className).toContain('md:grid-cols-2')

        /* The original bell-service actions are preserved. */
        expect(text).toContain("Open Chat")
        expect(text).toContain("Today's Deals")
        expect(wrapper.vm.hasPrivilege).toBe(false)
    })

    it('transcribes the measured research record into the data model', () => {
        const wrapper = mountDesk()
        const vm = wrapper.vm

        /* Six phases; Announce is design-only, the rest implemented. */
        expect(vm.itinerary).toHaveLength(6)
        expect(vm.itinerary[0].name).toBe('Announce')
        expect(vm.itinerary[0].state).toBe('Design')
        expect(vm.itinerary.slice(1).every((p) => p.state === 'Implemented')).toBe(true)

        /* The measured G3/G2b numbers. */
        const register = vm.register.map((r) => r.v).join(' ')
        expect(register).toContain('1,760 B')
        expect(register).toContain('5,000 sats')
        expect(register).toContain('10/10 signatures verified')
        expect(register).toContain('428 B')
        expect(register).toContain('4.7 sat/B')

        /* The boundary list keeps the honest gaps. */
        expect(vm.boundaries.join(' ')).toContain('NIP-42 AUTH is not implemented')
        expect(vm.boundaries.join(' ')).toContain('G4 — a mainnet opt-in beta behind a settings flag — is not built')

        /* Five peers — the design floor. */
        expect(vm.roundPeerTags).toHaveLength(5)
    })

    it('toggles the house-rules panel', async () => {
        const wrapper = mountDesk()

        expect(wrapper.find('section').exists()).toBe(true)
        expect(wrapper.text()).not.toContain('The front desk never asks for a seed phrase')

        await (wrapper.vm.houseRules = true)

        expect(wrapper.text()).toContain('The front desk never asks for a seed phrase')
    })

    it('opens the CashFusion service in place and returns to Guest services', async () => {
        const wrapper = mountDesk()

        expect(wrapper.text()).not.toContain('no server to bribe')
        expect(wrapper.vm.activeService).toBe(null)

        /* Click the CashFusion door. */
        await openCashfusion(wrapper)

        expect(wrapper.vm.activeService).toBe('cashfusion')
        expect(wrapper.text()).toContain('Nostr only')
        expect(wrapper.text()).toContain('no server to bribe')
        expect(wrapper.text()).toContain('DO NOT DISTURB')
        expect(wrapper.text()).toContain('Tonight’s itinerary')

        /* The back control returns to the landing. */
        const back = wrapper.findAll('button').find((button) => button.text().includes('← Guest services'))
        await back.trigger('click')

        expect(wrapper.vm.activeService).toBe(null)
        expect(wrapper.text()).toContain('Two quiet ways to move.')
        expect(wrapper.text()).not.toContain('DO NOT DISTURB')
    })

    it('rings the bell through the real system notification action', () => {
        const wrapper = mountDesk()

        wrapper.vm.ring()

        expect(getStoreFacade().state.system.nm)
            .toBe('Front desk · a mock concierge will be with you shortly. (Nothing was sent.)')
    })

    it('opens the Quantumroot service in place', async () => {
        const wrapper = mountDesk()

        const door = wrapper.findAll('article').find((d) => d.text().includes('Quantumroot'))
        await door.trigger('click')

        expect(wrapper.vm.activeService).toBe('quantumroot')
        expect(wrapper.findComponent(Quantumroot).exists()).toBe(true)
        expect(wrapper.text()).not.toContain('Two quiet ways to move.')
    })
})

describe('views/Concierge/Lobby — tone + state mappings', () => {
    it('maps tones to literal Tailwind class pairs', () => {
        const wrapper = mountDesk()

        expect(wrapper.vm.toneClass('gold')).toBe('bg-secondary text-secondary-fg')
        expect(wrapper.vm.toneClass('primary')).toBe('bg-primary text-primary-fg')
        expect(wrapper.vm.toneClass('muted')).toBe('bg-tab-bg text-fg-muted')
        expect(wrapper.vm.toneClass('anything-else')).toBe('bg-tab-bg text-fg-muted')
    })

    it('maps the phase cursor to Done / In session / Queued', () => {
        const wrapper = mountDesk()
        const vm = wrapper.vm

        vm.roundPhase = 2

        expect(vm.phaseTone(0)).toBe('gold')
        expect(vm.phaseTone(2)).toBe('primary')
        expect(vm.phaseTone(3)).toBe('muted')

        expect(vm.phaseState(0)).toBe('Done')
        expect(vm.phaseState(2)).toBe('In session')
        expect(vm.phaseState(3)).toBe('Queued')
    })

    it('flips the request button label once the demo round settles', () => {
        const wrapper = mountDesk()
        const vm = wrapper.vm

        expect(vm.requestLabel).toBe('Request a round')

        vm.requestState = 'done'

        expect(vm.requestLabel).toBe('Reset the demo')
    })
})

describe('views/Concierge/Lobby — the demo round (timers)', () => {
    beforeEach(() => {
        /* The demo round is timer-driven (900ms ask / 400ms per peer /
           1300ms per phase); fake timers keep it deterministic and fast. */
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('seats five peers, runs the six phases and settles with the G3 numbers', async () => {
        const wrapper = mountDesk()
        await openCashfusion(wrapper)
        const vm = wrapper.vm

        /* Resting state. */
        expect(vm.requestState).toBe(null)
        expect(vm.roundPeers).toBe(0)
        expect(vm.roundPhase).toBe(-1)

        vm.requestRound()

        /* The desk is "asking" — the table is not open yet. */
        expect(vm.requestState).toBe('asking')
        expect(vm.roundPeers).toBe(0)

        await vi.advanceTimersByTimeAsync(900)

        /* Table open; seating begins (the seating toast fires). */
        expect(vm.requestState).toBe('round')
        expect(getStoreFacade().state.system.nm).toContain('seating a table of five')

        /* Peers seat one at a time (400ms each). */
        await vi.advanceTimersByTimeAsync(400)
        expect(vm.roundPeers).toBe(1)

        await vi.advanceTimersByTimeAsync(400 * 4)
        expect(vm.roundPeers).toBe(5)

        /* Phases advance one per 1300ms: 0..5, then done at 6. */
        await vi.advanceTimersByTimeAsync(1300)
        expect(vm.roundPhase).toBe(0)
        expect(vm.phaseState(0)).toBe('In session')

        await vi.advanceTimersByTimeAsync(1300 * 6)

        expect(vm.requestState).toBe('done')
        expect(vm.roundPhase).toBe(6)
        expect(vm.phaseState(5)).toBe('Done')

        /* The settled card carries the measured G3 numbers. */
        expect(wrapper.text()).toContain('ROUND SETTLED')
        expect(wrapper.text()).toContain('1,760 B')
        expect(wrapper.text()).toContain('5,000 sats')
        expect(wrapper.text()).toContain('10/10 verified')

        /* The settled toast lands through the real action. */
        expect(getStoreFacade().state.system.nm).toContain('nothing was signed or broadcast')
    })

    it('ignores re-taps while asking or in session (no duplicate timers)', async () => {
        const wrapper = mountDesk()
        await openCashfusion(wrapper)
        const vm = wrapper.vm

        vm.requestRound()
        vm.requestRound()

        expect(vm.requestState).toBe('asking')

        await vi.advanceTimersByTimeAsync(900)

        vm.requestRound()

        expect(vm.requestState).toBe('round')

        /* A single seating pass — the duplicate taps added no extra timers. */
        await vi.advanceTimersByTimeAsync(400 * 5)
        expect(vm.roundPeers).toBe(5)
    })

    it('resets a settled table from the same button', async () => {
        const wrapper = mountDesk()
        await openCashfusion(wrapper)
        const vm = wrapper.vm

        vm.requestRound()
        await vi.advanceTimersByTimeAsync(900)
        await vi.advanceTimersByTimeAsync(400 * 5)

        /* NOTE: roundPhase starts at -1, so settling needs SEVEN phase
           ticks (-1 -> 6), not six. */
        await vi.advanceTimersByTimeAsync(1300 * 7)

        expect(vm.requestState).toBe('done')

        /* The same button resets the demo. */
        vm.requestRound()

        expect(vm.requestState).toBe(null)
        expect(vm.roundPeers).toBe(0)
        expect(vm.roundPhase).toBe(-1)

        /* The round table is gone. */
        await vm.$nextTick()
        expect(wrapper.text()).not.toContain('ROUND SETTLED')
    })

    it('clears every demo timer on unmount (no settle after the view is gone)', async () => {
        const wrapper = mountDesk()
        await openCashfusion(wrapper)
        const vm = wrapper.vm

        vm.requestRound()

        /* Table opens at t=900 (seating toast set, auto-dismiss @ t=5900);
           one peer seats at t=1300. */
        await vi.advanceTimersByTimeAsync(900 + 400)
        expect(getStoreFacade().state.system.nm).toContain('seating a table of five')
        expect(vm.roundPeers).toBe(1)

        /* Part-way through seating, the user leaves the desk. */
        wrapper.unmount()

        /* Advance to EXACTLY the settle moment (t=12000: 900 ask + 2000
           seating + 7×1300 phases). If any component timer survived the
           unmount, the settled toast would fire HERE — but its own 5s
           auto-dismiss has NOT yet elapsed, so the leak is observable:
             timers cleared  -> nm === null  (seating toast dismissed @5900)
             timers leaked   -> nm === the settled toast
           Advancing past 17000 instead would hide the leak (the settled
           toast would be dismissed too), so the landing time matters. */
        await vi.advanceTimersByTimeAsync(12000 - 1300)

        expect(vm.requestState).toBe('round')
        expect(vm.roundPeers).toBe(1)
        expect(vm.roundPhase).toBe(-1)
        expect(getStoreFacade().state.system.nm).toBe(null)
    })
})
