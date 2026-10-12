/* Import modules. */
import { createStore } from 'vuex'

/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'
import { vi } from 'vitest'

/* Import component. */
import Import from '@/components/popups/Import.vue'

/* Stub the lottie-driven Animation child (needs canvas + dynamic JSON imports). */
const stubs = { Animation: true, svgicon: true, Popup: false }

/* Describe test. */
describe('popups/Import.vue', () => {
    /* Initialize (mock) store. */
    let displayNotification
    let store

    beforeEach(() => {
        /* Stub the system actions used by the component. */
        displayNotification = vi.fn()

        store = createStore({
            actions: {
                displayNotification,
                displayError: vi.fn(),
            },
        })
    })

    /* Helper: mount with the (mock) Vuex store + Animation stub.
       NOTE (VTU v2): store/stubs moved under `global`. */
    const mountPopup = () => shallowMount(Import, {
        global: {
            plugins: [store],
            stubs,
        },
    })

    it('is a registered component', () => {
        const wrapper = mountPopup()

        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders the money-waiting header', () => {
        const wrapper = mountPopup()

        expect(wrapper.text()).toContain('Hey! You have money waiting')
    })

    it('renders the animation with the pay type', () => {
        const wrapper = mountPopup()

        expect(wrapper.find('animation-stub').attributes('type')).toBe('pay')
    })

    it('emits close-import when Yes (confirm) is clicked', () => {
        const wrapper = mountPopup()

        /* Trigger the component's confirm() directly. */
        wrapper.vm.confirm()

        expect(displayNotification).toHaveBeenCalled()
        expect(wrapper.emitted('close-import')).toBeTruthy()
    })

    it('emits close-import when No (close) is clicked', () => {
        const wrapper = mountPopup()

        /* Trigger the component's close() directly. */
        wrapper.vm.close()

        expect(wrapper.emitted('close-import')).toBeTruthy()
    })
})
