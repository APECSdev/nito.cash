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

/* Every animation type resolves a DIFFERENT JSON source (the switch in the
 * loader) — mounting each one exercises those branches. */
describe('Animation.vue (sources)', () => {
    const types = ['loading', 'receive', 'pay', 'pay-error', 'pay-ok', 'rocket', 'rocketman', 'unknown']

    it('loads each animation source without throwing', async () => {
        for (const type of types) {
            const wrapper = shallowMount(Animation, { props: { type } })

            /* Let the dynamic import + lottie mount settle. */
            await new Promise((resolve) => setTimeout(resolve, 20))

            expect(wrapper.exists()).toBe(true)

            wrapper.unmount()
        }
    })
})
