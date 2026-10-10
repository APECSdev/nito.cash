/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Button from '@/components/Button.vue'

/* Describe test. */
describe('Button.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Button)

        expect(wrapper.isVueInstance()).toBeTruthy()
    })

    it('renders the label', () => {
        const wrapper = shallowMount(Button, { propsData: { label: 'Send' } })

        expect(wrapper.text()).toBe('Send')
    })

    it('renders the loading label when loading', () => {
        const wrapper = shallowMount(Button, {
            propsData: { label: 'Send', loadingLabel: 'Sending…', loading: true },
        })

        expect(wrapper.text()).toBe('Sending…')
    })

    it('applies the loading class when loading', () => {
        const wrapper = shallowMount(Button, { propsData: { loading: true } })

        expect(wrapper.classes()).toContain('loading')
    })

    it('applies style modifier classes from props', () => {
        const wrapper = shallowMount(Button, {
            propsData: { secondary: true, small: true, warning: true },
        })

        expect(wrapper.classes()).toEqual(
            expect.arrayContaining(['secondary', 'small', 'warning'])
        )
    })

    it('applies the disabled class from the prop', () => {
        const wrapper = shallowMount(Button, { propsData: { disabled: true } })

        expect(wrapper.classes()).toContain('disabled')
    })
})
