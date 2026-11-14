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

    /*
     * REGRESSION (Vue 3): `click` must NOT be declared in `emits`. A declared
     * emit is filtered out of attrs fallthrough, and this component never
     * `$emit`s one — every parent handler (`@click.native` / `@click` at all
     * the call sites) would silently never fire. With no `emits` entry the
     * listener falls through onto the inner `<button>` (native click).
     */
    it('invokes a parent click listener via fallthrough', async () => {
        const onClick = vi.fn()
        const wrapper = shallowMount(Button, { attrs: { onClick } })

        await wrapper.find('button').trigger('click')

        expect(onClick).toHaveBeenCalledTimes(1)
    })
})
