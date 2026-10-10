/* Import modules. */
import Vue from 'vue'
import Vuex from 'vuex'

/* Initialize vuex. */
Vue.use(Vuex)

/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Import from '@/components/popups/Import.vue'

/* Stub the lottie-driven Animation child (needs canvas + dynamic JSON imports). */
const stubs = { Animation: true }

/* Describe test. */
describe('popups/Import.vue', () => {
    /* Initialize (mock) store. */
    let displayNotification
    let store

    beforeEach(() => {
        /* Stub the system actions used by the component. */
        displayNotification = jest.fn()

        store = new Vuex.Store({
            actions: {
                displayNotification,
                displayError: jest.fn(),
            },
        })
    })

    it('is a registered component', () => {
        const wrapper = shallowMount(Import, { store, stubs })

        expect(wrapper.isVueInstance()).toBeTruthy()
    })

    it('renders the money-waiting header', () => {
        const wrapper = shallowMount(Import, { store, stubs })

        expect(wrapper.text()).toContain('Hey! You have money waiting')
    })

    it('renders the animation with the pay type', () => {
        const wrapper = shallowMount(Import, { store, stubs })

        expect(wrapper.find('animation-stub').attributes('type')).toBe('pay')
    })

    it('emits close-import when Yes (confirm) is clicked', () => {
        const wrapper = shallowMount(Import, { store, stubs })

        /* Trigger the component's confirm() directly. */
        wrapper.vm.confirm()

        expect(displayNotification).toHaveBeenCalled()
        expect(wrapper.emitted('close-import')).toBeTruthy()
    })

    it('emits close-import when No (close) is clicked', () => {
        const wrapper = shallowMount(Import, { store, stubs })

        /* Trigger the component's close() directly. */
        wrapper.vm.close()

        expect(wrapper.emitted('close-import')).toBeTruthy()
    })
})
