/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Backup from '@/components/popups/Backup.vue'
import Popup from '@/components/popups/Popup.vue'

/* Stub the lottie-driven Animation child (needs canvas + dynamic JSON imports). */
const stubs = { Animation: true, svgicon: true, Popup: false }

/* Describe test. */
describe('popups/Backup.vue', () => {
    /* Initialize wrapper. */
    const wrapper = shallowMount(Backup, { global: { stubs } })

    it('is a registered component', () => {
        expect(wrapper.exists()).toBeTruthy()
    })

    it('renders inside a Popup', () => {
        expect(wrapper.findComponent(Popup).exists()).toBeTruthy()
    })

    it('renders the backup header', () => {
        expect(wrapper.text()).toContain('Backup your wallet')
    })

    it('renders the animation with the president type', () => {
        expect(wrapper.find('animation-stub').attributes('type')).toBe('president')
    })

    it('renders the "Not now" and "Show my backup" action buttons', () => {
        const labels = wrapper.findAll('button-stub').map((btn) => btn.attributes('label'))

        expect(labels).toEqual(expect.arrayContaining(['Not now', 'Show my backup']))
    })

    it('emits deny-backup / confirm-backup from its buttons', async () => {
        /* The wired popup: the buttons EMIT (the old Yes/No stubs only
         * console.log'd). */
        const local = shallowMount(Backup, { global: { stubs } })

        /* The button-stub does not re-emit `.native` clicks — drive the
           methods directly (the views.spec Backup test covers the full
           click-through wiring). */
        local.vm.deny()
        expect(local.emitted('deny-backup')).toHaveLength(1)

        local.vm.confirm()
        expect(local.emitted('confirm-backup')).toHaveLength(1)
    })
})
