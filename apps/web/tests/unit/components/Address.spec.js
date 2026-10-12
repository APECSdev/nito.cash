/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Address from '@/components/inputs/Address.vue'

/* Describe test. */
describe('inputs/Address.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Address)

        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders a textarea with the recipient placeholder', () => {
        const wrapper = shallowMount(Address)
        const textarea = wrapper.find('textarea')

        expect(textarea.exists()).toBeTruthy()
        expect(textarea.attributes('placeholder')).toBe('Recipient address')
    })

    it('binds the modelValue prop to the textarea value', () => {
        const wrapper = shallowMount(Address, { props: { modelValue: 'bitcoincash:qq…' } })

        expect(wrapper.find('textarea').element.value).toBe('bitcoincash:qq…')
    })

    /* NOTE (Vue 3): v-model now emits `update:modelValue` (was `input` in Vue 2). */
    it('emits update:modelValue with the new value on typing', async () => {
        const wrapper = shallowMount(Address)
        const textarea = wrapper.find('textarea')

        /* Simulate user input. */
        await textarea.setValue('bitcoincash:qr…')

        expect(wrapper.emitted('update:modelValue')).toBeTruthy()
        expect(wrapper.emitted('update:modelValue')[0]).toEqual(['bitcoincash:qr…'])
    })
})
