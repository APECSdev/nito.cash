/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Popup from '@/components/popups/Popup.vue'

/* Describe test. */
describe('popups/Popup.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Popup)

        expect(wrapper.isVueInstance()).toBeTruthy()
    })

    it('is hidden (no active class) by default', () => {
        const wrapper = shallowMount(Popup)

        expect(wrapper.find('.popup').classes()).not.toContain('active')
    })

    it('applies the active class when active', () => {
        const wrapper = shallowMount(Popup, { propsData: { active: true } })

        expect(wrapper.find('.popup').classes()).toContain('active')
    })

    it('applies the solid class when solid', () => {
        const wrapper = shallowMount(Popup, { propsData: { active: true, solid: true } })

        expect(wrapper.find('.popup').classes()).toContain('solid')
    })

    it('renders slot content', () => {
        const wrapper = shallowMount(Popup, {
            propsData: { active: true },
            slots: { default: '<p class="inside">hello</p>' },
        })

        expect(wrapper.find('.inside').exists()).toBeTruthy()
        expect(wrapper.text()).toContain('hello')
    })

    it('clears active on escape key press', () => {
        /* Preserve any existing handler so we don't leak a stale one into
           later mounts (Popup assigns document.onkeydown in created()). */
        const previous = document.onkeydown

        const wrapper = shallowMount(Popup, { propsData: { active: true } })

        /* Simulate the escape key via this instance's own handler. */
        document.onkeydown({ keyCode: 27 })

        expect(wrapper.vm.active).toBeNull()

        /* Restore. */
        document.onkeydown = previous
    })
})
