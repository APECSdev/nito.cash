/* Unit tests for the Concierge Persona desk (views/Concierge/Persona.vue).
 *
 * The Persona tab is a hybrid: the Resolve card is LIVE (ChainGraph), the
 * registration/CashID/Nostr cards are staged. These tests pin the LOCAL
 * surface only — the hero, the resolve input, the pre-confirmation preview,
 * the public-key shortening — with the real Pinia-backed store facade and a
 * mocked Fulcrum cluster (the store's import chain must not open sockets).
 * No test calls the network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/* ---- network mocks (hoisted; same shape as concierge-earn-spend.spec.js) ---- */
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

        /* CashCode RPA scan surface. */
        request: vi.fn(async (method) => (method === 'blockchain.headers.subscribe'
            ? { height: 100 }
            : { rpa: { starting_height: 100 } })),
        rpaGetHistory: vi.fn(async () => []),
        rpaGetMempool: vi.fn(async () => []),
        getTransaction: vi.fn(async () => '00'),
        subscribeHeaders: vi.fn(async () => ({ height: 100 })),
    }

    return { cluster, getClusterMock: vi.fn(async () => cluster) }
})

vi.mock('@/lib/bch/provider.js', () => ({
    getCluster: getClusterMock,
    closeAllClusters: vi.fn(async () => {}),
    ElectrumMethods: { subscribeHeaders: 'blockchain.headers.subscribe' },
    FulcrumCluster: class {},
}))

vi.mock('@/lib/solana.js', () => ({
    SOLANA_RPC: 'https://rpc.test',
    solanaAccountFromEntropy: () => ({ address: 'So1anaAddr', publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }),
    fetchSolBalance: vi.fn(async () => 1.5),
}))

/* Import the store + facade AFTER the mocks. */
import { useStore, getStoreFacade, StoreCompatPlugin, ensureStoreFacade } from '@/store'

import Persona from '@/views/Concierge/Persona.vue'
import { accountFromRegistration } from '@/lib/cashaccount/resolver.js'
import { KALLISTI_TX } from '../fixtures/cashaccount-kallisti.js'

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }

const stubs = {
    Animation: true,
    BlazeBanner: true,
    /* The real Button renders its `label` PROP (not slot content). */
    Button: { props: ['label'], template: '<button @click="$emit(\'click\')">{{ label }}<slot /></button>' },
    Footer: { template: '<footer><slot /></footer>' },
    Header: { template: '<header><slot /></header>' },
    Modal: { template: '<div><slot /></div>' },
    Notification: true,
    Popup: { template: '<div><slot /></div>' },
    Tabs: { template: '<div />' },
    svgicon: true,
}

const mountPersona = (options = {}) => shallowMount(Persona, {
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
       instance — drop it and rebuild for this test. */
    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    ensureStoreFacade(useStore())
})

describe('views/Concierge/Persona — the persona desk rendering', () => {
    it('renders the plaque, the live resolve card and the three staged cards', () => {
        const wrapper = mountPersona()
        const text = wrapper.text()

        expect(text).toContain('The Persona Desk')
        expect(text).toContain('Your name, your keys, your story.')
        expect(text).toContain('Resolve an account')
        expect(text).toContain('Register a name')
        expect(text).toContain('Sign in with a CashAccount')
        expect(text).toContain('Nostr binding')
        expect(text).toContain('ChainGraph')
    })

    it('previews the pre-confirmation identifier and rejects invalid names', async () => {
        const wrapper = mountPersona()
        const inputs = wrapper.findAll('input')

        expect(inputs).toHaveLength(3)

        await inputs[1].setValue('Kallisti')
        expect(wrapper.vm.registerPreview).toBe('Kallisti#FFFF.00')

        await inputs[1].setValue('bad name')
        expect(wrapper.vm.registerPreview).toBe('—')
    })

    it('derives the wallet CashCode and copies it', async () => {
        getStoreFacade().commit('profile/setMasterSeed', 'ab'.repeat(32))

        const writeText = vi.fn(async () => {})
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

        const wrapper = mountPersona()

        expect(wrapper.vm.cashCode).toBeTruthy()
        expect(wrapper.vm.cashCode.encoded.startsWith('cashcode:')).toBe(true)
        expect(wrapper.text()).toContain('CashCode')

        await wrapper.vm.copyCashCode()

        expect(writeText).toHaveBeenCalledWith(wrapper.vm.cashCode.encoded)
        expect(wrapper.vm.cashCodeCopied).toBe(true)
    })

    it('scans the RPA index for CashCode payments', async () => {
        getStoreFacade().commit('profile/setMasterSeed', 'ab'.repeat(32))

        const wrapper = mountPersona()

        await wrapper.vm.scanPayments()

        expect(cluster.rpaGetHistory).toHaveBeenCalled()
        expect(cluster.rpaGetMempool).toHaveBeenCalled()
        expect(wrapper.vm.cashCodeMatches).toEqual([])
        expect(getStoreFacade().state.system.nm).toContain('0 CashCode payment(s) found')
    })

    it('keeps the account card hidden until an account resolves', () => {
        const wrapper = mountPersona()

        expect(wrapper.vm.account).toBeNull()
        expect(wrapper.text()).not.toContain('Resolved ·')
    })

    it('renders the resolved account card from the store', async () => {
        const wrapper = mountPersona()
        const account = accountFromRegistration(KALLISTI_TX)

        getStoreFacade().commit('cashaccount/SET_ACCOUNT', account)
        await wrapper.vm.$nextTick()

        const text = wrapper.text()

        expect(text).toContain('Kallisti#7B9A')
        expect(text).toContain('mutable NFT')
        expect(text).toContain(account.category)
        expect(text).toContain(account.npub)
        expect(text).toContain('https://kalllisti.io')
        expect(text).toContain('Kallisti.cash🍏')
    })

    it('keeps the staged actions local (displayNotification only)', async () => {
        const wrapper = mountPersona()
        const dispatch = vi.spyOn(getStoreFacade(), 'dispatch')

        wrapper.vm.registerName = 'Kallisti'
        wrapper.vm.mockRegister()
        expect(dispatch).toHaveBeenCalledWith('displayNotification', expect.stringContaining('Kallisti#FFFF.00'))

        /* The CashID card is LIVE now: with no resolved account it errors locally. */
        await wrapper.vm.signCashId()
        expect(wrapper.vm.cashIdError).toBe('Resolve a CashAccount first.')

        wrapper.vm.mockNostr()
        expect(dispatch).toHaveBeenCalledWith('displayNotification', expect.stringContaining('kind-0'))
    })

    it('shortens a public key for the card while preserving the full value', () => {
        const wrapper = mountPersona()
        const key = '03cc053f481413acc58895bf8be09eb67b4b4cfb0ace8b7be9f7867c5bce36873d'

        expect(wrapper.vm.shortKey(key)).toBe('03cc053f481413acc5…ce36873d')
    })
})

describe('views/Concierge/Persona — CashID', () => {
    it('rejects an invalid challenge locally', async () => {
        const wrapper = mountPersona()
        wrapper.vm.cashIdChallenge = 'not-a-cashid-uri'
        await wrapper.vm.signCashId()
        expect(wrapper.vm.cashIdError).toBeTruthy()
        expect(wrapper.vm.cashIdResponse).toBeNull()
    })

    it('signs a valid challenge when an account is resolved', async () => {
        const store = useStore()
        store.$patch({ cashaccount: { account: accountFromRegistration(KALLISTI_TX) } })
        store.$patch({ profile: { ms: '11'.repeat(32) } })
        const wrapper = mountPersona()
        wrapper.vm.cashIdChallenge = 'cashid:concierge.nito.cash/cashid?x=102132435465768798a9bacbdcedfe0f'
        await wrapper.vm.signCashId()
        expect(wrapper.vm.cashIdError).toBeNull()
        expect(wrapper.vm.cashIdResponse).toBeTruthy()
        expect(wrapper.vm.cashIdResponse.request).toContain('&d=')
        expect(wrapper.vm.cashIdResponse.signature).toBeTruthy()
        expect(wrapper.vm.cashIdResponse.address).toMatch(/^(bitcoincash|bchtest):/)
    })

    it('copies the response and resets the copied flag', async () => {
        vi.useFakeTimers()
        const wrapper = mountPersona()
        wrapper.vm.cashIdResponse = { request: 'cashid:example/x?d=a:b:0', address: 'bchtest:q', signature: 's' }
        wrapper.vm.copyCashIdResponse()
        expect(wrapper.vm.cashIdCopied).toBe(true)
        vi.advanceTimersByTime(2100)
        expect(wrapper.vm.cashIdCopied).toBe(false)
        vi.useRealTimers()
    })
})

describe('views/Concierge/Persona — CashID clipboard', () => {
    it('writes the response URI to the clipboard when available', async () => {
        const writeText = vi.fn(async () => {})
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
        const wrapper = mountPersona()
        wrapper.vm.cashIdResponse = { request: 'cashid:example/x?d=a:b:0', address: 'bchtest:q', signature: 's' }
        wrapper.vm.copyCashIdResponse()
        expect(writeText).toHaveBeenCalledWith('cashid:example/x?d=a:b:0')
        expect(wrapper.vm.cashIdCopied).toBe(true)
    })

    it('does nothing when there is no response', () => {
        const wrapper = mountPersona()
        wrapper.vm.cashIdResponse = null
        wrapper.vm.copyCashIdResponse()
        expect(wrapper.vm.cashIdCopied).toBe(false)
    })
})

describe('views/Concierge/Persona — registration preview', () => {
    it('renders the 40-byte commitment and the profile OP_RETURN', () => {
        const store = useStore()
        store.$patch({ profile: { ms: '11'.repeat(32) } })
        const wrapper = mountPersona()
        wrapper.vm.registerName = 'Kallisti'
        expect(wrapper.vm.registerCommitment).toBeInstanceOf(Uint8Array)
        expect(wrapper.vm.registerCommitment).toHaveLength(40)
        expect(wrapper.vm.registerCommitmentHex).toMatch(/^0201/)
        expect(wrapper.vm.registerCommitmentSize).toBe(40)
        expect(wrapper.vm.registerProfileHex).toMatch(/^6a/)
    })

    it('returns placeholders without a name or keys', () => {
        const wrapper = mountPersona()
        wrapper.vm.registerName = ''
        expect(wrapper.vm.registerCommitment).toBeNull()
        expect(wrapper.vm.registerCommitmentHex).toBe('—')
        expect(wrapper.vm.registerProfileHex).toBe('—')
    })
})
