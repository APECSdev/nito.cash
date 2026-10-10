/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'

/* Import component. */
import Animation from '@/components/Animation.vue'

/* Describe test.
   NOTE: `mounted()` dynamically imports lottie-web + animation JSON, so we only
   assert the static render here (the animation itself is exercised in-app). */
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
