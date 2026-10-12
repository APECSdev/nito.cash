/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Footer from '@/components/Footer.vue'

/* Describe test. */
describe('Footer.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Footer)

        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders a footer element', () => {
        const wrapper = shallowMount(Footer)

        expect(wrapper.find('footer').exists()).toBeTruthy()
    })

    it('renders slot content', () => {
        const wrapper = shallowMount(Footer, {
            slots: { default: '<p class="content">footer content</p>' },
        })

        expect(wrapper.find('.content').exists()).toBeTruthy()
        expect(wrapper.text()).toContain('footer content')
    })

    it('does not apply the tooltip class by default', () => {
        const wrapper = shallowMount(Footer)

        expect(wrapper.find('footer').classes()).not.toContain('tooltip')
    })

    it('applies the tooltip class when the tooltip prop is set', () => {
        const wrapper = shallowMount(Footer, { props: { tooltip: true } })

        expect(wrapper.find('footer').classes()).toContain('tooltip')
    })
})
