/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Backup from '@/components/popups/Backup.vue'
import Popup from '@/components/popups/Popup.vue'

/* Stub the lottie-driven Animation child (needs canvas + dynamic JSON imports). */
const stubs = { Animation: true }

/* Describe test. */
describe('popups/Backup.vue', () => {
    /* Initialize wrapper. */
    const wrapper = shallowMount(Backup, { stubs })

    it('is a registered component', () => {
        expect(wrapper.isVueInstance()).toBeTruthy()
    })

    it('renders inside a Popup', () => {
        expect(wrapper.find(Popup).exists()).toBeTruthy()
    })

    it('renders the backup header', () => {
        expect(wrapper.text()).toContain('Backup your wallet')
    })

    it('renders the animation with the president type', () => {
        expect(wrapper.find('animation-stub').attributes('type')).toBe('president')
    })

    it('renders No and Yes action buttons', () => {
        const labels = wrapper.findAll('button-stub').wrappers.map((btn) => btn.attributes('label'))

        expect(labels).toEqual(expect.arrayContaining(['No', 'Yes']))
    })
})
