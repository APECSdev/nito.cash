/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Modal from '@/components/Modal.vue'

/* Stub the Header child (it depends on vue-router and svgicon). */
const stubs = { Header: true }

/* Describe test. */
describe('Modal.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Modal, { global: { stubs } })

        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders the Header by default', () => {
        const wrapper = shallowMount(Modal, { global: { stubs } })

        expect(wrapper.find('header-stub').exists()).toBeTruthy()
    })

    it('hides the Header when hideHeader is set', () => {
        const wrapper = shallowMount(Modal, { props: { hideHeader: true }, global: { stubs } })

        expect(wrapper.find('header-stub').exists()).toBeFalsy()
    })

    it('applies the hideHeader class to the slot container when hideHeader is set', () => {
        const wrapper = shallowMount(Modal, { props: { hideHeader: true }, global: { stubs } })

        expect(wrapper.find('.slot').classes()).toContain('hideHeader')
    })

    it('passes the label prop to the Header', () => {
        const wrapper = shallowMount(Modal, { props: { label: 'Settings' }, global: { stubs } })

        expect(wrapper.find('header-stub').attributes('label')).toBe('Settings')
    })

    it('renders slot content', () => {
        const wrapper = shallowMount(Modal, {
            global: { stubs },
            slots: { default: '<p class="body">modal body</p>' },
        })

        expect(wrapper.find('.body').exists()).toBeTruthy()
        expect(wrapper.text()).toContain('modal body')
    })
})
