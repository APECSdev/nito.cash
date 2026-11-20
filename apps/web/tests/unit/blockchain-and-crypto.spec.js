/* Unit tests for:
 *   - blockchain/actions/openConn (subscription + incoming-payment handling)
 *   - blockchain/getters/getAccountBalance
 *   - wallets/actions/updateInputs
 *   - the remaining lib/bch/crypto.js helpers (signing, encoders, key export)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import msgpack from 'msgpack-lite'

const { cluster, getClusterMock } = vi.hoisted(() => ({
    cluster: {
        getHistory: vi.fn(),
        verboseGetTransaction: vi.fn(),
        subscribeAddresses: vi.fn(),
        getBalance: vi.fn(),
    },
    getClusterMock: vi.fn(),
}))

vi.mock('@/lib/bch/provider.js', () => ({ getCluster: getClusterMock }))

/* The coins sound is a .wav import — stub the media module. */
vi.mock('@/media/coins.wav', () => ({ default: 'coins.wav' }))

import openConn from '@/store/modules/blockchain/actions/openConn'
import getAccountBalance from '@/store/modules/blockchain/getters/getAccountBalance'
import updateInputs from '@/store/modules/wallets/actions/updateInputs'
import getAccountsByWallet from '@/store/modules/wallets/getters/getAccountsByWallet'
import getDerivationPath from '@/store/modules/wallets/getters/getDerivationPath'
import {
    addressToLockingBytecode,
    buildTransaction,
    bytesToHex,
    derivePath,
    encodeTransactionToHex,
    entropyFromMnemonic,
    estimateByteCount,
    hexToBytes,
    hdNodeFromEntropy,
    mnemonicFromEntropy,
    randomHex,
    seedFromMnemonic,
    signP2pkhInput,
    toCashAddress,
    toPrivateKeyBytes,
    toPublicKeyBytes,
} from '@/lib/bch/crypto.js'

const ENTROPY = 'ab'.repeat(32)
const hdNode = hdNodeFromEntropy(ENTROPY)
const ACCOUNT_BASE = "m/44'/145'/0'"
const OUR_ADDRESS = toCashAddress(derivePath(hdNode, `${ACCOUNT_BASE}/0/0`), 'mainnet')
const RECEIVER = 'bitcoincash:qpv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf'

beforeEach(() => {
    getClusterMock.mockReset()
    getClusterMock.mockResolvedValue(cluster)
    cluster.getHistory.mockReset()
    cluster.verboseGetTransaction.mockReset()
    cluster.subscribeAddresses.mockReset()
    cluster.getBalance.mockReset()
})

describe('blockchain/openConn', () => {
    const makeCtx = () => {
        const dispatch = vi.fn()
        const rootGetters = {
            'profile/getNetwork': 'mainnet',
            'profile/getFlags': { bn: false },
            'wallets/getAddresses': () => [
                { address: OUR_ADDRESS, index: 0, branch: 0 },
            ],
        }

        return { ctx: { dispatch, rootGetters }, dispatch, rootGetters }
    }

    it('subscribes every wallet address', async () => {
        const { ctx } = makeCtx()

        await openConn(ctx)

        expect(cluster.subscribeAddresses).toHaveBeenCalledTimes(1)
        expect(cluster.subscribeAddresses.mock.calls[0][0]).toEqual([OUR_ADDRESS])
    })

    it('notifies on an incoming payment and advances the receive pool', async () => {
        const { ctx, dispatch } = makeCtx()

        await openConn(ctx)

        /* Drive the subscription callback Fulcrum would invoke. */
        const callback = cluster.subscribeAddresses.mock.calls[0][1]

        cluster.getHistory.mockResolvedValue([{ tx_hash: 'aa'.repeat(32) }])
        cluster.verboseGetTransaction.mockResolvedValue({
            vout: [
                { value: 0.0005, scriptPubKey: { addresses: [OUR_ADDRESS] } },
                { value: 0.001, scriptPubKey: { addresses: ['bitcoincash:qother'] } },
            ],
        })

        callback(OUR_ADDRESS)
        await new Promise((r) => setTimeout(r, 60))

        expect(dispatch).toHaveBeenCalledWith(
            'displayNotification',
            expect.stringContaining('Receiving 500 bits'),
            { root: true },
        )
        expect(dispatch).toHaveBeenCalledWith('wallets/nextAccount', 'BCH', { root: true })
        expect(dispatch).toHaveBeenCalledWith('wallets/updateInputs', {
            action: 'add',
            address: OUR_ADDRESS,
            wallet: 'BCH',
        }, { root: true })

        /* The rotated pool is re-subscribed. */
        expect(cluster.subscribeAddresses).toHaveBeenCalledTimes(2)
    })

    it('ignores a duplicate transaction hash', async () => {
        const { ctx, dispatch } = makeCtx()

        await openConn(ctx)
        const callback = cluster.subscribeAddresses.mock.calls[0][1]

        cluster.getHistory.mockResolvedValue([{ tx_hash: 'bb'.repeat(32) }])
        cluster.verboseGetTransaction.mockResolvedValue({ vout: [] })

        callback(OUR_ADDRESS)
        await new Promise((r) => setTimeout(r, 40))
        callback(OUR_ADDRESS)
        await new Promise((r) => setTimeout(r, 40))

        expect(dispatch.mock.calls.filter((c) => c[0] === 'displayNotification').length).toBe(1)
    })

    it('does nothing when the address has no history', async () => {
        const { ctx, dispatch } = makeCtx()

        await openConn(ctx)
        const callback = cluster.subscribeAddresses.mock.calls[0][1]

        cluster.getHistory.mockResolvedValue([])

        callback(OUR_ADDRESS)
        await new Promise((r) => setTimeout(r, 40))

        expect(dispatch).not.toHaveBeenCalled()
    })

    it('spawns a browser notification when enabled in Settings', async () => {
        const { ctx } = makeCtx()
        ctx.rootGetters['profile/getFlags'] = { bn: true }

        const notificationSpy = vi.fn()
        vi.stubGlobal('Notification', Object.assign(notificationSpy, { permission: 'granted' }))

        await openConn(ctx)
        const callback = cluster.subscribeAddresses.mock.calls[0][1]

        cluster.getHistory.mockResolvedValue([{ tx_hash: 'cc'.repeat(32) }])
        cluster.verboseGetTransaction.mockResolvedValue({
            vout: [{ value: 0.001, scriptPubKey: { addresses: [OUR_ADDRESS] } }],
        })

        callback(OUR_ADDRESS)
        await new Promise((r) => setTimeout(r, 60))

        expect(notificationSpy).toHaveBeenCalled()

        vi.unstubAllGlobals()
    })
})

describe('blockchain/getAccountBalance', () => {
    it('returns the confirmed balance (or both, with the flag)', async () => {
        const rootGetters = { 'profile/getNetwork': 'mainnet' }

        cluster.getBalance.mockResolvedValue({ confirmed: 1000, unconfirmed: 250 })

        await expect(getAccountBalance({}, {}, { profile: {} }, rootGetters)(OUR_ADDRESS)).resolves.toBe(1000)
        await expect(getAccountBalance({}, {}, { profile: { useUnconfirmed: true } }, rootGetters)(OUR_ADDRESS))
            .resolves.toBe(1250)
    })

    it('throws when the cluster fails', async () => {
        cluster.getBalance.mockRejectedValue(new Error('offline'))

        await expect(getAccountBalance({}, {}, { profile: {} }, { 'profile/getNetwork': 'mainnet' })(OUR_ADDRESS))
            .rejects.toThrow()
    })
})

describe('wallets/updateInputs', () => {
    const state = { a: msgpack.encode({ BCH: { 0: { s: 'a', u: {} }, 1: { s: 'd', u: {} } } }) }
    const getters = {
        getAccounts: msgpack.decode(Buffer.from(state.a)),
        getDerivationPath: getDerivationPath(),
        getHDNode: hdNode,
    }
    getters.getAccountsByWallet = (w) => getAccountsByWallet(state, getters)(w)

    const rootGetters = { 'profile/getNetwork': 'mainnet' }

    it('marks a matching ACTIVE account as having an input', () => {
        const commit = vi.fn()

        updateInputs({ commit, getters, rootGetters }, {
            wallet: 'BCH',
            action: 'add',
            address: OUR_ADDRESS,
        })

        const accounts = commit.mock.calls.find((c) => c[0] === 'setAccounts')[1]
        expect(accounts.BCH['0'].u['0']).toEqual({ s: 'a' })
        /* The disabled account is untouched. */
        expect(accounts.BCH['1'].u).toEqual({})
    })
})

describe('lib/bch/crypto (remaining helpers)', () => {
    it('hex <-> bytes round-trip and randomHex length', () => {
        expect(bytesToHex(hexToBytes('00ff10'))).toBe('00ff10')
        expect(hexToBytes('00ff')).toEqual(Uint8Array.of(0x00, 0xff))
        expect(randomHex(32)).toHaveLength(64)
    })

    it('mnemonic <-> entropy round-trip', () => {
        const phrase = mnemonicFromEntropy(ENTROPY)

        expect(entropyFromMnemonic(phrase)).toBe(ENTROPY)
        expect(seedFromMnemonic(phrase)).toHaveLength(64)
    })

    it('exports the private/public key bytes for an HD node', () => {
        const node = derivePath(hdNode, `${ACCOUNT_BASE}/0/0`)

        expect(toPrivateKeyBytes(node)).toHaveLength(32)
        expect(toPublicKeyBytes(node)).toHaveLength(33)
    })

    it('addressToLockingBytecode rejects an invalid address', () => {
        const good = addressToLockingBytecode(OUR_ADDRESS)
        expect(good instanceof Uint8Array).toBe(true)

        expect(addressToLockingBytecode('not-an-address')).toBeFalsy()
    })

    it('estimateByteCount grows with the input count', () => {
        const one = estimateByteCount(1, 2)
        const two = estimateByteCount(2, 2)

        expect(one).toBeGreaterThan(0)
        expect(two).toBeGreaterThan(one)
    })

    it('builds, signs and encodes a transaction', async () => {
        const node = derivePath(hdNode, `${ACCOUNT_BASE}/0/0`)

        const inputs = [{
            address: OUR_ADDRESS,
            path: `${ACCOUNT_BASE}/0/0`,
            txid: 'aa'.repeat(32),
            vout: 0,
            satoshis: 100000,
        }]
        const outputs = [{ address: RECEIVER, satoshis: 90000 }]

        const bundle = buildTransaction(inputs, outputs)

        expect(bundle.transaction.inputs).toHaveLength(1)
        expect(bundle.transaction.outputs).toHaveLength(1)
        expect(bundle.sourceOutputs[0].valueSatoshis).toBe(100000n)

        await signP2pkhInput(bundle, 0, toPrivateKeyBytes(node), toPublicKeyBytes(node))

        /* A P2PKH unlock: push(sig|sighash) push(pubkey) — non-empty + growing. */
        expect(bundle.transaction.inputs[0].unlockingBytecode.length).toBeGreaterThan(70)

        const hex = encodeTransactionToHex(bundle.transaction)
        expect(hex).toMatch(/^[0-9a-f]+$/)
        expect(hex.startsWith('01000000')).toBe(true)
    })
})
