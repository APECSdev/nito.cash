/* Import modules. */
import Vue from 'vue'
import VueSVGIcon from 'vue-svgicon'

/* Initialize SVG icons. */
Vue.use(VueSVGIcon)

/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Concierge from '@/components/popups/Concierge.vue'
import Button from '@/components/Button.vue'

/* Describe test. */
describe('popups/Concierge.vue', () => {
    /* Initialize wrapper. */
    const wrapper = shallowMount(Concierge, { propsData: { active: true } })

    it('is a registered component', () => {
        expect(wrapper.isVueInstance()).toBeTruthy()
    })

    it('renders the accept recommendation button label', () => {
        const labels = wrapper.findAll(Button).wrappers.map((btn) => btn.props('label'))

        expect(labels).toContain('Accept recommendation')
    })

    it('renders the cancel button label', () => {
        const labels = wrapper.findAll(Button).wrappers.map((btn) => btn.props('label'))

        expect(labels).toContain('Cancel')
    })

    it('emits confirm when the accept button is clicked', () => {
        const acceptBtn = wrapper
            .findAll(Button)
            .wrappers
            .find((btn) => btn.props('label') === 'Accept recommendation')

        /* Button uses @click.native, so trigger a real DOM click. */
        acceptBtn.trigger('click')

        expect(wrapper.emitted('confirm')).toBeTruthy()
    })

    it('emits cancel when the cancel button is clicked', () => {
        const cancelBtn = wrapper
            .findAll(Button)
            .wrappers
            .find((btn) => btn.props('label') === 'Cancel')

        /* Button uses @click.native, so trigger a real DOM click. */
        cancelBtn.trigger('click')

        expect(wrapper.emitted('cancel')).toBeTruthy()
    })
})
