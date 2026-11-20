/* Unit tests for the wallets/getHistory getter.
 *
 * Regression guard for the reported "History does not show anything" bug:
 * the getter used to THROW on any single failure (one flaky address lookup,
 * one quorum shortfall on ONE transaction), which wiped the whole list —
 * History.vue has no error branch, so a funded wallet rendered "You haven't
 * made any transactions yet".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The fake cluster is swapped per test. */
const { clusterRef } = vi.hoisted(() => ({ clusterRef: { current: null } }))

vi.mock('@/lib/bch/provider.js', () => ({
    getCluster: vi.fn(async () => clusterRef.current),
}))

import getHistory from '@/store/modules/wallets/getters/getHistory'

/* Two of OUR addresses. */
const A0 = 'bitcoincash:qzone0000000000000000000000000000000000000000'
const A1 = 'bitcoincash:qzone1111111111111111111111111111111111111111'

const getters = {
    getAddresses: () => [
        { address: A0, index: 0, branch: 0 },
        { address: A1, index: 1, branch: 0 },
    ],
}
const rootGetters = { 'profile/getNetwork': () => 'mainnet' }

/* A verbose tx paying `value` sats to `address`. */
const txTo = (txid, address, value, confirmations = 10, time = 1700000000) => ({
    txid,
    confirmations,
    time,
    vin: [{ txid: 'ff'.repeat(32), vout: 0 }],
    vout: [{ n: 0, value: value / 1e8, scriptPubKey: { addresses: [address] } }],
})

/* The (foreign) parent funding tx: not ours. */
const PARENT = {
    txid: 'ff'.repeat(32),
    confirmations: 20,
    time: 1699990000,
    vin: [{ txid: 'ee'.repeat(32), vout: 0 }],
    vout: [{ n: 0, value: 1, scriptPubKey: { addresses: ['bitcoincash:qforeign00000000000000000000000000000000'] } }],
}

const fakeCluster = ({ histories, txs, failTx = [] }) => ({
    getHistory: vi.fn(async (address) => {
        if (histories[address] instanceof Error) {
            throw histories[address]
        }
        return (histories[address] || []).map((tx_hash) => ({ tx_hash }))
    }),
    verboseGetTransaction: vi.fn(async (txid) => {
        if (failTx.includes(txid)) {
            throw new Error(`no quorum for ${txid}`)
        }
        if (txid === PARENT.txid) return PARENT
        if (txs[txid]) return txs[txid]
        throw new Error(`unknown tx ${txid}`)
    }),
})

beforeEach(() => {
    clusterRef.current = null
})

describe('wallets/getHistory', () => {
    it('builds received/sent entries with net values', async () => {
        const received = txTo('aa'.repeat(32), A0, 50000)
        clusterRef.current = fakeCluster({
            histories: { [A0]: ['aa'.repeat(32)], [A1]: [] },
            txs: { [received.txid]: received },
        })

        const history = await getHistory({}, getters, {}, rootGetters)

        expect(history).toHaveLength(1)
        expect(history[0]).toMatchObject({
            hash: received.txid,
            value: 50000,
            incoming: true,
            persistence: true,
            timestamp: 1700000000,
        })
    })

    it('dedupes a transaction seen on several of our addresses', async () => {
        const received = txTo('bb'.repeat(32), A0, 10000)
        clusterRef.current = fakeCluster({
            histories: { [A0]: [received.txid], [A1]: [received.txid] },
            txs: { [received.txid]: received },
        })

        const history = await getHistory({}, getters, {}, rootGetters)

        expect(history).toHaveLength(1)
    })

    it('SKIPS a failing address lookup instead of throwing', async () => {
        const received = txTo('cc'.repeat(32), A1, 25000)
        clusterRef.current = fakeCluster({
            histories: { [A0]: new Error('quorum failed'), [A1]: [received.txid] },
            txs: { [received.txid]: received },
        })

        const history = await getHistory({}, getters, {}, rootGetters)

        expect(history).toHaveLength(1)
        expect(history[0].hash).toBe(received.txid)
    })

    it('SKIPS a transaction whose details cannot be resolved', async () => {
        const ok = txTo('dd'.repeat(32), A0, 12345)
        const broken = 'ee'.repeat(32)
        clusterRef.current = fakeCluster({
            histories: { [A0]: [broken, ok.txid], [A1]: [] },
            txs: { [ok.txid]: ok },
            failTx: [broken],
        })

        const history = await getHistory({}, getters, {}, rootGetters)

        expect(history).toHaveLength(1)
        expect(history[0].hash).toBe(ok.txid)
    })

    it('returns an empty list (never throws) when the cluster is unavailable', async () => {
        clusterRef.current = null

        const history = await getHistory({}, getters, {}, rootGetters)

        expect(history).toEqual([])
    })

    it('returns an empty list when no addresses are active', async () => {
        clusterRef.current = fakeCluster({ histories: {}, txs: {} })

        const history = await getHistory({}, { getAddresses: () => [] }, {}, rootGetters)

        expect(history).toEqual([])
        expect(clusterRef.current.getHistory).not.toHaveBeenCalled()
    })
})
