/* Import the Fulcrum (Electrum) data provider. */
import { getCluster } from '@/lib/bch/provider.js'

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
 *      transaction sequentially.
 *   2. The original's "sent" value calculation overwrote `value` with the
 *      transaction's TOTAL output value (and then double-counted the
 *      wallet's own change as incoming). We now compute the net flow:
 *      received = outputs paying our addresses; spent = our inputs
 *      (resolved via parent-tx lookups); a tx is "incoming" when none of
 *      its inputs are ours.
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

        /* Collect the UNIQUE tx hashes across ALL (active) addresses. */
        const txHashes = []
        for (const address of addresses) {
            /* Retrieve address history. */
            const addrHistory = await cluster.getHistory(address)

            addrHistory.forEach(({ tx_hash }) => {
                /* Validate transaction (dedup). */
                if (!ourTransactions.has(tx_hash)) {
                    /* Add to our transactions. */
                    ourTransactions.add(tx_hash)
                    txHashes.push(tx_hash)
                }
            })
        }

        /* Transaction cache (shared for parent-tx lookups). */
        const txCache = new Map()
        const fetchTx = async (txid) => {
            if (!txCache.has(txid)) {
                txCache.set(txid, await cluster.verboseGetTransaction(txid))
            }
            return txCache.get(txid)
        }

        /* Process each unique transaction (sequentially, awaited). */
        for (const txid of txHashes) {
            /* Retrieve (verbose) transaction details. */
            const details = await fetchTx(txid)
            console.log('TX DETAILS', details) // eslint-disable-line no-console

            /* Initialize (received / spent) values (satoshis). */
            let valueReceived = 0
            let valueSpent = 0

            /* Search outputs (sum payments to OUR addresses). */
            (details.vout || []).forEach(output => {
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

                /* Retrieve the parent transaction. */
                const parent = await fetchTx(input.txid)
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

            /* Add transaction to history. */
            history.push(tx)
        }

        /* Return history. */
        return history
    } catch (err) {
        console.error(err) // eslint-disable-line no-console

        /* Bugsnag alert. */
        throw new Error(err)
    }
}

/* Export module. */
export default getHistory
