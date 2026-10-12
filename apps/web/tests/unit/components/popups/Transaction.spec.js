/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Transaction from '@/components/popups/Transaction.vue'

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
        expect(link.attributes('href')).toBe(`https://explorer.bitcoin.com/bch/tx/${tx.hash}`)
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
