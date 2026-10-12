/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Help from '@/components/popups/Help.vue'

/* Describe test. */
describe('popups/Help.vue', () => {
    /* Initialize wrapper.
       NOTE: Help.vue declares `active` as a data property (its `props` block is
       commented out), so it manages visibility internally rather than via props.
       NOTE (VTU v2): Popup is left UN-stubbed so its default slot (which carries
       the 'help me!' text) actually renders under shallowMount. */
    const wrapper = shallowMount(Help, {
        global: { stubs: { Popup: false } },
    })

    it('is a registered component', () => {
        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders inside a solid Popup', () => {
        const popup = wrapper.find('.popup')

        expect(popup.exists()).toBeTruthy()
        expect(popup.classes()).toContain('solid')
    })

    it('initializes active to null (internal state, not a prop)', () => {
        expect(wrapper.vm.active).toBeNull()
    })

    it('renders the help placeholder text', () => {
        expect(wrapper.text()).toContain('help me!')
    })
})
