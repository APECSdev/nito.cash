/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Mock lottie-web (its mount hook needs canvas + does real animation work). */
jest.mock('lottie-web', () => ({
    loadAnimation: jest.fn(() => ({ destroy: jest.fn() })),
}))

/* Import component. */
import Animation from '@/components/Animation.vue'

/* Describe test. */
describe('Animation.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Animation)

        expect(wrapper.isVueInstance()).toBeTruthy()
    })

    it('renders the animation container', () => {
        const wrapper = shallowMount(Animation)

        expect(wrapper.find('#container').exists()).toBeTruthy()
    })

    it('initializes animation to null before mount', () => {
        const wrapper = shallowMount(Animation)

        expect(wrapper.vm.animation).toBeNull()
    })
})
