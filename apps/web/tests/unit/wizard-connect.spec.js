/* Unit tests for the WizardConnect payment modal. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'

/* Shared, mutable composable state — the test flips it to 'connected' to
   exercise the payment form branch. useWizardConnect() snapshots it into a
   REAL ref at mount time (the template auto-unwraps refs). */
const { wcState } = vi.hoisted(() => ({ wcState: { v: 'idle' } }))

/* Mock the adapter so no relay/localStorage side effects run in jsdom. */
vi.mock('@paytaca/wizardconnect-vue', async () => {
    const { ref } = await import('vue')

    return {
        useWizardConnect: () => ({
            state: ref(wcState.v),
            manager: ref(undefined),
            uri: ref(undefined),
            qrUri: ref(undefined),
            walletName: ref(undefined),
            connect: vi.fn(),
            disconnect: vi.fn(),
            error: ref(undefined),
        }),
        AlphanumericQRCode: { name: 'AlphanumericQRCode', template: '<div />' },
    }
})

import WizardConnect from '@/components/popups/WizardConnect'

function mount() {
    return shallowMount(WizardConnect, {
        props: { active: true },
        global: {
            /* Render <Teleport> in place so wrapper.text() sees the content. */
            stubs: { teleport: true },
        },
    })
}

describe('WizardConnect modal', () => {
    beforeEach(() => {
        wcState.v = 'idle'
    })

    it('renders the connect surface with QR + paste-URI support (idle)', () => {
        const wrapper = mount()

        expect(wrapper.text()).toContain('Connect your wallet')
        expect(wrapper.text()).toContain('Connect Wallet')
        expect(wrapper.text()).toContain('WizardConnect-compatible')
        expect(wrapper.text()).toContain('mainnet')
    })

    it('renders the payment form fields when connected', () => {
        wcState.v = 'connected'
        const wrapper = mount()

        expect(wrapper.text()).toContain('mainnet')
        expect(wrapper.text()).toContain('Wallet')
        expect(wrapper.find('#wc-recipient').exists()).toBe(true)
        expect(wrapper.find('#wc-amount').exists()).toBe(true)
        expect(wrapper.text()).toContain('Amount (BCH)')
        expect(wrapper.text()).toContain('Send via wallet')
    })
})
