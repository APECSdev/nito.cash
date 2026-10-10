/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Address from '@/components/inputs/Address.vue'

/* Describe test. */
describe('inputs/Address.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Address)

        expect(wrapper.isVueInstance()).toBeTruthy()
    })

    it('renders a textarea with the recipient placeholder', () => {
        const wrapper = shallowMount(Address)
        const textarea = wrapper.find('textarea')

        expect(textarea.exists()).toBeTruthy()
        expect(textarea.attributes('placeholder')).toBe('Recipient address')
    })

    it('binds the address prop to the textarea value', () => {
        const wrapper = shallowMount(Address, { propsData: { address: 'bitcoincash:qq…' } })

        expect(wrapper.find('textarea').element.value).toBe('bitcoincash:qq…')
    })

    it('emits input with the new value on typing', async () => {
        const wrapper = shallowMount(Address)
        const textarea = wrapper.find('textarea')

        /* Simulate user input. */
        await textarea.setValue('bitcoincash:qr…')

        expect(wrapper.emitted('input')).toBeTruthy()
        expect(wrapper.emitted('input')[0]).toEqual(['bitcoincash:qr…'])
    })
})
