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
    getScripthashHistory: 'blockchain.scripthash.get_history',
    rpaGetHistory: 'blockchain.rpa.get_history',
    rpaGetMempool: 'blockchain.rpa.get_mempool',
    getTransaction: 'blockchain.transaction.get',
    broadcast: 'blockchain.transaction.broadcast',
    estimateFee: 'blockchain.estimatefee',
    relayFee: 'blockchain.relayfee',
    subscribeAddress: 'blockchain.address.subscribe',
    subscribeHeaders: 'blockchain.headers.subscribe',
}

/*
 * Quorum comparison key for a (verbose) transaction response.
 *
 * The consensus-meaningful content of a transaction is its raw form (hex /
 * vin / vout / version / locktime). The verbose wrapper ALSO carries DERIVED
 * state — `confirmations`, `time`, `blocktime`, `height` — which changes at
 * block boundaries: while a transaction is confirming, two servers can
 * legitimately disagree on `confirmations` (0 vs 1), splitting the quorum on
 * an otherwise byte-identical answer (observed live on chipnet). Comparing
 * only the tx CONTENT keeps the quorum model meaningful (two servers must
 * still agree on the actual transaction) while tolerating consensus-state
 * volatility.
 */
const txContentKey = (value) => JSON.stringify({
    hash: value.hash,
    hex: value.hex,
    locktime: value.locktime,
    size: value.size,
    txid: value.txid,
    version: value.version,
    vin: value.vin,
    vout: value.vout,
})

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

    /* Per-client dispatch; ElectrumClient resolves with `Error | result`,
       normalized to a throw. */
    async _dispatch(method, params) {
        return Promise.allSettled(this.clients.map(async (client) => {
            const result = await client.request(method, ...params)
            if (result instanceof Error) throw result
            return result
        }))
    }

    /**
     * Broadcast a request to every server and return the first result backed
     * by at least `quorum` identical responses. Rejects if no quorum agrees.
     *
     * Self-healing: sockets drop when the tab is backgrounded (the electrum
     * client does NOT auto-connect on request — it throws "Unable to send
     * request to a disconnected server"), so every dispatch is preceded by an
     * idempotent `connect()` sweep, and a request where NOTHING answered gets
     * one full reconnect-and-retry before failing.
     */
    async request(method, ...params) {
        await Promise.allSettled(this.clients.map((client) => client.connect()))

        let settled = await this._dispatch(method, params)

        const fulfilledCount = () => settled.filter((s) => s.status === 'fulfilled').length
        if (fulfilledCount() === 0) {
            await Promise.allSettled(this.clients.map((client) => client.connect()))
            settled = await this._dispatch(method, params)
        }

        /* Tally identical (serialized) results across servers; keep server errors. */
        const tallyOf = (round) => {
            const tally = new Map()
            const errors = []
            for (const s of round) {
                if (s.status !== 'fulfilled') {
                    errors.push(s.reason instanceof Error ? s.reason.message : String(s.reason))
                    continue
                }
                /* Verbose tx responses compare on tx CONTENT (see
                   txContentKey — volatile derived fields excluded). */
                const key = (method === ElectrumMethods.getTransaction && s.value && typeof s.value === 'object')
                    ? txContentKey(s.value)
                    : JSON.stringify(s.value)
                const entry = tally.get(key) || { count: 0, value: s.value }
                entry.count += 1
                tally.set(key, entry)
            }
            return { tally, errors }
        }

        for (const { count, value } of tallyOf(settled).tally.values()) {
            if (count >= this.quorum) return value
        }

        /* Quorum shortfall with SOME fulfilled responses — retry once. A
           single (transient) slow server must not fail the whole request
           (observed live: 1/2 on a verbose tx fetch while BOTH servers
           returned byte-identical JSON when asked directly). Re-asking ALL
           servers keeps the identical-results quorum model intact; re-
           broadcasting the same raw tx is consensus-idempotent (same txid). */
        await Promise.allSettled(this.clients.map((client) => client.connect()))
        const retrySettled = await this._dispatch(method, params)

        for (const { count, value } of tallyOf(retrySettled).tally.values()) {
            if (count >= this.quorum) return value
        }

        /* Pick the better round for the error report. */
        const first = tallyOf(settled)
        const second = tallyOf(retrySettled)
        const bestOf = (round) => Math.max(0, ...[...round.tally.values()].map((t) => t.count))
        const report = bestOf(second) > bestOf(first) ? second : first
        const reached = bestOf(report)
        const why = report.errors.length ? ` — server errors: ${[...new Set(report.errors)].join(' | ')}` : ''
        throw new Error(
            `Fulcrum[${this.networkId}]: no quorum for ${method} (best ${reached}/${this.quorum})${why}`,
        )
    }

    /* ---- High-level, wallet-oriented helpers (all quorum-verified) ---- */

    /* -> { confirmed: sats, unconfirmed: sats } */
    getBalance(address) { return this.request(ElectrumMethods.getBalance, address) }

    /* -> [ { tx_hash, tx_pos, height, value } ] */
    getUtxos(address) { return this.request(ElectrumMethods.getUtxos, address) }

    /* -> [ { tx_hash, tx_pos, height, value, token_data? } ] INCLUDING token-bearing
       UTXOs. Uses the Electrum 1.5 `include_tokens` filter: by default Fulcrum
       HIDES token-bearing UTXOs from listunspent/get_balance. */
    getUtxosWithTokens(address) { return this.request(ElectrumMethods.getUtxos, address, 'include_tokens') }

    /* -> [ { tx_hash, height, fee? } ] */
    getHistory(address) { return this.request(ElectrumMethods.getHistory, address) }

    /* Fulcrum v1.10+ RPA (CashCode) index. `prefix` is the scan-pubkey
       prefix (1-4 hex chars); `fromHeight`/`toHeight` are inclusive, with
       -1 meaning chain tip. -> [ { tx_hash, height } ] */
    rpaGetHistory(prefix, fromHeight, toHeight) { return this.request(ElectrumMethods.rpaGetHistory, prefix, fromHeight, toHeight) }

    /* -> [ { tx_hash, height: 0 } ] (unconfirmed) */
    rpaGetMempool(prefix) { return this.request(ElectrumMethods.rpaGetMempool, prefix) }

    /* Scripthash-form history query (sha256 of the locking bytecode,
       byte-reversed, hex) — the ONLY form Fulcrum accepts for hashType-bit
       CashAddresses (the P2SH32 covenant pools): the `bitcoincash::p…`
       address form is rejected with "Invalid address" (verified live on
       mainnet + chipnet, 2026-11-22 — registry.js poolScripthash). */
    getScripthashHistory(scripthash) { return this.request(ElectrumMethods.getScripthashHistory, scripthash) }

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
    /* Test/dev seam: a harness (e.g. the visual-baseline screenshots) can inject
     * a deterministic mock cluster via `globalThis.__NITO_MOCK_CLUSTER__[networkId]`
     * so wallet views render WITHOUT live network access (which the harness blocks
     * for determinism). Production never sets this global, so this is inert there. */
    const mock = (typeof globalThis !== 'undefined') && globalThis.__NITO_MOCK_CLUSTER__
    if (mock && mock[networkId]) return mock[networkId]

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
