/* Unit tests for the WizardConnect payment surface (Connect.vue). */
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
        WizardConnectQRDialog: { name: 'WizardConnectQRDialog', template: '<div />' },
    }
})

import Connect from '@/views/Connect'

/* Stub that renders the Button label like the real component does. */
const ButtonStub = {
    name: 'Button',
    props: ['label', 'disabled'],
    template: '<button :disabled="disabled">{{ label }}</button>',
}

function mount() {
    return shallowMount(Connect, {
        global: {
            stubs: { Button: ButtonStub },
        },
    })
}

describe('Connect.vue', () => {
    beforeEach(() => {
        wcState.v = 'idle'
    })

    it('renders the connect surface with the QR flow entry (idle)', () => {
        const wrapper = mount()

        expect(wrapper.text()).toContain('Connect your wallet')
        expect(wrapper.text()).toContain('Connect Wallet')
        expect(wrapper.text()).toContain('WizardConnect-compatible')
    })

    it('renders the payment form fields when connected', () => {
        wcState.v = 'connected'
        const wrapper = mount()

        expect(wrapper.text()).toContain('Connected wallet')
        expect(wrapper.find('#wc-recipient').exists()).toBe(true)
        expect(wrapper.find('#wc-amount').exists()).toBe(true)
        expect(wrapper.text()).toContain('Amount (BCH)')
        expect(wrapper.text()).toContain('Send via wallet')
    })
})
