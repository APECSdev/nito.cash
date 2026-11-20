/* Unit tests for the WizardConnect modal's PAYMENT path (setup()-returned
 * pay / copyUri / close), plus the pay() failure branches.
 *
 * The composable, the relay-serialization core and the external-wallet
 * helpers are mocked, so the dapp-side transaction assembly (UTXO scan ->
 * fee -> coin selection -> sign request -> txid) runs deterministically.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { ref } from 'vue'

/* ---- mutable test state (hoisted so the mocks can read it) ---- */
const { wcState, manager, cluster } = vi.hoisted(() => ({
    wcState: { v: 'connected' },
    manager: {
        hasPath: vi.fn(() => true),
        getXpubNode: vi.fn(() => ({ publicKey: new Uint8Array(33), chainCode: new Uint8Array(32) })),
        getSessionPaths: vi.fn(() => []),
        signTransaction: vi.fn(),
    },
    cluster: {
        request: vi.fn(),
        getUtxos: vi.fn(),
    },
}))

vi.mock('@paytaca/wizardconnect-vue', async () => {
    const { ref: vueRef } = await import('vue')

    return {
        useWizardConnect: () => ({
            state: vueRef(wcState.v),
            manager: vueRef(manager),
            uri: vueRef('wizardconnect://abc'),
            qrUri: vueRef('wizardconnect://abc'),
            walletName: vueRef('Cashonize'),
            connect: vi.fn(),
            disconnect: vi.fn(),
            error: vueRef(undefined),
        }),
        AlphanumericQRCode: { name: 'AlphanumericQRCode', template: '<div />' },
    }
})

vi.mock('@wizardconnect/core/hdwalletv1-serialize', () => ({
    transactionToHex: () => 'unsignedhex',
    decodeHdPublicKey: vi.fn(() => ({ publicKey: new Uint8Array(33), chainCode: new Uint8Array(32) })),
}))

vi.mock('@/lib/bch/provider', () => ({ getCluster: vi.fn(async () => cluster) }))

vi.mock('@/lib/bch/external-wallet', () => ({
    parseBchToSats: (v) => BigInt(Math.round(Number(v) * 1e8)),
    parseRecipientAddress: vi.fn(async () => ({ lockingBytecode: new Uint8Array(25) })),
    fetchFeeSats: vi.fn(async () => 300n),
    selectCoins: vi.fn((funded, target) => {
        const chosen = []
        let sum = 0n
        for (const u of funded) {
            chosen.push(u)
            sum += BigInt(u.value)
            if (sum >= target) break
        }

        return { chosen, sum }
    }),
    fetchSourceOutputs: vi.fn(async () => [{ tx_hash: 'aa', tx_pos: 0, value: 100000 }]),
    buildPaymentTransaction: vi.fn(() => ({
        transaction: { inputs: [{}], outputs: [{}, {}], version: 1, locktime: 0 },
        change: 5000n,
    })),
    deriveChainAddress: vi.fn((node, index) => ({ address: `bitcoincash:qaddr${index}`, lockingBytecode: new Uint8Array(25) })),
    signedTxidFromHex: vi.fn(() => 'computed-txid'),
    sourceOutputToWire: vi.fn((s) => s),
}))

import WizardConnect from '@/components/popups/WizardConnect.vue'

const mount = () => shallowMount(WizardConnect, {
    props: { active: true },
    global: { stubs: { teleport: true, Animation: true } },
})

/* A funded plain-BCH UTXO for the scan. */
const fundedUtxo = { tx_hash: 'aa'.repeat(32), tx_pos: 0, value: 100000 }

beforeEach(() => {
    wcState.v = 'connected'
    manager.signTransaction.mockReset()
    manager.signTransaction.mockResolvedValue({ signedTransactionHash: 'wallet-txid', signedTransaction: 'hex' })
    manager.hasPath.mockReset()
    manager.hasPath.mockReturnValue(true)

    cluster.request.mockReset()
    /* The scan covers 2 chains x 20 indexes — only index 0 of the receive
       chain is funded (the mock must NOT answer for every address). */
    cluster.request.mockImplementation(async (_method, address) => (
        address === 'bitcoincash:qaddr0' ? [fundedUtxo] : []
    ))
})

describe('WizardConnect payment', () => {
    it('assembles and signs a payment, then records the txid', async () => {
        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 30))

        await wrapper.vm.pay()
        await new Promise((r) => setTimeout(r, 30))

        expect(wrapper.vm.error).toBe('')
        expect(wrapper.vm.txid).toBe('wallet-txid')
        expect(wrapper.vm.feeDisplay).toContain('BCH')
        expect(wrapper.vm.payFromAddress).toBeTruthy()
        expect(manager.signTransaction).toHaveBeenCalledTimes(1)
        expect(wrapper.vm.busy).toBe(false)
    })

    it('computes the txid from the signed hex when the wallet omits the hash', async () => {
        manager.signTransaction.mockResolvedValue({ signedTransaction: 'hex' })

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 30))

        await wrapper.vm.pay()

        expect(wrapper.vm.txid).toBe('computed-txid')
    })

    it('errors when the wallet xpubs are not available', async () => {
        manager.hasPath.mockReturnValue(false)

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 30))

        await wrapper.vm.pay()

        expect(wrapper.vm.error).toContain('xpubs are not available')
    })

    it('errors when the wallet has no BCH UTXOs', async () => {
        cluster.request.mockResolvedValue([])

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 30))

        await wrapper.vm.pay()

        expect(wrapper.vm.error).toContain('No BCH UTXOs found')
    })

    it('errors when the balance cannot cover amount + fee', async () => {
        cluster.request.mockImplementation(async (_method, address) => (
            address === 'bitcoincash:qaddr0' ? [{ ...fundedUtxo, value: 1000 }] : []
        ))

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 30))

        await wrapper.vm.pay()
        expect(wrapper.vm.error).toContain('Not enough BCH')
    })

    it('surfaces a wallet signing failure', async () => {
        manager.signTransaction.mockRejectedValue(new Error('user rejected'))

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 30))

        await wrapper.vm.pay()

        expect(wrapper.vm.error).toContain('user rejected')
        expect(wrapper.vm.busy).toBe(false)
    })

    it('retries ONCE when the relay publish raced a reconnect', async () => {
        manager.signTransaction
            .mockRejectedValueOnce(new Error('Failed to publish'))
            .mockResolvedValueOnce({ signedTransactionHash: 'retry-txid', signedTransaction: 'hex' })

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 30))

        /* Skip the real 2.5s backoff. */
        vi.useFakeTimers({ shouldAdvanceTime: true })
        const pending = wrapper.vm.pay()
        await vi.advanceTimersByTimeAsync(3000)
        await pending
        vi.useRealTimers()

        expect(manager.signTransaction).toHaveBeenCalledTimes(2)
        expect(wrapper.vm.txid).toBe('retry-txid')
    })

    it('copies the connection URI', async () => {
        const writeText = vi.fn(async () => {})
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 30))

        wrapper.vm.copyUri()
        await new Promise((r) => setTimeout(r, 20))

        expect(writeText).toHaveBeenCalledWith('wizardconnect://abc')
        expect(wrapper.vm.copiedUri).toBe(true)
    })

    it('closes the session and notifies the parent', async () => {
        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 30))

        wrapper.vm.close()

        expect(wrapper.emitted('close-wizard-connect')).toBeTruthy()
    })

    it('builds the explorer link from the txid', async () => {
        const wrapper = mount()
        await new Promise((r) => setTimeout(r, 30))

        wrapper.vm.txid = 'abc123'

        expect(wrapper.vm.explorerUrl).toBe('https://chaingraph.cash/tx/abc123')
    })
})
