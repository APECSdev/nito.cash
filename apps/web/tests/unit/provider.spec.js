/* Unit tests for src/lib/bch/provider.js (Fulcrum cluster, quorum model).
 *
 * The ElectrumClient is replaced by a controllable fake so the quorum,
 * self-healing retry and subscription logic can be exercised without a
 * network connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* Per-test behaviour for each client, keyed by host. */
const { behaviour, clients } = vi.hoisted(() => ({ behaviour: { current: {} }, clients: { list: [] } }))

vi.mock('@electrum-cash/network', () => {
    class ElectrumClient {
        constructor(name, version, host, opts) {
            this.host = host
            this.port = opts && opts.port
            this.connected = false
            clients.list.push(this)
        }

        async connect() {
            const b = behaviour.current[this.host] || {}

            if (b.connectError) throw new Error(b.connectError)
            this.connected = true
            return this
        }

        async disconnect() {
            this.connected = false
            return this
        }

        async request(method, ...params) {
            const b = behaviour.current[this.host] || {}

            if (b.requestError) return new Error(b.requestError)
            if (typeof b.handler === 'function') return b.handler(method, ...params)

            return `ok:${this.host}`
        }

        /* Notification dispatch (address subscriptions). */
        on(_method, _handler) {
            this._notificationHandler = _handler
        }

        async subscribe(_method, _address) {
            this.subscribed = this.subscribed || []
            this.subscribed.push(_address)
            return true
        }

        async unsubscribe(_method, _address) {
            return true
        }
    }

    return { ElectrumClient }
})

import {
    ElectrumMethods,
    FulcrumCluster,
    closeAllClusters,
    getCluster,
} from '@/lib/bch/provider.js'

const MAINNET_HOSTS = ['bch.imaginary.cash', 'electrum.imaginary.cash', 'blackie.c3-soft.com']

/* Every mainnet server answers identically. */
const allSame = (value) => {
    const out = {}
    MAINNET_HOSTS.forEach((h) => { out[h] = { handler: () => value } })
    return out
}

beforeEach(() => {
    clients.list.length = 0
    behaviour.current = allSame('same-value')
})

afterEach(() => {
    vi.restoreAllMocks()
})

describe('lib/bch/provider', () => {
    it('connects every server and reports the cluster size', async () => {
        const cluster = new FulcrumCluster('mainnet')

        await cluster.connect()

        expect(cluster.size).toBe(3)
        expect(clients.list.every((c) => c.connected)).toBe(true)
    })

    it('throws when fewer than quorum servers are reachable', async () => {
        behaviour.current = {
            'bch.imaginary.cash': { connectError: 'down' },
            'electrum.imaginary.cash': { connectError: 'down' },
            'blackie.c3-soft.com': { connectError: 'down' },
        }

        const cluster = new FulcrumCluster('mainnet')

        await expect(cluster.connect()).rejects.toThrow(/only 0\/3 servers reachable/i)
    })

    it('returns a value once quorum servers agree', async () => {
        const cluster = new FulcrumCluster('mainnet')

        await expect(cluster.request(ElectrumMethods.getBalance, 'bitcoincash:qqq')).resolves.toBe('same-value')
    })

    it('rejects when no quorum agrees', async () => {
        behaviour.current = {
            'bch.imaginary.cash': { handler: () => 'a' },
            'electrum.imaginary.cash': { handler: () => 'b' },
            'blackie.c3-soft.com': { handler: () => 'c' },
        }

        const cluster = new FulcrumCluster('mainnet')

        await expect(cluster.request(ElectrumMethods.getBalance, 'bitcoincash:qqq'))
            .rejects.toThrow(/no quorum for blockchain.address.get_balance/i)
    })

    it('ignores volatile fields when comparing verbose transactions', async () => {
        /* Same tx CONTENT, different `confirmations`/`blocktime`. */
        const tx = (confirmations) => ({
            txid: 'aa'.repeat(32),
            hash: 'aa'.repeat(32),
            version: 2,
            locktime: 0,
            size: 200,
            vin: [],
            vout: [],
            confirmations,
            blocktime: 1700000000 + confirmations,
        })

        behaviour.current = {
            'bch.imaginary.cash': { handler: () => tx(1) },
            'electrum.imaginary.cash': { handler: () => tx(2) },
            'blackie.c3-soft.com': { handler: () => tx(3) },
        }

        const cluster = new FulcrumCluster('mainnet')

        const result = await cluster.request(ElectrumMethods.getTransaction, 'aa'.repeat(32), true)

        expect(result.txid).toBe('aa'.repeat(32))
    })

    it('retries once when the first round cannot reach quorum', async () => {
        /* Round 1: three DIFFERENT answers (best 1/3 < quorum 2) -> retry.
           Round 2: everyone agrees. */
        const disagreeOnce = (value) => {
            let n = 0

            return { handler: () => (n++ === 0 ? value : 'x') }
        }

        behaviour.current = {
            'bch.imaginary.cash': { handler: () => 'x' },
            'electrum.imaginary.cash': disagreeOnce('y'),
            'blackie.c3-soft.com': disagreeOnce('z'),
        }

        const cluster = new FulcrumCluster('mainnet')

        await expect(cluster.request(ElectrumMethods.getBalance, 'bitcoincash:qqq')).resolves.toBe('x')
    })

    it('reconnects and retries when NO server answers', async () => {
        let round = 0

        behaviour.current = {
            'bch.imaginary.cash': { handler: () => { round += 1; if (round <= 3) throw new Error('drop'); return 'z' } },
            'electrum.imaginary.cash': { handler: () => { round += 1; if (round <= 3) throw new Error('drop'); return 'z' } },
            'blackie.c3-soft.com': { handler: () => { round += 1; if (round <= 3) throw new Error('drop'); return 'z' } },
        }

        const cluster = new FulcrumCluster('mainnet')

        await expect(cluster.request(ElectrumMethods.getBalance, 'bitcoincash:qqq')).resolves.toBe('z')
    })

    it('reports server errors when quorum cannot be reached', async () => {
        behaviour.current = {
            'bch.imaginary.cash': { requestError: 'boom' },
            'electrum.imaginary.cash': { requestError: 'boom' },
            'blackie.c3-soft.com': { requestError: 'boom' },
        }

        const cluster = new FulcrumCluster('mainnet')

        await expect(cluster.request(ElectrumMethods.getBalance, 'bitcoincash:qqq'))
            .rejects.toThrow(/server errors: boom/i)
    })

    it('exposes the wallet-oriented helpers with the right methods/params', async () => {
        /* Record only the FIRST server's calls (each request is dispatched to
           all three servers for the quorum comparison). */
        const calls = []
        behaviour.current = {}
        MAINNET_HOSTS.forEach((h) => {
            behaviour.current[h] = {
                handler: (method, ...params) => {
                    if (h === MAINNET_HOSTS[0]) {
                        calls.push([method, params])
                    }

                    return []
                },
            }
        })

        const cluster = new FulcrumCluster('mainnet')

        await cluster.getBalance('addr')
        await cluster.getUtxos('addr')
        await cluster.getUtxosWithTokens('addr')
        await cluster.getHistory('addr')
        await cluster.rpaGetHistory('5c', 100, 200)
        await cluster.rpaGetMempool('5c')
        await cluster.getTransaction('tx')
        await cluster.verboseGetTransaction('tx')
        await cluster.broadcast('raw')
        await cluster.estimateFee(3)
        await cluster.relayFee()

        expect(calls).toEqual([
            ['blockchain.address.get_balance', ['addr']],
            ['blockchain.address.listunspent', ['addr']],
            ['blockchain.address.listunspent', ['addr', 'include_tokens']],
            ['blockchain.address.get_history', ['addr']],
            ['blockchain.rpa.get_history', ['5c', 100, 200]],
            ['blockchain.rpa.get_mempool', ['5c']],
            ['blockchain.transaction.get', ['tx']],
            ['blockchain.transaction.get', ['tx', true]],
            ['blockchain.transaction.broadcast', ['raw']],
            ['blockchain.estimatefee', [3]],
            ['blockchain.relayfee', []],
        ])
    })

    it('subscribes addresses on one client, skips the baseline, dispatches changes', async () => {
        const cluster = new FulcrumCluster('mainnet')

        /* Only the first client is used for subscriptions. */
        const onChange = vi.fn()

        await cluster.subscribeAddresses(['a1', 'a2'], onChange)

        const first = clients.list[0]
        expect(first.subscribed).toEqual(['a1', 'a2'])

        const notify = first._notificationHandler

        /* The FIRST notification is the current status baseline — no callback. */
        notify({ method: ElectrumMethods.subscribeAddress, params: ['a1', 'status-0'] })
        expect(onChange).not.toHaveBeenCalled()

        /* A genuine status change fires the callback. */
        notify({ method: ElectrumMethods.subscribeAddress, params: ['a1', 'status-1'] })
        expect(onChange).toHaveBeenCalledWith('a1', 'status-1')

        /* A duplicate status is ignored. */
        notify({ method: ElectrumMethods.subscribeAddress, params: ['a1', 'status-1'] })
        expect(onChange).toHaveBeenCalledTimes(1)

        /* Other methods and unknown addresses are ignored. */
        notify({ method: 'blockchain.headers.subscribe', params: [] })
        notify({ method: ElectrumMethods.subscribeAddress, params: ['zz', 'x'] })
        expect(onChange).toHaveBeenCalledTimes(1)

        /* Unsubscribe clears every subscription. */
        await cluster.unsubscribeAddresses()
        expect(cluster._subscriptions.size).toBe(0)
    })

    it('caches clusters per network and closes them all', async () => {
        const one = await getCluster('mainnet')
        const two = await getCluster('mainnet')

        expect(one).toBe(two)

        await closeAllClusters()

        const three = await getCluster('mainnet')
        expect(three).not.toBe(one)
    })
})
