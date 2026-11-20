/* Import the Fulcrum (Electrum) data provider. */
import { getCluster } from '@/lib/bch/provider.js'

/* Bounded concurrency for the network fan-out. Each request is itself a
   QUORUM request (one round-trip per server), so 6 in flight = up to 18
   sockets — well within Fulcrum's limits, while collapsing a long history
   from (measured) ~114 ms per transaction SEQUENTIALLY to a fraction of
   that. */
const CONCURRENCY = 6

/**
 * Map `_items` through `_fn` with at most `_limit` in flight, preserving the
 * input order in the result. Never rejects: a failed item is returned as
 * `{ ok: false, error }` so ONE bad address/transaction cannot abort the
 * whole history (observed failure mode: a single quorum shortfall threw out
 * of this getter, History rendered "You haven't made any transactions yet"
 * for a wallet with a long history).
 */
const mapLimit = async (_items, _limit, _fn) => {
    const results = new Array(_items.length)
    let cursor = 0

    const worker = async () => {
        while (true) {
            const index = cursor++
            if (index >= _items.length) {
                return
            }
            try {
                results[index] = { ok: true, value: await _fn(_items[index], index) }
            } catch (error) {
                results[index] = { ok: false, error }
            }
        }
    }

    const workers = []
    for (let i = 0; i < Math.min(_limit, _items.length); i++) {
        workers.push(worker())
    }
    await Promise.all(workers)

    return results
}

/**
 * Get (Wallet) History
 *
 * Retrieves ALL accounts held within this wallet, then
 * updates the full history.
 *
 * NOTE: This is a corrected port of the original BITBOX-based getter:
 *   1. The original iterated txs via `forEach(async ...)` and returned
 *      `history` BEFORE any (awaited) tx details resolved — so it always
 *      resolved with an (essentially) empty history. We now `await` each
 *      transaction (bounded-concurrency batches below).
 *   2. The original's "sent" value calculation overwrote `value` with the
 *      transaction's TOTAL output value (and then double-counted the
 *      wallet's own change as incoming). We now compute the net flow:
 *      received = outputs paying our addresses; spent = our inputs
 *      (resolved via parent-tx lookups); a tx is "incoming" when none of
 *      its inputs are ours.
 *
 * RESILIENCE (why History could render EMPTY for a funded wallet):
 *   This getter used to `throw` on ANY failure — one flaky server, one
 *   quorum shortfall on ONE transaction, or one unreachable address wiped
 *   the entire list, and History.vue (which has no error branch) then
 *   showed "You haven't made any transactions yet". Every address lookup
 *   and every transaction lookup is now isolated: failures are logged and
 *   skipped, and whatever was resolved is returned.
 */
const getHistory = async (state, getters, rootState, rootGetters) => {
    console.info('Retrieving account history...') // eslint-disable-line no-console

    /* Initialize history. */
    const history = []

    /* Initialize our transactions (dedup set). */
    const ourTransactions = new Set()

    try {
        /* Set (active) network. */
        const network = rootGetters['profile/getNetwork']

        /* Set accounts. */
        const accounts = getters.getAddresses('BCH')
        console.log('ALL ACTIVE ACCOUNTS', accounts) // eslint-disable-line no-console

        /* Set addresses. */
        const addresses = accounts.map(account => account.address)
        console.log('ALL ACTIVE ACCOUNT ADDRESES', addresses) // eslint-disable-line no-console

        /* Validate addresses. */
        if (!addresses.length) {
            return history
        }

        /* Connect to the Fulcrum cluster. */
        const cluster = await getCluster(network)

        /* Collect the UNIQUE tx hashes across ALL (active) addresses.
           (Bounded-concurrency; a failing address is logged and skipped.) */
        const txHashes = []
        const addrResults = await mapLimit(addresses, CONCURRENCY, (address) => cluster.getHistory(address))

        addrResults.forEach((result, index) => {
            if (!result.ok) {
                console.error('HISTORY: address lookup failed', addresses[index], result.error) // eslint-disable-line no-console
                return
            }

            const addrHistory = Array.isArray(result.value) ? result.value : []
            addrHistory.forEach(({ tx_hash }) => {
                /* Validate transaction (dedup). */
                if (!ourTransactions.has(tx_hash)) {
                    /* Add to our transactions. */
                    ourTransactions.add(tx_hash)
                    txHashes.push(tx_hash)
                }
            })
        })

        /* Transaction cache (shared for parent-tx lookups). The PROMISE is
           cached (not the value) so concurrent callers share ONE request
           instead of racing duplicate round-trips. */
        const txCache = new Map()
        const fetchTx = async (txid) => {
            if (!txCache.has(txid)) {
                txCache.set(txid, cluster.verboseGetTransaction(txid))
            }
            return txCache.get(txid)
        }

        /* Process each unique transaction (bounded concurrency, awaited).
           A transaction whose details cannot be resolved is logged and
           SKIPPED — the rest of the history still renders. */
        const txResults = await mapLimit(txHashes, CONCURRENCY, async (txid) => {
            /* Retrieve (verbose) transaction details. */
            const details = await fetchTx(txid)
            console.log('TX DETAILS', details) // eslint-disable-line no-console

            /* Initialize (received / spent) values (satoshis). */
            let valueReceived = 0
            /* NOTE: the semicolon is REQUIRED — the next statement begins
               with `(`, so without it ASI parses `0 (details.vout || [])`
               as a call and crashes with "0 is not a function" on the FIRST
               real transaction (History rendered permanently empty). */
            let valueSpent = 0;

            /* Search outputs (sum payments to OUR addresses). */
            ;(details.vout || []).forEach(output => {
                const outAddrs = (output.scriptPubKey && output.scriptPubKey.addresses) || []

                /* Validate (matching) transaction. */
                // FIXME: This "could" fail (or cause problems),
                //        when sending within the same wallet.
                if (outAddrs.some(a => addresses.includes(a))) {
                    /* Add value (convert BCH -> satoshis). */
                    valueReceived += Math.round(output.value * 100000000)
                }
            })

            /* Search inputs (sum OUR spent inputs; resolved via parent txs). */
            for (const input of (details.vin || [])) {
                /* Skip coinbase inputs (no parent tx). */
                if (!input.txid) {
                    continue
                }

                /* Retrieve the parent transaction. A missing parent makes
                   THIS input unverifiable (skip it, keep the rest). */
                let parent
                try {
                    parent = await fetchTx(input.txid)
                } catch (parentErr) {
                    console.error('HISTORY: parent tx lookup failed', input.txid, parentErr) // eslint-disable-line no-console
                    continue
                }
                const parentOut = (parent.vout || [])[input.vout]
                const inAddrs = (parentOut && parentOut.scriptPubKey && parentOut.scriptPubKey.addresses) || []

                /* Validate (matching) transaction. */
                // FIXME: This "could" fail (or cause problems),
                //        when sending within the same wallet.
                if (inAddrs.some(a => addresses.includes(a))) {
                    /* Add value (convert BCH -> satoshis). */
                    valueSpent += Math.round((parentOut.value || 0) * 100000000)
                }
            }

            /* Set (incoming) flag: no inputs spent from our addresses. */
            const incoming = (valueSpent === 0)

            /* Initialize value (net flow, in satoshis). */
            const value = incoming ? valueReceived : (valueSpent - valueReceived)

            /* Initialize persistence. */
            const persistence = (details.confirmations || 0) > 0

            /* Initialize timestamp. */
            const timestamp = details.time || null

            /* Build transaction details. */
            const tx = {
                hash: details.txid || txid,
                value,
                incoming,
                persistence,
                timestamp,
            }

            console.log('BUILT TX', tx) // eslint-disable-line no-console

            return tx
        })

        txResults.forEach((result, index) => {
            if (!result.ok) {
                console.error('HISTORY: tx details failed (skipped)', txHashes[index], result.error) // eslint-disable-line no-console
                return
            }

            /* Add transaction to history. */
            history.push(result.value)
        })

        /* Return history. */
        return history
    } catch (err) {
        /* Reached only when the CLUSTER itself is unavailable (offline /
           no quorum on connect) — still never throw: an empty list lets
           History render its empty/error state instead of a rejected hook. */
        console.error('HISTORY: cluster unavailable', err) // eslint-disable-line no-console

        /* Return whatever (nothing) was collected. */
        return history
    }
}

/* Export module. */
export default getHistory
