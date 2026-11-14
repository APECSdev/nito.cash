/* Import test utilities. */
import { createPinia, setActivePinia } from 'pinia'
import piniaPersist from 'pinia-plugin-persistedstate'
import { shallowMount } from '@vue/test-utils'
import { beforeEach } from 'vitest'

/* Import component. */
import Transaction from '@/components/popups/Transaction.vue'

/* Import the store facade bootstrap (the popup maps profile getters — the
   facade must exist in this file's realm before mounting). */
import { useStore, StoreCompatPlugin, ensureStoreFacade } from '@/store'

/* Initialize a transaction fixture. */
const tx = {
    incoming: true,
    persistence: true,
    value: { value: '0.01234567', unit: 'BCH', fiat: '$3.21' },
    timestamp: 1600000000,
    hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    receiver: 'bitcoincash:qq…',
    reference: 'Thanks!',
}

/* Describe test. */
describe('popups/Transaction.vue', () => {
    beforeEach(() => {
        /* Fresh Pinia + facade (same pattern as pool-store.spec.js): the
           facade is cached on globalThis; a re-ensure against a new store
           in this isolated file realm is fine. */
        const pinia = createPinia()
        pinia._a = {}
        pinia.use(StoreCompatPlugin)
        pinia.use(piniaPersist)
        setActivePinia(pinia)
        ensureStoreFacade(useStore())
    })

    it('is a registered component', () => {
        const wrapper = shallowMount(Transaction, { props: { active: true, tx }, global: { stubs: { Popup: false, svgicon: true } } })

        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders nothing (no tx body) when tx is absent', () => {
        const wrapper = shallowMount(Transaction, { props: { active: true, tx: null }, global: { stubs: { Popup: false, svgicon: true } } })

        expect(wrapper.find('.date').exists()).toBeFalsy()
    })

    it('shows a truncated transaction hash', () => {
        const wrapper = shallowMount(Transaction, { props: { active: true, tx }, global: { stubs: { Popup: false, svgicon: true } } })

        const link = wrapper.find('article a')

        expect(link.text()).toContain('0123456789')
        expect(link.text()).toContain('...')

        /* Network-aware explorer (defaults to mainnet → chaingraph.cash; the
           legacy link was hardcoded to explorer.bitcoin.com). */
        expect(link.attributes('href')).toBe(`https://chaingraph.cash/tx/${tx.hash}`)
    })

    it('shows the received label for an incoming, persisted tx', () => {
        const wrapper = shallowMount(Transaction, { props: { active: true, tx }, global: { stubs: { Popup: false, svgicon: true } } })

        expect(wrapper.find('header').text()).toContain('You received')
    })

    it('shows the recipient when present', () => {
        const wrapper = shallowMount(Transaction, { props: { active: true, tx }, global: { stubs: { Popup: false, svgicon: true } } })

        expect(wrapper.text()).toContain('bitcoincash:qq…')
    })

    it('emits close-details when the Done button is clicked', () => {
        const wrapper = shallowMount(Transaction, { props: { active: true, tx }, global: { stubs: { Popup: false, svgicon: true } } })

        /* Button uses @click.native -> close() -> emit; trigger a real DOM click. */
        wrapper.find('button-stub').trigger('click')

        expect(wrapper.emitted('close-details')).toBeTruthy()
    })

    it('formats a long date from a unix timestamp', () => {
        const wrapper = shallowMount(Transaction, { props: { active: true, tx }, global: { stubs: { Popup: false, svgicon: true } } })

        const formatted = wrapper.vm.formatDate(1600000000, 'long')

        expect(typeof formatted).toBe('string')
        expect(formatted.length).toBeGreaterThan(0)
    })
})
