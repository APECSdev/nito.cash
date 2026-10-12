/* Import test utilities. */
import { shallowMount } from '@vue/test-utils'
import { vi } from 'vitest'

/* Mock lottie-web (its mount hook needs canvas + does real animation work).
   NOTE (Vitest): Animation.vue does `await import('lottie-web')` (namespace),
   so the mock must expose `loadAnimation` as a NAMED export (and `default`). */
vi.mock('lottie-web', () => {
    const loadAnimation = vi.fn(() => ({ destroy: vi.fn() }))

    return {
        default: { loadAnimation },
        loadAnimation,
    }
})

/* Import component. */
import Animation from '@/components/Animation.vue'

/* Describe test. */
describe('Animation.vue', () => {
    it('is a registered component', () => {
        const wrapper = shallowMount(Animation)

        expect(wrapper.exists()).toBeTruthy()
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
