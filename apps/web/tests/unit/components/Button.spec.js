/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Button from '@/components/Button.vue'

/* Describe test. */
describe('Button.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Button)

        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders the label', () => {
        const wrapper = shallowMount(Button, { props: { label: 'Send' } })

        expect(wrapper.text()).toBe('Send')
    })

    it('renders the loading label when loading', () => {
        const wrapper = shallowMount(Button, {
            props: { label: 'Send', loadingLabel: 'Sending…', loading: true },
        })

        expect(wrapper.text()).toBe('Sending…')
    })

    it('applies the loading class when loading', () => {
        const wrapper = shallowMount(Button, { props: { loading: true } })

        expect(wrapper.classes()).toContain('loading')
    })

    it('applies style modifier classes from props', () => {
        const wrapper = shallowMount(Button, {
            props: { secondary: true, small: true, warning: true },
        })

        expect(wrapper.classes()).toEqual(
            expect.arrayContaining(['secondary', 'small', 'warning'])
        )
    })

    it('applies the disabled class from the prop', () => {
        const wrapper = shallowMount(Button, { props: { disabled: true } })

        expect(wrapper.classes()).toContain('disabled')
    })
})
