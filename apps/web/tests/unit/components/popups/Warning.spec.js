/* Import modules. */
import Vue from 'vue'
import VueSVGIcon from 'vue-svgicon'

/* Initialize SVG icons. */
Vue.use(VueSVGIcon)

/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Warning from '@/components/popups/Warning.vue'
import Button from '@/components/Button.vue'

/* Describe test. */
describe('popups/Warning.vue', () => {
    /* Initialize wrapper. */
    const wrapper = shallowMount(Warning, { propsData: { active: true } })

    it('is a registered component', () => {
        expect(wrapper.isVueInstance()).toBeTruthy()
    })

    it('renders the confirm button label', () => {
        const labels = wrapper.findAll(Button).wrappers.map((btn) => btn.props('label'))

        expect(labels).toContain('Yes, destroy wallet')
    })

    it('renders the cancel button label', () => {
        const labels = wrapper.findAll(Button).wrappers.map((btn) => btn.props('label'))

        expect(labels).toContain('Cancel')
    })

    it('emits confirm when the confirm button is clicked', () => {
        const confirmBtn = wrapper
            .findAll(Button)
            .wrappers
            .find((btn) => btn.props('label') === 'Yes, destroy wallet')

        /* Button uses @click.native, so trigger a real DOM click. */
        confirmBtn.trigger('click')

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
