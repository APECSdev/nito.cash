/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'
import { vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/* Import the (Pinia-backed) store + facade and the system module, so the
   component's `mapActions(['displayNotification'])` resolves through the
   facade and we can stub the global (system) actions it dispatches. */
import { useStore, getStoreFacade, StoreCompatPlugin, ensureStoreFacade } from '@/store'
import systemModule from '@/store/modules/system'

/* Import component. */
import Import from '@/components/popups/Import.vue'

/* Stub the lottie-driven Animation child (needs canvas + dynamic JSON imports). */
const stubs = { Animation: true, svgicon: true, Popup: false }

/* Describe test. */
describe('popups/Import.vue', () => {
    /* Initialize (mock) store. */
    let displayNotification
    let displayError

    beforeEach(() => {
        /* Activate a fresh Pinia and build the `$store` facade. */
        const pinia = createPinia()
        pinia.use(StoreCompatPlugin)
        setActivePinia(pinia)
        ensureStoreFacade(useStore()) /* instantiate + build the facade */

        /* Stub the (global) system actions used by the component. */
        displayNotification = vi.fn()
        displayError = vi.fn()
        systemModule.actions.displayNotification = displayNotification
        systemModule.actions.displayError = displayError
    })

    /* Helper: mount with the `$store` facade + Animation stub. */
    const mountPopup = () => shallowMount(Import, {
        global: {
            mocks: { $store: getStoreFacade() },
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
