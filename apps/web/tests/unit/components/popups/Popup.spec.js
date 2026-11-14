/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Popup from '@/components/popups/Popup.vue'

/* Describe test. */
describe('popups/Popup.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Popup)

        expect(wrapper.exists()).toBeTruthy()
    })

    it('is hidden (no active class) by default', () => {
        const wrapper = shallowMount(Popup)

        expect(wrapper.find('.popup').classes()).not.toContain('active')
    })

    it('applies the active class when active', () => {
        const wrapper = shallowMount(Popup, { props: { active: true } })

        expect(wrapper.find('.popup').classes()).toContain('active')
    })

    it('applies the solid class when solid', () => {
        const wrapper = shallowMount(Popup, { props: { active: true, solid: true } })

        expect(wrapper.find('.popup').classes()).toContain('solid')
    })

    it('renders slot content', () => {
        const wrapper = shallowMount(Popup, {
            props: { active: true },
            slots: { default: '<p class="inside">hello</p>' },
        })

        expect(wrapper.find('.inside').exists()).toBeTruthy()
        expect(wrapper.text()).toContain('hello')
    })

    it('escape key press does not throw (prop mutation is a guarded no-op)', () => {
        const wrapper = shallowMount(Popup, { props: { active: true } })

        /* Simulate the escape key via this instance's own handler (Popup adds
           a `keydown` LISTENER on created and removes it on unmount — the
           previous `document.onkeydown` ASSIGNMENT clobbered every other
           popup's global handler).
           NOTE (Vue 3): mutating the (read-only) `active` prop would throw a
           proxy TypeError; Popup now routes the write through a computed setter
           (a no-op), so the handler runs cleanly and visibility is unchanged. */
        expect(() => wrapper.vm.onKeydown({ keyCode: 27 })).not.toThrow()
        expect(wrapper.vm.active).toBe(true)
        expect(wrapper.find('.popup').classes()).toContain('active')
    })

    it('removes the escape listener on unmount', () => {
        const spy = vi.spyOn(document, 'removeEventListener')

        const wrapper = shallowMount(Popup, { props: { active: true } })

        wrapper.unmount()

        expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function))

        spy.mockRestore()
    })
})
