/* WizardConnect: render states + the chain-node / UTXO-scan fallbacks.
 * (The payment path itself is covered by wizard-connect-pay.spec.js.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'

const { wc, manager, cluster } = vi.hoisted(() => ({
    wc: { state: 'idle', error: null, uri: 'wizardconnect://abc', walletName: 'Cashonize' },
    manager: {
        hasPath: vi.fn(() => true),
        getXpubNode: vi.fn(),
        getSessionPaths: vi.fn(() => []),
        signTransaction: vi.fn(),
    },
    cluster: { request: vi.fn() },
}))

vi.mock('@paytaca/wizardconnect-vue', async () => {
    const { ref } = await import('vue')

    return {
        useWizardConnect: () => ({
            state: ref(wc.state),
            manager: ref(manager),
            uri: ref(wc.uri),
            qrUri: ref(wc.uri),
            walletName: ref(wc.walletName),
            connect: vi.fn(),
            disconnect: vi.fn(),
            error: ref(wc.error),
        }),
        AlphanumericQRCode: { name: 'AlphanumericQRCode', template: '<div />' },
    }
})

/* The path-name / positional fallbacks decode the session xpubs. */
vi.mock('@bitauth/libauth', async (importOriginal) => {
    const actual = await importOriginal()

    return {
        ...actual,
        decodeHdPublicKey: vi.fn(() => ({
            node: { publicKey: new Uint8Array(33), chainCode: new Uint8Array(32) },
        })),
    }
})

vi.mock('@wizardconnect/core/hdwalletv1-serialize', () => ({
    transactionToHex: () => 'hex',
}))

vi.mock('@/lib/bch/provider', () => ({ getCluster: vi.fn(async () => cluster) }))

vi.mock('@/lib/bch/external-wallet', () => ({
    parseBchToSats: (v) => BigInt(Math.round(Number(v) * 1e8)),
    parseRecipientAddress: vi.fn(async () => ({ lockingBytecode: new Uint8Array(25) })),
    fetchFeeSats: vi.fn(async () => 300n),
    selectCoins: vi.fn((funded, target) => ({ chosen: funded, sum: funded.reduce((a, u) => a + BigInt(u.value), 0n) })),
    fetchSourceOutputs: vi.fn(async () => []),
    buildPaymentTransaction: vi.fn(() => ({
        transaction: { inputs: [{}], outputs: [{}], version: 1, locktime: 0 },
        change: 0n,
    })),
    deriveChainAddress: vi.fn((node, index) => ({ address: `bitcoincash:q${index}`, lockingBytecode: new Uint8Array(25) })),
    signedTxidFromHex: vi.fn(() => 'txid'),
    sourceOutputToWire: vi.fn((s) => s),
}))

import WizardConnect from '@/components/popups/WizardConnect.vue'

const mount = () => shallowMount(WizardConnect, {
    props: { active: true },
    global: { stubs: { teleport: true, Animation: true } },
})

beforeEach(() => {
    wc.state = 'idle'
    wc.error = null
    manager.getXpubNode.mockReset()
    manager.getSessionPaths.mockReset()
    manager.getSessionPaths.mockReturnValue([])
    cluster.request.mockReset()
    cluster.request.mockResolvedValue([])
    manager.signTransaction.mockReset()
    manager.signTransaction.mockResolvedValue({ signedTransactionHash: 'txid', signedTransaction: 'hex' })
})

describe('WizardConnect render states', () => {
    it('shows the QR + URI while idle', async () => {
        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.text()).toContain('Generate a new connection QR')
        expect(wrapper.text()).toContain('Connection URI')
    })

    it('shows the reconnecting hint', async () => {
        wc.state = 'reconnecting'

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.text()).toContain('Reconnecting')
    })

    it('shows the payment surface while connected', async () => {
        wc.state = 'connected'

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.find('#wc-recipient').exists()).toBe(true)
        expect(wrapper.text()).toContain('Send via wallet')
    })

    it('shows the sent state when a txid is present', async () => {
        wc.state = 'connected'

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 20))

        wrapper.vm.txid = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
        await new Promise((r) => setTimeout(r, 20))

        expect(wrapper.text()).toContain('Sent ✓')
    })
})

describe('WizardConnect chain-node fallbacks', () => {
    it('falls back to the named session paths when getXpubNode is unusable', async () => {
        /* Direct node unusable -> named-path heuristic -> positional. */
        manager.getXpubNode.mockReturnValue(undefined)
        manager.getSessionPaths.mockReturnValue([
            { name: 'receive/0', xpub: 'xpub-a' },
            { name: 'change/1', xpub: 'xpub-b' },
        ])

        cluster.request.mockResolvedValue([{ tx_hash: 'aa'.repeat(32), tx_pos: 0, value: 100000 }])

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 20))

        await wrapper.vm.pay()

        /* The scan reached the cluster for both chains. */
        expect(cluster.request).toHaveBeenCalled()
        expect(wrapper.vm.error).toBe('')
    })

    it('retries the UTXO scan without the token filter when the server rejects it', async () => {
        manager.getXpubNode.mockReturnValue({ publicKey: new Uint8Array(33), chainCode: new Uint8Array(32) })

        let first = true
        cluster.request.mockImplementation(async () => {
            if (first) {
                first = false
                throw new Error('Invalid token filtering option')
            }

            return [{ tx_hash: 'aa'.repeat(32), tx_pos: 0, value: 100000 }]
        })

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 20))

        await wrapper.vm.pay()

        expect(wrapper.vm.error).toBe('')
        expect(wrapper.vm.txid).toBe('txid')
    })

    it('skips token-bearing and zero-value UTXOs, and tolerates object shapes', async () => {
        manager.getXpubNode.mockReturnValue({ publicKey: new Uint8Array(33), chainCode: new Uint8Array(32) })

        cluster.request.mockResolvedValue({
            outputs: [
                { tx_hash: 'bb'.repeat(32), tx_pos: 0, value: 50000, token: { category: 'x' } },
                { tx_hash: 'cc'.repeat(32), tx_pos: 1, value: 0 },
                { tx_hash: 'dd'.repeat(32), tx_pos: 2, value: 100000 },
            ],
        })

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 20))

        await wrapper.vm.pay()

        expect(wrapper.vm.error).toBe('')
        expect(wrapper.vm.txid).toBe('txid')
    })

    it('reports an error when the change chain cannot be resolved', async () => {
        /* Receive chain derivable, change chain NOT. */
        manager.getXpubNode.mockImplementation((index) => (
            index === 0 ? { publicKey: new Uint8Array(33), chainCode: new Uint8Array(32) } : undefined
        ))
        manager.getSessionPaths.mockReturnValue([])

        cluster.request.mockResolvedValue([{ tx_hash: 'ee'.repeat(32), tx_pos: 0, value: 100000 }])

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 20))

        await wrapper.vm.pay()

        expect(wrapper.vm.error).toContain('change-path data is unavailable')
    })
})

