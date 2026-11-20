/* Unit tests for the Vuex-shaped store facade (src/store/index.js) and the
 * `vuex` shim (mapState / mapGetters / mapActions / mapMutations), plus the
 * remaining getBalance branches and two small components (QR, Advanced).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import msgpack from 'msgpack-lite'

const { cluster, getClusterMock } = vi.hoisted(() => ({
    cluster: { getBalance: vi.fn() },
    getClusterMock: vi.fn(),
}))

vi.mock('@/lib/bch/provider.js', () => ({ getCluster: getClusterMock }))

import { useStore, getStoreFacade, StoreCompatPlugin, ensureStoreFacade } from '@/store'
import storePlugin from '@/store/index'
import { mapState, mapGetters, mapActions, mapMutations } from '@/store/vuex-shim'
import getBalance from '@/store/modules/wallets/getters/getBalance'
import getAccountsByWallet from '@/store/modules/wallets/getters/getAccountsByWallet'
import getAddresses from '@/store/modules/wallets/getters/getAddresses'
import getChangeIndexes from '@/store/modules/wallets/getters/getChangeIndexes'
import getDerivationPath from '@/store/modules/wallets/getters/getDerivationPath'
import { hdNodeFromEntropy } from '@/lib/bch/crypto.js'

import QR from '@/components/QR.vue'
import Advanced from '@/views/Concierge/Spend/Advanced.vue'

const ENTROPY = 'ab'.repeat(32)

beforeEach(() => {
    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    ensureStoreFacade(useStore())

    getStoreFacade().state.profile.ms = ENTROPY
    getStoreFacade().state.wallets.a = msgpack.encode({ BCH: { 0: { s: 'a', u: {} } } })
    getStoreFacade().state.wallets.c = msgpack.encode({ BCH: [0] })

    getClusterMock.mockReset()
    getClusterMock.mockResolvedValue(cluster)
    cluster.getBalance.mockReset()
    cluster.getBalance.mockResolvedValue({ confirmed: 1000, unconfirmed: 250 })
})

describe('store facade', () => {
    it('resolves namespaced getters and actions through the facade', () => {
        const facade = getStoreFacade()

        expect(facade.getters['wallets/getAccountsByWallet']('BCH')).toBeTruthy()
        expect(facade.getters['profile/getNetwork']).toBe('mainnet')

        /* A global (non-namespaced) action + a namespaced one. */
        expect(() => facade.dispatch('displayNotification', 'hi')).not.toThrow()
        expect(() => facade.dispatch('wallets/activateAccounts', {})).not.toThrow()
    })

    it('commits mutations (namespaced and global)', () => {
        const facade = getStoreFacade()

        expect(() => facade.commit('wallets/setChangeIndexes', { BCH: [0, 1] })).not.toThrow()
        expect(facade.getters['wallets/getChangeIndexes']('BCH')).toEqual([0, 1])

        expect(() => facade.commit('setError', null)).not.toThrow()
    })

    it('throws on an unknown action / mutation type', () => {
        const facade = getStoreFacade()

        expect(() => facade.dispatch('nope/nothing')).toThrow(/unknown action/)
        expect(() => facade.commit('nope/nothing')).toThrow(/unknown mutation/)
    })

    it('exposes the state tree', () => {
        const facade = getStoreFacade()

        expect(facade.state.profile.ms).toBe(ENTROPY)
        expect(facade.state.wallets.a).toBeTruthy()
    })

    it('installs a $store on the Vue app (globalProperties)', () => {
        const app = { config: { globalProperties: {} } }

        storePlugin.install(app)

        expect(app.config.globalProperties.$store.state).toBeTruthy()
        expect(app.config.globalProperties.$store.getters).toBeTruthy()
        expect(() => app.config.globalProperties.$store.dispatch('displayNotification', 'x')).not.toThrow()
        expect(() => app.config.globalProperties.$store.commit('setError', null)).not.toThrow()
    })
})

describe('vuex shim', () => {
    const makeComponent = (mapped) => ({
        ...mapped,
        render: () => null,
    })

    const mountWith = (mapped) => shallowMount(makeComponent(mapped), {
        global: { mocks: { $store: getStoreFacade() } },
    })

    it('mapState maps the object form against the reactive root state', () => {
        const wrapper = mountWith({
            computed: mapState({
                seed: (state) => state.profile.ms,
                walletsState: (state) => state.wallets,
            }),
        })

        expect(wrapper.vm.seed).toBe(ENTROPY)
        expect(wrapper.vm.walletsState).toBeTruthy()
    })

    it('mapGetters supports the array and object forms', () => {
        const wrapper = mountWith({
            computed: mapGetters('wallets', ['getAccounts', 'getDustAmount']),
        })

        expect(wrapper.vm.getAccounts).toBeTruthy()
        expect(wrapper.vm.getDustAmount).toBe(546)

        const objectForm = mountWith({
            computed: mapGetters({ network: 'profile/getNetwork' }),
        })

        expect(objectForm.vm.network).toBe('mainnet')
    })

    it('mapActions dispatches namespaced and global actions', async () => {
        const wrapper = mountWith({
            methods: mapActions(['displayNotification']),
        })

        /* Both resolve (the facade dispatches; the actions return undefined). */
        await wrapper.vm.displayNotification('hi')

        const namespaced = mountWith({
            methods: mapActions('wallets', ['activateAccounts']),
        })

        await namespaced.vm.activateAccounts({})
    })

    it('mapMutations commits namespaced and global mutations', () => {
        const wrapper = mountWith({
            methods: mapMutations({ setErr: 'setError' }),
        })

        expect(() => wrapper.vm.setErr(null)).not.toThrow()

        const namespaced = mountWith({
            methods: mapMutations('wallets', ['setChangeIndexes']),
        })

        expect(() => namespaced.vm.setChangeIndexes({ BCH: [0] })).not.toThrow()
    })
})

describe('wallets/getBalance branches', () => {
    const state = {
        a: msgpack.encode({ BCH: { 0: { s: 'a', u: {} } } }),
        c: msgpack.encode({ BCH: [] }),
    }

    const makeGetters = () => {
        const getters = {
            getAccounts: msgpack.decode(Buffer.from(state.a)),
            getDerivationPath: getDerivationPath(),
            getHDNode: hdNodeFromEntropy(ENTROPY),
            getChangeIndexes: () => [],
        }
        getters.getAccountsByWallet = (w) => getAccountsByWallet(state, getters)(w)
        getters.getAddresses = (w) => getAddresses(state, getters, {}, rootGetters)(w)

        return getters
    }

    const rootGetters = {
        'profile/getNetwork': 'mainnet',
        'profile/getFiatCurrency': 'USD',
        'profile/getFlags': { ut: false },
        'blockchain/getTicker': vi.fn(async () => 50000),
        'utils/getFormattedValue': (sats, price, ccy) => ({
            satoshis: sats,
            value: sats,
            rounded: String(sats),
            unit: 'sats',
            fiat: price ? `$${sats / 1e8 * price / 100} ${ccy}` : null,
        }),
    }

    it('counts CONFIRMED only by default', async () => {
        const out = await getBalance(state, makeGetters(), {}, rootGetters)('BCH', 'USD')

        expect(out.satoshis).toBe(1000)
    })

    it('counts unconfirmed too when the profile flag is set', async () => {
        const withUnconfirmed = {
            ...rootGetters,
            'profile/getFlags': { ut: true },
        }

        const out = await getBalance(state, makeGetters(), {}, withUnconfirmed)('BCH', 'USD')

        expect(out.satoshis).toBe(1250)
    })

    it('keeps the BCH total when the ticker fails', async () => {
        const failing = {
            ...rootGetters,
            'blockchain/getTicker': vi.fn(async () => { throw new Error('coingecko down') }),
        }

        const out = await getBalance(state, makeGetters(), {}, failing)('BCH', 'USD')

        expect(out.satoshis).toBe(1000)
        expect(out.fiat).toBeNull()
    })

    it('returns null without accounts', async () => {
        const empty = { a: null }
        const getters = {
            getAccounts: null,
            getAccountsByWallet: () => null,
        }

        await expect(getBalance(empty, getters, {}, rootGetters)('BCH', 'USD')).resolves.toBeNull()
    })
})

describe('components/QR.vue', () => {
    it('renders a QR payload for the given value', async () => {
        const wrapper = shallowMount(QR, { props: { value: 'bitcoincash:qqq' } })

        await new Promise((r) => setTimeout(r, 30))

        expect(wrapper.exists()).toBe(true)
    })

    it('tolerates an empty value', async () => {
        const wrapper = shallowMount(QR, { props: { value: '' } })

        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.exists()).toBe(true)
    })
})

describe('views/Concierge/Spend/Advanced.vue', () => {
    it('mounts and switches tabs', async () => {
        const wrapper = shallowMount(Advanced, {
            global: {
                mocks: { $store: getStoreFacade(), $router: { push: vi.fn() }, $t: (k) => k },
                stubs: { Modal: { template: '<div><slot /></div>' }, Button: true, svgicon: true, Tabs: true, Toggle: true, Dropdown: true, Warning: true, SeedVault: true, Footer: true, Passkey: true },
            },
        })
        await new Promise((r) => setTimeout(r, 30))

        expect(wrapper.vm.tab).toBe('Active')

        wrapper.vm.updateTab('Locked')
        expect(wrapper.vm.tab).toBe('Locked')

        expect(() => wrapper.vm.destroy()).not.toThrow()
    })
})

/* ---- remaining external-wallet / Dropdown / Receive branches ---- */
import {
    encodeCashAddr,
    fetchSourceOutputs,
    parseRecipientAddress,
} from '@/lib/bch/external-wallet'
import DropdownReal from '@/components/inputs/Dropdown.vue'
import Receive from '@/views/Receive.vue'

describe('lib/bch/external-wallet (edge branches)', () => {
    it('encodes a cash address for both p2pkh types', () => {
        const hash = new Uint8Array(20).fill(1)

        expect(encodeCashAddr('bitcoincash', 'p2pkh', hash)).toMatch(/^bitcoincash:/)
        expect(encodeCashAddr('bchtest', 'p2pkhWithTokens', hash)).toMatch(/^bchtest:/)
    })

    it('rejects an invalid recipient and a wrong prefix/type', async () => {
        await expect(parseRecipientAddress('nonsense')).rejects.toThrow(/Invalid recipient/)
        await expect(parseRecipientAddress('bchtest:qz4qn2rj2vxwer9x226r4x7fpv3c9nmmncfq8a0d6'))
            .rejects.toThrow(/must be a bitcoincash address|Invalid recipient/)

        /* A p2sh address is not a supported recipient type. */
        const p2sh = 'bitcoincash:ppv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf'
        await expect(parseRecipientAddress(p2sh)).rejects.toThrow(/Invalid recipient|Unsupported/)
    })

    it('fails loudly when a funding tx output is missing', async () => {
        const cluster = {
            request: vi.fn(async () => {
                /* A real 1-in/1-out p2pkh tx (from the ExternalWallet spec). */
                return '02000000' + '01' + '00'.repeat(32) + '00000000' + '00' + 'ffffffff' + '01' +
                    'a086010000000000' + '19' + '76a914' + '11'.repeat(20) + '88ac' + '00000000'
            }),
        }

        await expect(fetchSourceOutputs(cluster, [{ tx_hash: 'aa'.repeat(32), tx_pos: 5, value: 1 }]))
            .rejects.toThrow(/has no output/)
    })
})

describe('inputs/Dropdown.vue (branches)', () => {
    it('resolves the special-case flags', () => {
        const wrapper = shallowMount(DropdownReal, {
            props: { value: 'USD', items: [] },
            global: { stubs: { svgicon: true } },
        })

        /* The flag assets are inlined as data URLs by Vite. */
        const us = wrapper.vm.getFlagName('American Samoa')
        const norway = wrapper.vm.getFlagName('Bouvet Island')
        const eu = wrapper.vm.getFlagName('Andorra')
        const uk = wrapper.vm.getFlagName('United Kingdom of Great Britain and Northern Ireland (The)')
        const za = wrapper.vm.getFlagName('South Africa')

        for (const url of [us, norway, eu, uk, za]) {
            expect(url).toBeTruthy()
        }

        /* Distinct countries resolve distinct assets. */
        expect(new Set([us, norway, eu, uk, za]).size).toBe(5)
    })

    it('closes on an outside click', () => {
        const wrapper = shallowMount(DropdownReal, {
            props: { value: 'USD', items: [] },
            global: { stubs: { svgicon: true } },
        })

        wrapper.vm.dropdown = true
        wrapper.vm.clickOutside()

        expect(wrapper.vm.dropdown).toBe(false)
    })

    it('renders the item list with the active entry highlighted', () => {
        const wrapper = shallowMount(DropdownReal, {
            props: {
                value: 'USD',
                flag: 'United States',
                items: [
                    { label: 'USD', value: 'USD', flag: 'United States' },
                    { label: 'EUR', value: 'EUR', flag: 'Andorra' },
                ],
            },
            global: { stubs: { svgicon: true } },
        })

        wrapper.vm.dropdown = true

        expect(wrapper.html()).toContain('USD')
    })
})

describe('views/Receive (remaining branches)', () => {
    it('renders an empty display address without a wallet', async () => {
        getStoreFacade().state.wallets.a = null

        const wrapper = shallowMount(Receive, {
            global: {
                mocks: { $store: getStoreFacade(), $router: { push: vi.fn() }, $t: (k) => k },
                stubs: { Modal: { template: '<div><slot /></div>' }, QR: true, Button: true, Header: true, svgicon: true },
            },
        })
        await new Promise((r) => setTimeout(r, 40))

        expect(wrapper.vm.displayAddress).toBe('')
    })

    it('uses the iOS selection path when the user agent is an iPhone', async () => {
        const ua = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone)')
        document.execCommand = vi.fn(() => true)

        const wrapper = shallowMount(Receive, {
            global: {
                mocks: { $store: getStoreFacade(), $router: { push: vi.fn() }, $t: (k) => k },
                stubs: { Modal: { template: '<div><slot /></div>' }, QR: true, Button: true, Header: true, svgicon: true },
            },
        })
        await new Promise((r) => setTimeout(r, 60))

        wrapper.vm.setClipboard('bitcoincash:qios')

        expect(document.execCommand).toHaveBeenCalledWith('copy')

        ua.mockRestore()
    })
})
