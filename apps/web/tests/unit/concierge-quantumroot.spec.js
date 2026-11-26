/* Unit tests for the Quantumroot guest service (Desk → Quantumroot).
 *
 * The service is a MOCKUP: every test below pins its LOCAL behaviour — the
 * published developer-preview transcription, the three-stage orchestration
 * timer, the run/reset labels and the back control. Nothing may derive,
 * sign, broadcast or contact the chain.
 *
 * Conventions follow concierge-desk.spec.js: the REAL Pinia-backed store
 * facade (notification toasts go through the real system action) and a
 * MOCKED Fulcrum cluster (the store's import chain must not open sockets).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/* ---- network mocks (hoisted; same shape as concierge-desk.spec.js) ---- */
const { cluster, getClusterMock } = vi.hoisted(() => {
    const cluster = {
        getBalance: vi.fn(async () => ({ confirmed: 12345, unconfirmed: 0 })),
        getHistory: vi.fn(async () => []),
        verboseGetTransaction: vi.fn(async () => ({ txid: 'aa', confirmations: 1, time: 1700000000, vin: [], vout: [] })),
        getUtxos: vi.fn(async () => []),
        getUtxosWithTokens: vi.fn(async () => []),
        subscribeAddresses: vi.fn(async () => {}),
        unsubscribeAddresses: vi.fn(async () => {}),
        broadcast: vi.fn(async () => 'txid'),
        estimateFee: vi.fn(async () => 0.00001),
        relayFee: vi.fn(async () => 0.00001),
    }

    return { cluster, getClusterMock: vi.fn(async () => cluster) }
})

vi.mock('@/lib/bch/provider.js', () => ({
    getCluster: getClusterMock,
    closeAllClusters: vi.fn(async () => {}),
    ElectrumMethods: {},
    FulcrumCluster: class {},
}))

vi.mock('@/lib/solana.js', () => ({
    SOLANA_RPC: 'https://rpc.test',
    solanaAccountFromEntropy: () => ({ address: 'So1anaAddr', publicKey: new Uint8Array(32), privateKey: new Uint8Array(32) }),
    fetchSolBalance: vi.fn(async () => 1.5),
}))

/* Import the store + facade AFTER the mocks. */
import { useStore, getStoreFacade, StoreCompatPlugin, ensureStoreFacade } from '@/store'

import Quantumroot from '@/views/Concierge/Desk/Quantumroot.vue'

const stubs = {
    /* NOTE: the real Button renders its `label` PROP (not slot content),
       so the stub must declare + render it or button text never appears. */
    Button: { props: ['label'], template: '<button>{{ label }}<slot /></button>' },
}

const mountService = (options = {}) => shallowMount(Quantumroot, {
    global: {
        mocks: {
            $store: getStoreFacade(),
            $t: (key) => key,
        },
        stubs,
    },
    ...options,
})

beforeEach(() => {
    /* The facade is cached on globalThis and is NOT rebuilt for a new Pinia
       instance (see views.spec.js) — drop it and rebuild for this test. */
    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    ensureStoreFacade(useStore())
})

describe('views/Concierge/Desk/Quantumroot — the service rendering', () => {
    it('renders the published developer-preview record', () => {
        const wrapper = mountService()

        const text = wrapper.text()

        expect(text).toContain('Quantumroot')
        expect(text).toContain('New orchestration')
        expect(text).toContain('Quantum-secure vaults for Bitcoin Cash')

        /* The security + signature figures. */
        expect(text).toContain('256-bit classical · 128-bit quantum (Grover)')
        expect(text).toContain('LM-OTS (RFC 8554) · 2,144-byte signature · ~2.5 KB unlock per signer')
        expect(text).toContain('71 B per additional UTXO · 15% smaller per input after 8 UTXOs')
        expect(text).toContain('400+ unique addresses or 800+ inputs in one <100 KB transaction')

        /* The honest gaps. */
        expect(text).toContain('The template has not yet been reviewed by anyone else')
        expect(text).toContain('This wallet does not implement Quantumroot yet; the desk is a preview.')

        /* The canonical source. */
        expect(wrapper.find('a[href="https://blog.bitjson.com/quantumroot/"]').exists()).toBe(true)

        /* The three-stage orchestration. */
        expect(wrapper.vm.steps).toHaveLength(3)
        expect(wrapper.vm.steps.map((s) => s.name)).toEqual(['Derive', 'Fund', 'Sweep'])
    })

    it('emits back from the "← Guest services" control', async () => {
        const wrapper = mountService()

        const back = wrapper.findAll('button').find((button) => button.text().includes('← Guest services'))
        await back.trigger('click')

        expect(wrapper.emitted('back')).toHaveLength(1)
    })
})

describe('views/Concierge/Desk/Quantumroot — the orchestration preview', () => {
    beforeEach(() => {
        /* The preview is timer-driven (900ms per stage); fake timers keep it
           deterministic and fast. */
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('advances Derive → Fund → Sweep and settles with the sweep figures', async () => {
        const wrapper = mountService()
        const vm = wrapper.vm

        /* Resting state. */
        expect(vm.previewState).toBe(null)
        expect(vm.previewStep).toBe(-1)
        expect(vm.previewLabel).toBe('Run the preview')
        expect(vm.stepState(0)).toBe('Queued')

        vm.runPreview()

        /* Derive is in session immediately. */
        expect(vm.previewState).toBe('running')
        expect(vm.previewStep).toBe(0)
        expect(vm.stepState(0)).toBe('In session')
        expect(vm.stepState(1)).toBe('Queued')

        await vi.advanceTimersByTimeAsync(900)
        expect(vm.previewStep).toBe(1)
        expect(vm.stepState(0)).toBe('Done')
        expect(vm.stepState(1)).toBe('In session')

        await vi.advanceTimersByTimeAsync(900)
        expect(vm.previewStep).toBe(2)
        expect(vm.stepState(2)).toBe('In session')

        await vi.advanceTimersByTimeAsync(900)

        expect(vm.previewState).toBe('done')
        expect(vm.stepState(2)).toBe('Done')
        expect(vm.previewLabel).toBe('Reset the preview')

        /* The settled card carries the published sweep figures. */
        expect(wrapper.text()).toContain('The vault is ready for a quantum sweep')
        expect(wrapper.text()).toContain('71-byte introspection spends')
        expect(wrapper.text()).toContain('400+ addresses or 800+ inputs')

        /* The settled toast lands through the real action. */
        expect(getStoreFacade().state.system.nm).toContain('orchestration preview complete')

        /* The same button resets a finished preview. */
        vm.runPreview()

        expect(vm.previewState).toBe(null)
        expect(vm.previewStep).toBe(-1)
        expect(vm.previewLabel).toBe('Run the preview')
    })

    it('ignores re-taps while the preview is running (no duplicate timers)', async () => {
        const wrapper = mountService()
        const vm = wrapper.vm

        vm.runPreview()
        vm.runPreview()

        expect(vm.previewState).toBe('running')

        await vi.advanceTimersByTimeAsync(900)
        expect(vm.previewStep).toBe(1)

        /* A single tick per interval — the duplicate tap added no timer. */
        await vi.advanceTimersByTimeAsync(900)
        expect(vm.previewStep).toBe(2)
    })

    it('clears the preview timer on unmount (no settle after the view is gone)', async () => {
        const wrapper = mountService()
        const vm = wrapper.vm

        vm.runPreview()
        await vi.advanceTimersByTimeAsync(900)
        expect(vm.previewState).toBe('running')
        expect(vm.previewStep).toBe(1)

        wrapper.unmount()

        await vi.advanceTimersByTimeAsync(5000)

        /* The timer never fired the settle; no toast landed. */
        expect(vm.previewState).toBe('running')
        expect(getStoreFacade().state.system.nm).toBe(null)
    })

    it('maps the step cursor to Done / In session / Queued', () => {
        const wrapper = mountService()
        const vm = wrapper.vm

        vm.previewState = 'running'
        vm.previewStep = 1

        expect(vm.stepTone(0)).toBe('gold')
        expect(vm.stepTone(1)).toBe('primary')
        expect(vm.stepTone(2)).toBe('muted')

        expect(vm.stepState(0)).toBe('Done')
        expect(vm.stepState(1)).toBe('In session')
        expect(vm.stepState(2)).toBe('Queued')

        vm.previewState = 'done'

        expect(vm.stepTone(0)).toBe('gold')
        expect(vm.stepState(2)).toBe('Done')
    })
})
