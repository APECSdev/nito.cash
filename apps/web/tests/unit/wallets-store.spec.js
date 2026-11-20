/* Unit tests for the wallets store (getters + actions + mutations).
 *
 * Covers the pieces added/changed by the change-chain discovery work:
 * getAddresses (BOTH branches), getChangeIndexes/setChangeIndexes,
 * getAddress/getChangeAddress/getHDNode/getDerivationPath/getDustAmount,
 * restoreWallet (dual-branch discovery), initWallet (branch-1 backfill),
 * and the small account mutations.
 */
import msgpack from 'msgpack-lite'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* ---- mocks (must be hoisted above the imports they affect) ---- */
const { scanBranchMock, getClusterMock } = vi.hoisted(() => ({
    scanBranchMock: vi.fn(),
    getClusterMock: vi.fn(),
}))

vi.mock('@/lib/bch/discovery.js', () => ({ scanBranch: scanBranchMock }))
vi.mock('@/lib/bch/provider.js', () => ({ getCluster: getClusterMock }))

import getAccounts from '@/store/modules/wallets/getters/getAccounts'
import getAccountsByWallet from '@/store/modules/wallets/getters/getAccountsByWallet'
import getAddress from '@/store/modules/wallets/getters/getAddress'
import getAddresses from '@/store/modules/wallets/getters/getAddresses'
import getChangeAddress from '@/store/modules/wallets/getters/getChangeAddress'
import getChangeIndexes from '@/store/modules/wallets/getters/getChangeIndexes'
import getDerivationPath from '@/store/modules/wallets/getters/getDerivationPath'
import getDustAmount from '@/store/modules/wallets/getters/getDustAmount'
import getHDNode from '@/store/modules/wallets/getters/getHDNode'
import getTokenBalance from '@/store/modules/wallets/getters/getTokenBalance'

import restoreWallet from '@/store/modules/wallets/actions/restoreWallet'
import initWallet from '@/store/modules/wallets/actions/initWallet'
import createWallet from '@/store/modules/wallets/actions/createWallet'
import destroyWallet from '@/store/modules/wallets/actions/destroyWallet'
import nextAccount from '@/store/modules/wallets/actions/nextAccount'
import addImportedSeed from '@/store/modules/wallets/actions/addImportedSeed'
import activateAccounts from '@/store/modules/wallets/actions/activateAccounts'
import activateInputs from '@/store/modules/wallets/actions/activateInputs'
import updateAccounts from '@/store/modules/wallets/actions/updateAccounts'

import setAccounts from '@/store/modules/wallets/mutations/setAccounts'
import setChangeIndexes from '@/store/modules/wallets/mutations/setChangeIndexes'
import setEmptyWallet from '@/store/modules/wallets/mutations/setEmptyWallet'
import setImportedSeeds from '@/store/modules/wallets/mutations/setImportedSeeds'
import setMetadata from '@/store/modules/wallets/mutations/setMetadata'

import { hdNodeFromEntropy, derivePath, toCashAddress } from '@/lib/bch/crypto.js'

/* Deterministic 32-byte entropy + the wallet model helpers. */
const ENTROPY = 'ab'.repeat(32)
const ACCOUNT_BASE = "m/44'/145'/0'"

const accountsModel = (indexes) => {
    const model = { BCH: {}, ETH: { 0: { s: 'a' } }, SLP: { 0: { s: 'a', u: {} } } }
    indexes.forEach((i) => { model.BCH[i] = { s: 'a', u: {} } })
    return model
}

/* A getters bag wired to real crypto, as the live store provides it. */
const makeGetters = (state, overrides = {}) => {
    const getters = {
        /* NOTE: getAccounts is a VALUE getter in the real store (the decoded
           accounts object), not a function. */
        getAccounts: state.a ? msgpack.decode(Buffer.from(state.a)) : null,
        /* The derivation-path getter is a CURRIED getter. */
        getDerivationPath: getDerivationPath(),
        getHDNode: hdNodeFromEntropy(ENTROPY),
        /* Curried getter — bound to this state. */
        getChangeIndexes: (w) => getChangeIndexes(state, {}, {}, rootGetters)(w),
        ...overrides,
    }
    getters.getAccountsByWallet = (w) => getAccountsByWallet(state, getters)(w)
    getters.getAddresses = (w) => getAddresses(state, getters, {}, rootGetters)(w)
    return getters
}

const rootGetters = {
    'profile/getNetwork': 'mainnet',
    'profile/getMasterSeed': ENTROPY,
    'profile/getLocale': 'en-US',
}

beforeEach(() => {
    scanBranchMock.mockReset()
    getClusterMock.mockReset()
    getClusterMock.mockResolvedValue({ fake: 'cluster' })
})

describe('wallets/getters', () => {
    it('derives branch-0 addresses AND discovered branch-1 change addresses', () => {
        const state = {
            a: msgpack.encode(accountsModel([0, 1])),
            c: msgpack.encode({ BCH: [0, 1, 2] }),
        }
        const getters = makeGetters(state)

        const addresses = getAddresses(state, getters, {}, rootGetters)('BCH')

        const branch0 = addresses.filter((a) => a.branch === 0)
        const branch1 = addresses.filter((a) => a.branch === 1)

        expect(branch0.map((a) => a.index)).toEqual(['0', '1'])
        expect(branch1.map((a) => a.index)).toEqual([0, 1, 2])

        /* The derived addresses must match an independent derivation. */
        const node = hdNodeFromEntropy(ENTROPY)
        expect(branch0[0].address).toBe(toCashAddress(derivePath(node, `${ACCOUNT_BASE}/0/0`), 'mainnet'))
        expect(branch1[1].address).toBe(toCashAddress(derivePath(node, `${ACCOUNT_BASE}/1/1`), 'mainnet'))
    })

    it('returns null when the wallet has no accounts', () => {
        const state = { a: null }
        const getters = makeGetters(state)

        expect(getAddresses(state, getters, {}, rootGetters)('BCH')).toBeNull()
    })

    it('getChangeIndexes decodes the msgpack pool and tolerates junk', () => {
        const good = { c: msgpack.encode({ BCH: [0, 1] }) }
        expect(getChangeIndexes(good, {}, {}, rootGetters)('BCH')).toEqual([0, 1])

        expect(getChangeIndexes({ c: null }, {}, {}, rootGetters)('BCH')).toEqual([])

        /* Corrupt payload. */
        expect(getChangeIndexes({ c: Buffer.from([0xff, 0xff]) }, {}, {}, rootGetters)('BCH')).toEqual([])

        /* Wallet not present in the payload. */
        const other = { c: msgpack.encode({ ETH: [0] }) }
        expect(getChangeIndexes(other, {}, {}, rootGetters)('BCH')).toEqual([])
    })

    it('getAddress returns the LAST active account address', () => {
        const state = { a: msgpack.encode(accountsModel([0, 1, 2])) }
        const getters = makeGetters(state)

        const address = getAddress(state, getters, {}, rootGetters)('BCH')

        expect(address).toBe(toCashAddress(derivePath(hdNodeFromEntropy(ENTROPY), `${ACCOUNT_BASE}/0/2`), 'mainnet'))

        /* No accounts -> null (fresh getters for the empty state). */
        const emptyState = { a: null }
        expect(getAddress(emptyState, makeGetters(emptyState), {}, rootGetters)('BCH')).toBeNull()
    })

    it('getChangeAddress uses the NEXT branch-0 index and grows the pool', () => {
        const state = { a: msgpack.encode(accountsModel([0, 1])) }
        const getters = makeGetters(state)

        const change = getChangeAddress(state, getters, {}, rootGetters)('BCH')

        expect(change).toBe(toCashAddress(derivePath(hdNodeFromEntropy(ENTROPY), `${ACCOUNT_BASE}/0/2`), 'mainnet'))
        expect(getChangeAddress({ a: null }, getters, {}, rootGetters)('BCH')).toBeNull()
    })

    it('getHDNode needs a master seed', () => {
        const withSeed = getHDNode({}, {}, {}, rootGetters)
        expect(withSeed).toBeTruthy()

        expect(() => getHDNode({}, {}, {}, { 'profile/getMasterSeed': null, 'profile/getLocale': 'en-US' })).toThrow()
    })

    it('getDerivationPath maps each wallet to its BIP44 coin type', () => {
        expect(getDerivationPath()('BCH')).toBe("m/44'/145'/0'/0")
        expect(getDerivationPath()('ETH')).toBe("m/44'/60'/0'/0")
        expect(getDerivationPath()('SLP')).toBe("m/44'/245'/0'/0")
    })

    it('getDustAmount is the 546-sat dust threshold', () => {
        expect(getDustAmount()).toBe(546)
    })

    it('getTokenBalance sums token amounts across BOTH chains', async () => {
        const state = {
            a: msgpack.encode(accountsModel([0])),
            c: msgpack.encode({ BCH: [0] }),
        }
        const getters = makeGetters(state)

        const cluster = {
            getUtxosWithTokens: vi.fn(async (address) => (
                address === toCashAddress(derivePath(hdNodeFromEntropy(ENTROPY), `${ACCOUNT_BASE}/1/0`), 'mainnet')
                    ? [{ token_data: { category: 'aa', amount: '300' } }]
                    : [{ token_data: { category: 'aa', amount: '200' } }]
            )),
        }
        getClusterMock.mockResolvedValue(cluster)

        const total = await getTokenBalance(state, getters, {}, rootGetters)('BCH', 'aa')

        expect(total).toBe(500n)
        expect(cluster.getUtxosWithTokens).toHaveBeenCalledTimes(2)
    })

    it('getTokenBalance returns null (not 0) when the cluster fails', async () => {
        const state = { a: msgpack.encode(accountsModel([0])), c: msgpack.encode({ BCH: [] }) }
        const getters = makeGetters(state)

        getClusterMock.mockRejectedValue(new Error('offline'))

        await expect(getTokenBalance(state, getters, {}, rootGetters)('BCH', 'aa')).resolves.toBeNull()
    })

    it('getTokenBalance is 0n without accounts', async () => {
        const state = { a: null }
        const getters = makeGetters(state)

        await expect(getTokenBalance(state, getters, {}, rootGetters)('BCH', 'aa')).resolves.toBe(0n)
    })
})

describe('wallets/actions', () => {
    it('restoreWallet scans BOTH branches and commits the discovered pools', async () => {
        const commit = vi.fn()
        const dispatch = vi.fn()
        const state = { a: null, c: null }

        /* Receiving chain used through index 2; change chain through index 1. */
        scanBranchMock.mockImplementation(async ({ branch }) => (branch === 0 ? 2 : 1))

        const getters = makeGetters(state)

        const entropy = await restoreWallet(
            { state, getters, rootGetters, commit, dispatch },
            'airport very blue major step trumpet various same ride legend hunt game butter cake bargain area pave lonely few sick erode tank cinnamon private',
        )

        expect(entropy).toBeTruthy()
        expect(scanBranchMock).toHaveBeenCalledTimes(2)
        expect(scanBranchMock.mock.calls.map((c) => c[0].branch)).toEqual([0, 1])

        /* Accounts: 0..lastUsed0+1 = 0,1,2,3 */
        const accountsCommit = commit.mock.calls.find((c) => c[0] === 'setAccounts')
        expect(Object.keys(accountsCommit[1].BCH)).toEqual(['0', '1', '2', '3'])

        /* Change indexes: 0..lastUsed1+1 = 0,1,2 */
        const changeCommit = commit.mock.calls.find((c) => c[0] === 'setChangeIndexes')
        expect(changeCommit[1]).toEqual({ BCH: [0, 1, 2] })

        /* The restored seed is written to the profile. */
        expect(dispatch).toHaveBeenCalledWith('profile/updateMasterSeed', entropy, { root: true })
    })

    it('restoreWallet rejects an invalid phrase before touching state', async () => {
        const commit = vi.fn()
        const dispatch = vi.fn()

        await expect(restoreWallet(
            { state: {}, getters: {}, rootGetters, commit, dispatch },
            'not a valid phrase',
        )).rejects.toThrow()

        expect(commit).not.toHaveBeenCalled()
        expect(dispatch).not.toHaveBeenCalled()
    })

    it('initWallet is a no-op when no wallet exists', async () => {
        const commit = vi.fn()

        await initWallet({ state: { a: null, c: null }, getters: {}, rootGetters, commit })

        expect(commit).not.toHaveBeenCalled()
        expect(scanBranchMock).not.toHaveBeenCalled()
    })

    it('initWallet is a no-op when the change chain was already scanned', async () => {
        const commit = vi.fn()

        await initWallet({ state: { a: 'x', c: 'y' }, getters: {}, rootGetters, commit })

        expect(commit).not.toHaveBeenCalled()
        expect(scanBranchMock).not.toHaveBeenCalled()
    })

    it('initWallet backfills branch 1 for a pre-discovery wallet', async () => {
        const commit = vi.fn()
        const state = { a: msgpack.encode(accountsModel([0])), c: null }
        const getters = makeGetters(state)

        scanBranchMock.mockResolvedValue(1)

        await initWallet({ state, getters, rootGetters, commit })

        expect(scanBranchMock).toHaveBeenCalledTimes(1)
        expect(scanBranchMock.mock.calls[0][0].branch).toBe(1)
        expect(commit).toHaveBeenCalledWith('setChangeIndexes', { BCH: [0, 1, 2] })
    })

    it('initWallet survives a failed cluster (retries next boot)', async () => {
        const commit = vi.fn()
        const state = { a: msgpack.encode(accountsModel([0])), c: null }
        const getters = makeGetters(state)

        getClusterMock.mockRejectedValue(new Error('offline'))

        await expect(initWallet({ state, getters, rootGetters, commit })).resolves.toBeUndefined()
        expect(commit).not.toHaveBeenCalled()
    })

    it('createWallet commits a fresh index-0 account model', () => {
        const commit = vi.fn()

        createWallet({ commit })

        const accounts = commit.mock.calls.find((c) => c[0] === 'setAccounts')[1]
        expect(Object.keys(accounts.BCH)).toEqual(['0'])
    })

    it('destroyWallet empties the wallet', () => {
        const commit = vi.fn()

        destroyWallet({ commit })

        expect(commit).toHaveBeenCalledWith('setEmptyWallet')
    })

    it('nextAccount increments the active account index', () => {
        const commit = vi.fn()
        const state = { a: msgpack.encode(accountsModel([0, 1])) }

        nextAccount({ commit, state }, 'BCH')

        const accounts = commit.mock.calls.find((c) => c[0] === 'setAccounts')[1]
        expect(Object.keys(accounts.BCH)).toEqual(['0', '1', '2'])
    })

    it('addImportedSeed stores a seed once (duplicates ignored)', () => {
        const commit = vi.fn()
        const state = { importedSeeds: [] }

        addImportedSeed({ commit, state }, 'seed-a')

        expect(commit).toHaveBeenCalledWith('setImportedSeeds', ['seed-a'])

        /* The mutation is what updates state; simulate it and re-import. */
        state.importedSeeds = ['seed-a']
        addImportedSeed({ commit, state }, 'seed-a')

        expect(commit).toHaveBeenCalledTimes(1)
    })

    it('activateAccounts / activateInputs are documented no-ops', () => {
        const commit = vi.fn()

        expect(() => activateAccounts({ commit }, {})).not.toThrow()
        expect(() => activateInputs({ commit }, {})).not.toThrow()
        expect(commit).not.toHaveBeenCalled()
    })

    it('updateAccounts marks the given indexes with the requested action', () => {
        const commit = vi.fn()
        const state = { a: msgpack.encode(accountsModel([0, 1])) }
        const getters = makeGetters(state)

        updateAccounts({ commit, getters }, { wallet: 'BCH', action: 'lock', indexes: [1] })

        const accounts = commit.mock.calls.find((c) => c[0] === 'setAccounts')[1]
        expect(accounts.BCH['1'].s).toBe('l')
        expect(accounts.BCH['0'].s).toBe('a')
    })
})

describe('wallets/mutations', () => {
    it('setAccounts / setChangeIndexes msgpack-encode their payloads', () => {
        const state = {}

        setAccounts(state, accountsModel([0]))
        expect(msgpack.decode(Buffer.from(state.a)).BCH['0'].s).toBe('a')

        setChangeIndexes(state, { BCH: [0, 1] })
        expect(msgpack.decode(Buffer.from(state.c))).toEqual({ BCH: [0, 1] })
    })

    it('setImportedSeeds / setMetadata msgpack-encode into is / m', () => {
        const state = {}

        setImportedSeeds(state, ['a'])
        expect(msgpack.decode(Buffer.from(state.is))).toEqual(['a'])

        setMetadata(state, { note: 1 })
        expect(msgpack.decode(Buffer.from(state.m))).toEqual({ note: 1 })
    })

    it('setEmptyWallet resets accounts / seeds / metadata', () => {
        const state = { a: 'x', is: 'y', m: 'z' }

        setEmptyWallet(state)

        expect(state.a).toBeNull()
        expect(state.is).toBeNull()
        expect(state.m).toBeNull()
    })
})
