/* Integration test for the Persona desk's LIVE resolve path.
 *
 * The ChainGraph resolver is mocked at the module boundary; the real
 * cashaccount store action and the Persona component are exercised together
 * (query → resolve action → account card). No network call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const { resolveAccountMock } = vi.hoisted(() => ({ resolveAccountMock: vi.fn() }))

vi.mock('@/lib/cashaccount/resolver.js', () => ({
    resolveAccount: resolveAccountMock,
}))

/* The store's import chain must not open sockets. */
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
import Persona from '@/views/Concierge/Persona.vue'
import { KALLISTI_CATEGORY } from '../fixtures/cashaccount-kallisti.js'

const ACCOUNT = {
    pending: false,
    name: 'Kallisti',
    identifier: 'Kallisti#7B9A',
    collisionHash: '7b9ae265a98b64cbf5d2b2b6808f8ea7a62d7da5859475dfb424c8dad880fc73',
    identicon: { index: 115, emoji: '🏆', name: 'trophy' },
    color: '#7b9ae2',
    category: KALLISTI_CATEGORY,
    network: 'mainnet',
    networkByte: 1,
    prefix: 8,
    scanPubkey: '02456219ccdc6500d7a681191c7aa4dfcc9937d0e24a6943e828dcccb838bcb2be',
    spendPubkey: '03cc053f481413acc58895bf8be09eb67b4b4cfb0ace8b7be9f7867c5bce36873d',
    nostrPubkey: 'd8ca572c9f84a1b3c67a4cb9ffd0d8c29aea311430f1e87bd615c9cf48cad7be',
    npub: 'npub1example',
    commitment: { version: 2, expiry: 0 },
    profile: {
        name: 'Kallisti',
        displayName: 'Kallisti.cash🍏',
        bio: null,
        urls: ['https://kalllisti.io'],
        avatar: null,
    },
    identityScript: '2103cc05',
    txid: '8267bff0bf6532bfd109ecae1062deb88822166333de5ece52d4309371a42878',
    vout: 0,
    valueSatoshis: 1389,
    block: {
        height: 978459,
        hash: '00000000000000000066a3b894ab1054f896c6554c15bde0ef8215597b88ec8d',
        transactionIndex: 41,
    },
    transactionIndex: 41,
}

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() }

const stubs = {
    Button: { props: ['label'], template: '<button @click="$emit(\'click\')">{{ label }}<slot /></button>' },
    Header: { template: '<header><slot /></header>' },
    Notification: true,
    Tabs: { template: '<div />' },
}

const mountPersona = () => shallowMount(Persona, {
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

beforeEach(() => {
    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    ensureStoreFacade(useStore())

    resolveAccountMock.mockReset()
    resolveAccountMock.mockResolvedValue(ACCOUNT)
})

describe('views/Concierge/Persona — live resolve wiring', () => {
    it('resolves the query through the store and renders the account card', async () => {
        const wrapper = mountPersona()

        wrapper.vm.query = 'Kallisti#7B9A'
        await wrapper.vm.onResolve()
        await wrapper.vm.$nextTick()

        expect(resolveAccountMock).toHaveBeenCalledWith({ identifier: 'Kallisti#7B9A' })
        expect(getStoreFacade().state.cashaccount.status).toBe('ready')

        const text = wrapper.text()
        expect(text).toContain('Kallisti#7B9A')
        expect(text).toContain('Kallisti.cash🍏')
        expect(text).toContain(ACCOUNT.category)
        expect(text).toContain(ACCOUNT.npub)
        expect(text).toContain('https://kalllisti.io')
    })

    it('loads the live Kallisti example by txid', async () => {
        const wrapper = mountPersona()

        await wrapper.vm.loadExample()
        await wrapper.vm.$nextTick()

        expect(resolveAccountMock).toHaveBeenCalledWith({
            identifier: '8267bff0bf6532bfd109ecae1062deb88822166333de5ece52d4309371a42878',
        })
        expect(wrapper.vm.query).toBe('8267bff0bf6532bfd109ecae1062deb88822166333de5ece52d4309371a42878')
    })

    it('surfaces the resolver error in the card region', async () => {
        resolveAccountMock.mockRejectedValueOnce(new Error('ChainGraph down'))

        const wrapper = mountPersona()
        wrapper.vm.query = 'Kallisti#FFFF'

        await wrapper.vm.onResolve()
        await wrapper.vm.$nextTick()

        expect(getStoreFacade().state.cashaccount.status).toBe('error')
        expect(wrapper.text()).toContain('ChainGraph down')
    })
})
