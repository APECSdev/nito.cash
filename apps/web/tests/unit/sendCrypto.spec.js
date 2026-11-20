/* Unit tests for wallets/actions/sendCrypto (coin selection, fee handling,
 * change outputs, branch-aware signing paths, broadcast + error paths).
 *
 * The cluster is mocked; the transaction builder/encoder are the REAL
 * libauth-based helpers, and `getSignedInput` is a no-op (the signature is
 * irrelevant to the selection/fee/broadcast logic under test).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import msgpack from 'msgpack-lite'

const { cluster, getClusterMock } = vi.hoisted(() => ({
    cluster: {
        getUtxos: vi.fn(),
        broadcast: vi.fn(),
    },
    getClusterMock: vi.fn(),
}))

vi.mock('@/lib/bch/provider.js', () => ({ getCluster: getClusterMock }))

import sendCrypto from '@/store/modules/wallets/actions/sendCrypto'
import getDerivationPath from '@/store/modules/wallets/getters/getDerivationPath'
import { hdNodeFromEntropy, derivePath, toCashAddress } from '@/lib/bch/crypto.js'

/* A real, valid mainnet CashAddress (the hackathon donation address). */
const RECEIVER = 'bitcoincash:qpv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf'

const ENTROPY = 'ab'.repeat(32)
const hdNode = hdNodeFromEntropy(ENTROPY)
const ACCOUNT_BASE = "m/44'/145'/0'"

const branchAddress = (branch, index) => toCashAddress(derivePath(hdNode, `${ACCOUNT_BASE}/${branch}/${index}`), 'mainnet')

/* Build the action context. */
const makeCtx = ({ utxosByAddress = {}, changeAddress = branchAddress(0, 2) } = {}) => {
    const dispatch = vi.fn()
    const signedPaths = []

    const getters = {
        getHDNode: hdNode,
        getDerivationPath: getDerivationPath(),
        getAddresses: () => [
            { address: branchAddress(0, 0), index: 0, branch: 0 },
            { address: branchAddress(0, 1), index: 1, branch: 0 },
            { address: branchAddress(1, 0), index: 0, branch: 1 },
        ],
        getChangeAddress: () => changeAddress,
        getSignedInput: vi.fn(async (_bundle, _node, _index, input) => {
            signedPaths.push(input.path)
        }),
    }

    const rootGetters = { 'profile/getNetwork': 'mainnet' }

    cluster.getUtxos.mockImplementation(async (address) => utxosByAddress[address] || [])

    return { ctx: { dispatch, getters, rootGetters }, dispatch, getters, signedPaths }
}

const utxo = (hash, value, pos = 0) => ({ tx_hash: hash, tx_pos: pos, value, height: 1 })

beforeEach(() => {
    getClusterMock.mockReset()
    getClusterMock.mockResolvedValue(cluster)
    cluster.getUtxos.mockReset()
    cluster.broadcast.mockReset()
    cluster.broadcast.mockResolvedValue('txid-ok')
})

describe('wallets/sendCrypto', () => {
    it('rejects an invalid receiver address (after warning)', async () => {
        const { ctx, dispatch } = makeCtx()

        await expect(sendCrypto(ctx, { receiver: 'nope', amount: 1000, unit: 'satoshis' }))
            .rejects.toThrow(/Invalid receiver address/)

        expect(dispatch).toHaveBeenCalledWith('displayError', expect.any(Error), { root: true })
    })

    it('rejects a missing amount', async () => {
        const { ctx } = makeCtx()

        await expect(sendCrypto(ctx, { receiver: RECEIVER, amount: 0, unit: 'satoshis' }))
            .rejects.toThrow(/Enter an amount/)
    })

    it('rejects when the wallet has no UTXOs', async () => {
        const { ctx } = makeCtx()

        await expect(sendCrypto(ctx, { receiver: RECEIVER, amount: 1000, unit: 'satoshis' }))
            .rejects.toThrow(/NO money/)
    })

    it('rejects an unsupported unit', async () => {
        const { ctx } = makeCtx({ utxosByAddress: { [branchAddress(0, 0)]: [utxo('aa', 100000)] } })

        await expect(sendCrypto(ctx, { receiver: RECEIVER, amount: 10, unit: 'dollars' }))
            .rejects.toThrow(/Unsupported amount unit/)
    })

    it('rejects an amount below dust', async () => {
        const { ctx } = makeCtx({ utxosByAddress: { [branchAddress(0, 0)]: [utxo('aa', 100000)] } })

        await expect(sendCrypto(ctx, { receiver: RECEIVER, amount: 100, unit: 'satoshis' }))
            .rejects.toThrow(/too small/)
    })

    it('rejects an amount the balance cannot cover', async () => {
        const { ctx } = makeCtx({ utxosByAddress: { [branchAddress(0, 0)]: [utxo('aa', 5000)] } })

        await expect(sendCrypto(ctx, { receiver: RECEIVER, amount: 5000, unit: 'satoshis' }))
            .rejects.toThrow(/Insufficient balance/)
    })

    it('sends, broadcasts and updates the account pool (change path)', async () => {
        const { ctx, dispatch, signedPaths } = makeCtx({
            utxosByAddress: { [branchAddress(0, 0)]: [utxo('aa'.repeat(32), 100000)] },
        })

        await sendCrypto(ctx, { receiver: RECEIVER, amount: 1000, unit: 'satoshis' })

        expect(cluster.broadcast).toHaveBeenCalledTimes(1)
        expect(cluster.broadcast.mock.calls[0][0]).toMatch(/^[0-9a-f]+$/)

        /* Change output => nextAccount first, then the disable update. */
        expect(dispatch).toHaveBeenCalledWith('nextAccount', 'BCH')
        expect(dispatch).toHaveBeenCalledWith('updateAccounts', {
            action: 'disable',
            indexes: [0],
            wallet: 'BCH',
        })
        expect(dispatch).toHaveBeenCalledWith('displayNotification', 'Sent successfully!', { root: true })

        /* Branch-0 input signs from the branch-0 path. */
        expect(signedPaths).toEqual([`${ACCOUNT_BASE}/0/0`])
    })

    it('converts bits / mBCH / BCH units to satoshis', async () => {
        for (const [unit, amount] of [['bits', 10], ['mBCH', 0.01], ['BCH', 0.00001]]) {
            cluster.broadcast.mockClear()

            const { ctx } = makeCtx({
                utxosByAddress: { [branchAddress(0, 0)]: [utxo('bb'.repeat(32), 100000)] },
            })

            await sendCrypto(ctx, { receiver: RECEIVER, amount, unit })

            /* 10 bits = 0.01 mBCH = 0.00001 BCH = 1000 sats. */
            expect(cluster.broadcast).toHaveBeenCalledTimes(1)
        }
    })

    it('signs a DISCOVERED branch-1 input with the change-chain path', async () => {
        const { ctx, signedPaths } = makeCtx({
            utxosByAddress: { [branchAddress(1, 0)]: [utxo('cc'.repeat(32), 100000)] },
        })

        await sendCrypto(ctx, { receiver: RECEIVER, amount: 1000, unit: 'satoshis' })

        expect(signedPaths).toEqual([`${ACCOUNT_BASE}/1/0`])
    })

    it('pulls a SECOND input when the first cannot cover amount + fee', async () => {
        const { ctx, signedPaths } = makeCtx({
            utxosByAddress: {
                /* 1600 sats cannot cover 1500 + the ~226-byte fee. */
                [branchAddress(0, 0)]: [utxo('dd'.repeat(32), 1600)],
                [branchAddress(0, 1)]: [utxo('ee'.repeat(32), 100000)],
            },
        })

        await sendCrypto(ctx, { receiver: RECEIVER, amount: 1500, unit: 'satoshis' })

        expect(signedPaths.length).toBe(2)
        expect(cluster.broadcast).toHaveBeenCalledTimes(1)
    })

    it('warns and rejects when the broadcast fails', async () => {
        const { ctx, dispatch } = makeCtx({
            utxosByAddress: { [branchAddress(0, 0)]: [utxo('ff'.repeat(32), 100000)] },
        })

        cluster.broadcast.mockRejectedValue(new Error('mempool full'))

        await expect(sendCrypto(ctx, { receiver: RECEIVER, amount: 1000, unit: 'satoshis' }))
            .rejects.toThrow(/mempool full/)

        expect(dispatch).toHaveBeenCalledWith('displayError', expect.any(Error), { root: true })
    })

    it('rewrites an insufficient-priority rejection into a friendly message', async () => {
        const { ctx, dispatch } = makeCtx({
            utxosByAddress: { [branchAddress(0, 0)]: [utxo('11'.repeat(32), 100000)] },
        })

        cluster.broadcast.mockRejectedValue(new Error('insufficient priority'))

        await expect(sendCrypto(ctx, { receiver: RECEIVER, amount: 1000, unit: 'satoshis' }))
            .rejects.toThrow(/low network fees/)

        expect(dispatch).toHaveBeenCalledWith('displayError', expect.any(Error), { root: true })
    })
})
