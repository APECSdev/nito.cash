/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Tabs from '@/components/Tabs.vue'

/* Describe test. */
describe('Tabs.vue', () => {
    /* Initialize props. */
    const props = {
        tab: 'Send',
        tabs: ['Send', 'Receive'],
    }

    /* Initialize wrapper. */
    const wrapper = shallowMount(Tabs, { props })

    it('is a registered component', () => {
        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders one button per tab', () => {
        expect(wrapper.findAll('button').length).toBe(props.tabs.length)
    })

    it('renders the tab labels', () => {
        /* NOTE (VTU v2): `findAll` returns the wrappers array directly (no `.wrappers`). */
        const labels = wrapper.findAll('button').map((btn) => btn.text())

        expect(labels).toEqual(['Send', 'Receive'])
    })

    it('marks the active tab from the prop', () => {
        expect(wrapper.find('button.active').text()).toBe('Send')
    })

    it('does not mutate the parent prop', () => {
        expect(wrapper.vm.selectedTab).toBeNull()
        expect(wrapper.vm.activeTab).toBe('Send')
    })

    it('emits tab-change and updates the active tab on click', async () => {
        /* Trigger click on the second tab. */
        await wrapper.findAll('button').at(1).trigger('click')

        /* Verify emitted event. */
        expect(wrapper.emitted('tab-change')).toBeTruthy()
        expect(wrapper.emitted('tab-change')[0]).toEqual(['Receive'])

        /* Verify active tab moved. */
        expect(wrapper.vm.activeTab).toBe('Receive')
        expect(wrapper.find('button.active').text()).toBe('Receive')
    })
})
