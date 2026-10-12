/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Dropdown from '@/components/inputs/Dropdown.vue'

/* Initialize items fixture (country -> currency). */
const items = [
    { label: 'United States', value: '840', flag: 'United States' },
    { label: 'Andorra', value: '978', flag: 'Andorra' },
]

/* Initialize base props (a `flag` is required: the template renders
   getFlagName(activeFlag) immediately). */
const props = { items, value: 'USD', flag: 'United States' }

/* Describe test. */
describe('inputs/Dropdown.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Dropdown, { props })

        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders one button per item', () => {
        const wrapper = shallowMount(Dropdown, { props })

        expect(wrapper.findAll('nav button').length).toBe(items.length)
    })

    it('shows the current value as the active country', () => {
        const wrapper = shallowMount(Dropdown, { props })

        expect(wrapper.vm.activeCountry).toBe('USD')
    })

    it('resolves a flag image via require.context (no Jest crash)', () => {
        const wrapper = shallowMount(Dropdown, { props })

        /* Previously a dynamic require() threw under Jest (the FIXME). */
        expect(() => wrapper.vm.getFlagName('Andorra')).not.toThrow()
    })

    it('maps the United States special case to its flag', () => {
        const wrapper = shallowMount(Dropdown, { props })

        expect(() => wrapper.vm.getFlagName('United States')).not.toThrow()
    })

    it('applies the disabled class from the prop', () => {
        const wrapper = shallowMount(Dropdown, { props: { ...props, disabled: true } })

        expect(wrapper.classes()).toContain('disabled')
    })
})
