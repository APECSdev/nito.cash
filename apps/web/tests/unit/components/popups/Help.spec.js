/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Help from '@/components/popups/Help.vue'
import Popup from '@/components/popups/Popup.vue'

/* Describe test. */
describe('popups/Help.vue', () => {
    /* Initialize wrapper.
       NOTE: Help.vue declares `active` as a data property (its `props` block is
       commented out), so it manages visibility internally rather than via props. */
    const wrapper = shallowMount(Help)

    it('is a registered component', () => {
        expect(wrapper.isVueInstance()).toBeTruthy()
    })

    it('renders inside a solid Popup', () => {
        const popup = wrapper.find(Popup)

        expect(popup.exists()).toBeTruthy()
        expect(popup.props('solid')).toBe(true)
    })

    it('initializes active to null (internal state, not a prop)', () => {
        expect(wrapper.vm.active).toBeNull()
    })

    it('renders the help placeholder text', () => {
        expect(wrapper.text()).toContain('help me!')
    })
})
