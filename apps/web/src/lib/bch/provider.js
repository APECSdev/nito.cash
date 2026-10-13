// apps/web/src/lib/bch/provider.js
/**
 * Fulcrum (Electrum-protocol) data provider.
 *
 * This is the ONLY network layer the wallet uses — it replaces the retired
 * `window.BITBOX` REST/socket calls (`Address.details`, `Address.utxo`,
 * `Transaction.details`, `RawTransactions.sendRawTransaction`, `Socket`).
 *
 * Design: `FulcrumCluster` connects to ALL of a network's configured servers
 * and broadcasts every request to each of them. A response is only accepted
 * once `quorum` servers return an IDENTICAL result, so no single endpoint is
 * trusted (a compromised/offline server cannot forge a balance or UTXO set).
 */
import { ElectrumClient } from '@electrum-cash/network'
import { getNetwork, ELECTRUM_CLIENT_NAME, ELECTRUM_PROTOCOL_VERSION } from './networks.js'

/* Electrum (Fulcrum) RPC methods used by the wallet. */
export const ElectrumMethods = {
    getBalance: 'blockchain.address.get_balance',
    getUtxos: 'blockchain.address.listunspent',
    getHistory: 'blockchain.address.get_history',
    getTransaction: 'blockchain.transaction.get',
    broadcast: 'blockchain.transaction.broadcast',
    estimateFee: 'blockchain.estimatefee',
    relayFee: 'blockchain.relayfee',
    subscribeAddress: 'blockchain.address.subscribe',
    subscribeHeaders: 'blockchain.headers.subscribe',
}

/**
 * A quorum-verified connection to one network's cluster of Fulcrum servers.
 */
export class FulcrumCluster {
    /**
     * @param {string} networkId - 'mainnet' | 'chipnet' (see ./networks.js).
     */
    constructor(networkId) {
        const net = getNetwork(networkId)
        this.network = net
        this.networkId = net.id
        /* Quorum can never exceed the number of configured servers. */
        this.quorum = Math.min(net.quorum, net.servers.length)
        this.clients = net.servers.map(({ host, port }) => new ElectrumClient(
            ELECTRUM_CLIENT_NAME,
            ELECTRUM_PROTOCOL_VERSION,
            host,
            { port, encrypted: true },
        ))
        this._connected = false
    }

    /* Number of servers in the cluster. */
    get size() {
        return this.clients.length
    }

    /**
     * Connect every server. Resolves once at least `quorum` are connected;
     * rejects if fewer than `quorum` could be reached.
     */
    async connect() {
        const results = await Promise.allSettled(this.clients.map((c) => c.connect()))
        const connected = results.filter((r) => r.status === 'fulfilled').length
        if (connected < this.quorum) {
            throw new Error(
                `Fulcrum[${this.networkId}]: only ${connected}/${this.size} servers reachable (quorum ${this.quorum})`,
            )
        }
        this._connected = true
    }

    /* Disconnect every server (best-effort). */
    async disconnect() {
        await Promise.allSettled(this.clients.map((c) => c.disconnect(true)))
        this._connected = false
    }

    /**
     * Broadcast a request to every server and return the first result backed
     * by at least `quorum` identical responses. Rejects if no quorum agrees.
     */
    async request(method, ...params) {
        const settled = await Promise.allSettled(this.clients.map(async (client) => {
            const result = await client.request(method, ...params)
            /* ElectrumClient resolves with `Error | result`; normalize to a throw. */
            if (result instanceof Error) throw result
            return result
        }))

        /* Tally identical (serialized) results across servers; keep server errors. */
        const tally = new Map()
        const errors = []
        for (const s of settled) {
            if (s.status !== 'fulfilled') {
                errors.push(s.reason instanceof Error ? s.reason.message : String(s.reason))
                continue
            }
            const key = JSON.stringify(s.value)
            const entry = tally.get(key) || { count: 0, value: s.value }
            entry.count += 1
            tally.set(key, entry)
        }

        for (const { count, value } of tally.values()) {
            if (count >= this.quorum) return value
        }

        const reached = Math.max(0, ...[...tally.values()].map((t) => t.count))
        const why = errors.length ? ` — server errors: ${[...new Set(errors)].join(' | ')}` : ''
        throw new Error(
            `Fulcrum[${this.networkId}]: no quorum for ${method} (best ${reached}/${this.quorum})${why}`,
        )
    }

    /* ---- High-level, wallet-oriented helpers (all quorum-verified) ---- */

    /* -> { confirmed: sats, unconfirmed: sats } */
    getBalance(address) { return this.request(ElectrumMethods.getBalance, address) }

    /* -> [ { tx_hash, tx_pos, height, value } ] */
    getUtxos(address) { return this.request(ElectrumMethods.getUtxos, address) }

    /* -> [ { tx_hash, height, fee? } ] */
    getHistory(address) { return this.request(ElectrumMethods.getHistory, address) }

    /* -> raw transaction hex (string) */
    getTransaction(txHash) { return this.request(ElectrumMethods.getTransaction, txHash) }

    /* -> verbose (parsed) transaction: { txid, vin, vout, confirmations, time, ... } */
    verboseGetTransaction(txHash) { return this.request(ElectrumMethods.getTransaction, txHash, true) }

    /* -> txid (string) on acceptance; throws the server error otherwise */
    broadcast(rawTxHex) { return this.request(ElectrumMethods.broadcast, rawTxHex) }

    /* -> fee rate (BCH/kB) for confirmation within `blocks` */
    estimateFee(blocks = 1) { return this.request(ElectrumMethods.estimateFee, blocks) }

    /* -> minimum relay fee (BCH/kB) */
    relayFee() { return this.request(ElectrumMethods.relayFee) }

    /* ---- Real-time address subscriptions (single-client, server-filtered) ---- */

    /**
     * Subscribe to status changes for a set of addresses.
     *
     * Subscriptions are per-connection and do NOT require quorum, so a single
     * (the first) client is used. Fulcrum filters server-side and pushes a
     * notification whenever a (new) transaction touches a subscribed address;
     * `onChange(address, status)` then fires. This replaces the retired
     * `bitbox.Socket` (which streamed ALL network transactions and filtered
     * client-side).
     *
     * @param {string[]} addresses - the (wallet) addresses to watch.
     * @param {(address: string, status: string) => void} onChange - callback.
     */
    async subscribeAddresses(addresses, onChange) {
        /* (Lazily) attach a single notification dispatcher to one client. */
        if (!this._subscriptionClient) {
            this._subscriptionClient = this.clients[0]
            this._subscriptions = new Map()
            this._subscriptionClient.on('notification', (notification) => {
                if (notification.method !== ElectrumMethods.subscribeAddress) return
                const [address, status] = notification.params || []
                const sub = this._subscriptions.get(address)
                if (!sub) return

                /* The FIRST notification after subscribing is the address's
                 * CURRENT status (a baseline, not a new payment) — record it
                 * and do NOT fire, so we don't alert on pre-existing history. */
                if (!sub.initialized) {
                    sub.lastStatus = status
                    sub.initialized = true
                    return
                }

                /* Ignore no-change (duplicate) notifications. */
                if (status === sub.lastStatus) return
                sub.lastStatus = status

                /* A genuine (new) status change -> fire the callback. */
                sub.callback(address, status)
            })
        }

        /* Register each address's callback + subscribe at the server. */
        for (const address of addresses) {
            this._subscriptions.set(address, { callback: onChange, lastStatus: null, initialized: false })
            await this._subscriptionClient.subscribe(ElectrumMethods.subscribeAddress, address)
        }
    }

    /* Unsubscribe from ALL address subscriptions (best-effort). */
    async unsubscribeAddresses() {
        if (!this._subscriptionClient || !this._subscriptions) return
        for (const address of this._subscriptions.keys()) {
            await this._subscriptionClient
                .unsubscribe(ElectrumMethods.subscribeAddress, address)
                .catch(() => {})
        }
        this._subscriptions.clear()
    }
}

/* ---- Connection management (one connected cluster per network, cached) ---- */
const _clusters = new Map()

/**
 * Get (creating + connecting on first use) the cluster for a network.
 * @param {string} networkId - 'mainnet' | 'chipnet'.
 * @returns {Promise<FulcrumCluster>} a connected cluster.
 */
export async function getCluster(networkId) {
    if (_clusters.has(networkId)) return _clusters.get(networkId)
    const cluster = new FulcrumCluster(networkId)
    await cluster.connect()
    _clusters.set(networkId, cluster)
    return cluster
}

/* Disconnect + drop every cached cluster (e.g. before switching networks). */
export async function closeAllClusters() {
    await Promise.allSettled([..._clusters.values()].map((c) => c.disconnect()))
    _clusters.clear()
}
