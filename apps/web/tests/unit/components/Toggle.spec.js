/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Toggle from '@/components/inputs/Toggle.vue'

/* Describe test. */
describe('Toggle.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Toggle)

        expect(wrapper.isVueInstance()).toBeTruthy()
    })

    it('renders inactive by default (on = false)', () => {
        const wrapper = shallowMount(Toggle, { propsData: { on: false } })

        expect(wrapper.find('.knob').classes()).not.toContain('active')
        expect(wrapper.vm.active).toBe(false)
    })

    it('renders active when on', () => {
        const wrapper = shallowMount(Toggle, { propsData: { on: true } })

        expect(wrapper.find('.knob').classes()).toContain('active')
        expect(wrapper.vm.active).toBe(true)
    })

    it('applies the disabled class from the prop', () => {
        const wrapper = shallowMount(Toggle, { propsData: { disabled: true } })

        expect(wrapper.find('.toggle').classes()).toContain('disabled')
    })

    it('toggles active state on click', async () => {
        const wrapper = shallowMount(Toggle, { propsData: { on: false } })

        await wrapper.find('.toggle').trigger('click')
        expect(wrapper.vm.active).toBe(true)
        expect(wrapper.find('.knob').classes()).toContain('active')

        await wrapper.find('.toggle').trigger('click')
        expect(wrapper.vm.active).toBe(false)
        expect(wrapper.find('.knob').classes()).not.toContain('active')
    })
})
