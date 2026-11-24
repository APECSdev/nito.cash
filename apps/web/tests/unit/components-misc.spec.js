/* Unit tests for the remaining components: Passkey assistant, Amount input,
 * BlazeBanner, SeedVault, Animation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

/* ---- passkey lib mock (the WebAuthn flow is covered by passkey.spec.js) ---- */
const { passkeyState } = vi.hoisted(() => ({
    passkeyState: {
        supported: true,
        record: null,
        createError: null,
        unlockError: null,
        phrase: 'airport very blue major step trumpet various same ride legend hunt game butter cake bargain area pave lonely few sick erode tank cinnamon private',
    },
}))

vi.mock('@/lib/passkey.js', () => ({
    passkeySupported: () => passkeyState.supported,
    getPasskeyRecord: () => passkeyState.record,
    hasPasskeyBackup: () => !!passkeyState.record,
    forgetPasskeyBackup: vi.fn(() => { passkeyState.record = null }),
    createPasskeyBackup: vi.fn(async () => {
        if (passkeyState.createError) throw passkeyState.createError
        passkeyState.record = { v: 1, credentialId: 'cred', iv: 'iv', ct: 'ct', createdAt: '2026-01-02T03:04:05.000Z' }
        return passkeyState.record
    }),
    unlockWithPasskey: vi.fn(async () => {
        if (passkeyState.unlockError) throw passkeyState.unlockError
        return passkeyState.phrase
    }),
    STORAGE_KEY: 'nito.passkey.v1',
    PRF_SALT: new Uint8Array(0),
}))

const { emberState } = vi.hoisted(() => ({ emberState: { utxos: [], getUtxosWithTokens: null } }))

vi.mock('@/lib/bch/provider.js', () => {
    const getUtxosWithTokens = vi.fn(async () => emberState.utxos)

    emberState.getUtxosWithTokens = getUtxosWithTokens

    return {
        getCluster: vi.fn(async () => ({ getHistory: vi.fn(async () => []), getUtxosWithTokens })),
    }
})
vi.mock('@/lib/bch/discovery.js', () => ({ scanBranch: vi.fn(async () => -1) }))

import { getCluster } from '@/lib/bch/provider.js'
import { useStore, getStoreFacade, StoreCompatPlugin, ensureStoreFacade } from '@/store'
import systemModule from '@/store/modules/system'
import walletsModule from '@/store/modules/wallets'
import msgpack from 'msgpack-lite'

import Passkey from '@/components/popups/Passkey.vue'
import Amount from '@/components/inputs/Amount.vue'
import BlazeBanner from '@/components/BlazeBanner.vue'
import SeedVault from '@/components/popups/SeedVault.vue'
import Animation from '@/components/Animation.vue'

const ENTROPY = 'ab'.repeat(32)
const stubs = { Popup: false, Button: { template: '<button @click="$emit(\'click\')"><slot /></button>' }, Spinner: true, svgicon: true }

let displayNotification
let restoreWallet

const mount = (component, options = {}) => shallowMount(component, {
    global: {
        mocks: { $store: getStoreFacade(), $router: { push: vi.fn(), replace: vi.fn() }, $t: (k) => k },
        stubs,
    },
    ...options,
})

afterEach(() => {
    vi.useRealTimers()
})

beforeEach(() => {
    emberState.utxos = []
    emberState.getUtxosWithTokens.mockClear()

    delete globalThis.__nito_store_facade__

    const pinia = createPinia()
    pinia.use(StoreCompatPlugin)
    setActivePinia(pinia)
    const store = useStore()
    ensureStoreFacade(store)

    store.profile.ms = ENTROPY
    store.wallets.a = msgpack.encode({ BCH: { 0: { s: 'a', u: {} } } })

    passkeyState.supported = true
    passkeyState.record = null
    passkeyState.createError = null
    passkeyState.unlockError = null

    displayNotification = vi.fn()
    restoreWallet = vi.fn(async () => {})
    systemModule.actions.displayNotification = displayNotification
    walletsModule.actions.restoreWallet = restoreWallet
})

describe('popups/Passkey.vue', () => {
    it('shows the unsupported notice without passkey support', async () => {
        passkeyState.supported = false

        const wrapper = mount(Passkey, { props: { active: true } })
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.text()).toContain('no passkey support')
    })

    it('saves the wallet phrase to a passkey', async () => {
        const wrapper = mount(Passkey, { props: { active: true } })
        await new Promise((r) => setTimeout(r, 20))

        await wrapper.vm.save()
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.vm.state).toBe('saved')
        expect(wrapper.vm.saved).toBe(true)
        expect(displayNotification).toHaveBeenCalled()
    })

    it('reports a save failure', async () => {
        passkeyState.createError = new Error('authenticator refused')

        const wrapper = mount(Passkey, { props: { active: true } })
        await new Promise((r) => setTimeout(r, 20))

        await wrapper.vm.save()

        expect(wrapper.vm.state).toBe('error')
        expect(wrapper.vm.error).toContain('authenticator refused')
    })

    it('unlocks with the passkey and restores the wallet', async () => {
        passkeyState.record = { v: 1, credentialId: 'cred', iv: 'iv', ct: 'ct', createdAt: '2026-01-02T03:04:05.000Z' }

        const wrapper = mount(Passkey, { props: { active: true } })
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.vm.saved).toBe(true)
        expect(wrapper.vm.savedDate).toMatch(/2026/)

        await wrapper.vm.unlock()
        await new Promise((r) => setTimeout(r, 20))

        /* The REAL restoreWallet action runs (facade-resolved), so the
           observable outcome is the restored state + navigation. */
        expect(wrapper.vm.state).toBe('restored')
        expect(getStoreFacade().state.profile.ms).toBeTruthy()

        /* Closing after a restore lands on the dashboard. */
        wrapper.vm.close()
        expect(wrapper.vm.$router.replace).toHaveBeenCalledWith('/dashboard')
    })

    it('reports an unlock failure', async () => {
        passkeyState.record = { v: 1, credentialId: 'cred', iv: 'iv', ct: 'ct' }
        passkeyState.unlockError = new Error('wrong passkey')

        const wrapper = mount(Passkey, { props: { active: true } })
        await new Promise((r) => setTimeout(r, 20))

        await wrapper.vm.unlock()

        expect(wrapper.vm.state).toBe('error')
        expect(wrapper.vm.error).toContain('wrong passkey')
    })

    it('forgets the stored backup', async () => {
        passkeyState.record = { v: 1, credentialId: 'cred', iv: 'iv', ct: 'ct' }

        const wrapper = mount(Passkey, { props: { active: true } })
        await new Promise((r) => setTimeout(r, 20))

        wrapper.vm.forget()

        expect(wrapper.vm.saved).toBe(false)
        expect(passkeyState.record).toBeNull()
    })

    it('refuses to save when the wallet has no seed', async () => {
        getStoreFacade().state.profile.ms = null

        const wrapper = mount(Passkey, { props: { active: true } })
        await new Promise((r) => setTimeout(r, 20))

        await wrapper.vm.save()

        expect(wrapper.vm.state).toBe('error')
        expect(wrapper.vm.error).toContain('No wallet recovery phrase')
    })
})

describe('inputs/Amount.vue', () => {
    it('emits the amount on input', async () => {
        const wrapper = mount(Amount)
        const input = wrapper.find('input')

        await input.setValue('12.5')

        expect(wrapper.emitted('amount-update')).toBeTruthy()
    })

    it('emits the selected unit', async () => {
        const wrapper = mount(Amount)

        wrapper.vm.selectUnit('mBCH')

        expect(wrapper.emitted('unit-update')).toBeTruthy()
    })
})

describe('BlazeBanner.vue', () => {
    it('mounts with the tip address and copies it', async () => {
        document.execCommand = vi.fn(() => true)

        const wrapper = mount(BlazeBanner)
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.vm.emberShort).toBeTruthy()

        wrapper.vm.copyAddress()

        expect(document.execCommand).toHaveBeenCalledWith('copy')
    })

    it('shortens the address', () => {
        const wrapper = mount(BlazeBanner)

        expect(wrapper.vm.emberShort).toContain('…')
    })

    it('tracks the EMBER2026 balance at the donation address', async () => {
        emberState.utxos = [
            { token_data: { amount: '1200' } },
            { token_data: { amount: '34' } },
            { value: 1000 },
        ]

        const wrapper = mount(BlazeBanner)
        await new Promise((r) => setTimeout(r, 20))

        expect(getCluster).toHaveBeenCalledWith('mainnet')
        expect(emberState.getUtxosWithTokens)
            .toHaveBeenCalledWith('bitcoincash:zzhndl6y6a82gp0376meu4t2q0kwh0pxfy85da4574')
        expect(wrapper.vm.emberCount).toBe(1234n)
        expect(wrapper.vm.emberLabel).toBe('1,234')
        expect(wrapper.vm.emberTitle).toBe('Embers received: 1,234')
        expect(wrapper.text()).toContain('Embers received')
        expect(wrapper.text()).toContain('1,234')
    })

    it('keeps the badge honest when tracking fails', async () => {
        emberState.getUtxosWithTokens.mockRejectedValueOnce(new Error('offline'))

        const wrapper = mount(BlazeBanner)
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.vm.emberCount).toBe(null)
        expect(wrapper.vm.emberLabel).toBe('—')
        expect(wrapper.vm.emberTitle).toBe('Ember tracking unavailable')
        expect(wrapper.text()).toContain('Embers received')
    })

    it('refreshes the count on the poll interval', async () => {
        vi.useFakeTimers()
        emberState.utxos = [{ token_data: { amount: '5' } }]

        const wrapper = mount(BlazeBanner)
        await vi.advanceTimersByTimeAsync(0)

        expect(wrapper.vm.emberCount).toBe(5n)

        emberState.utxos = [{ token_data: { amount: '9' } }]
        await vi.advanceTimersByTimeAsync(60000)
        await vi.advanceTimersByTimeAsync(0)

        expect(wrapper.vm.emberCount).toBe(9n)
    })

    it('clears the ember poll on unmount', async () => {
        vi.useFakeTimers()

        const wrapper = mount(BlazeBanner)
        await vi.advanceTimersByTimeAsync(0)

        expect(emberState.getUtxosWithTokens).toHaveBeenCalledTimes(1)

        wrapper.unmount()
        emberState.getUtxosWithTokens.mockClear()

        await vi.advanceTimersByTimeAsync(120000)

        expect(emberState.getUtxosWithTokens).not.toHaveBeenCalled()
    })
})

describe('popups/SeedVault.vue', () => {
    it('renders the phrase words from the master seed', async () => {
        const wrapper = mount(SeedVault, { props: { active: true } })
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.vm.words.length).toBe(24)
        expect(wrapper.vm.mnemonic.split(' ').length).toBe(24)
    })

    it('copies the phrase to the clipboard', async () => {
        const writeText = vi.fn(async () => {})
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

        const wrapper = mount(SeedVault, { props: { active: true } })
        await new Promise((r) => setTimeout(r, 20))

        wrapper.vm.copy()

        expect(writeText).toHaveBeenCalledWith(wrapper.vm.mnemonic)
        expect(wrapper.vm.copied).toBe(true)
    })

    it('has no phrase without a master seed', async () => {
        getStoreFacade().state.profile.ms = null

        const wrapper = mount(SeedVault, { props: { active: true } })
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.vm.mnemonic).toBe('')
        expect(wrapper.vm.words).toEqual([])
    })
})

describe('Animation.vue', () => {
    it('mounts with a default (no) source and cleans up', async () => {
        /* jsdom has no canvas 2D context; lottie probes it on mount. */
        HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
            fillStyle: '',
            fillRect: vi.fn(),
            clearRect: vi.fn(),
        }))

        const wrapper = shallowMount(Animation, { global: { stubs } })
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.exists()).toBe(true)

        wrapper.unmount()
    })
})
