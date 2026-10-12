/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Spinner from '@/components/Spinner.vue'

/* Describe test. */
describe('Spinner.vue', () => {
    /* Initialize wrapper. */
    const wrapper = shallowMount(Spinner)

    it('is a registered component', () => {
        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders a figure container', () => {
        expect(wrapper.find('figure').exists()).toBeTruthy()
    })

    it('renders 8 spinner balls', () => {
        expect(wrapper.findAll('figure > div').length).toBe(8)
    })
})
