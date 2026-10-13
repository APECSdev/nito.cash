/* Import the Fulcrum provider (address subscriptions + tx lookups). */
import { getCluster } from '@/lib/bch/provider.js'

/* Track tx hashes we've already notified about.
 * (Fulcrum fires an address-status change for BOTH the unconfirmed tx and its
 *  confirmation, so we de-duplicate to avoid double alerts.) */
const _seenTxs = new Set()

/**
 * Handle Incoming Payment
 *
 * Fulcrum reports that `_address` has a (new) transaction. We look up the
 * latest incoming amount, notify the user, advance the receive account,
 * update the account inputs, and play the "coins" sound.
 *
 * (Replaces the retired `bitbox.Socket` 'transactions' handler, which parsed a
 *  streamed transaction message for matching output addresses.)
 */
const handleIncomingPayment = async (_dispatch, _rootGetters, _address) => {
    // TODO: Profile the performance of this action, considering the
    //       amount of network + cryptography involved.

    /* Set (active) network. */
    const network = _rootGetters['profile/getNetwork']

    /* Initialize the Fulcrum cluster. */
    const cluster = await getCluster(network)

    /* Retrieve the address's (latest) history entry. */
    const history = await cluster.getHistory(_address)
    if (!history || history.length === 0) {
        return
    }

    /* Set the latest transaction hash. */
    const latestTxHash = history[history.length - 1].tx_hash

    /* Validate (new) transaction (avoid duplicate alerts). */
    if (_seenTxs.has(latestTxHash)) {
        return
    }
    _seenTxs.add(latestTxHash)

    /* Retrieve the (verbose) transaction. */
    const tx = await cluster.verboseGetTransaction(latestTxHash)

    /* Sum the (incoming) value paid to this address. */
    let satoshi = 0
    tx.vout.forEach(vout => {
        /* Set addresses (for this output). */
        const addresses = (vout.scriptPubKey && vout.scriptPubKey.addresses) || []

        /* Validate (matching) address. */
        if (addresses.includes(_address)) {
            /* Add (output) value (converted from BCH to satoshis). */
            satoshi += Math.round(vout.value * 1e8)
        }
    })

    /* Set notification message. */
    const notifMsg = `Receiving ${(satoshi / 100)} bits to ${_address.slice(12, 18)} ... ${_address.slice(-6)}`

    /* Dispatch notification. */
    _dispatch('displayNotification', notifMsg, { root: true })

    /* Increment receiving wallet (index). */
    _dispatch('wallets/nextAccount', 'BCH', { root: true })

    /* Build (inputs) update package. */
    const updateInputs = {
        action: 'add',
        address: _address,
        wallet: 'BCH',
    }

    /* Update account inputs. */
    _dispatch('wallets/updateInputs', updateInputs, { root: true })

    try {
        /* Initialize media. */
        const media = new Audio(require('@/media/coins.wav'))

        /* Play media. */
        // WARNING: This action may fail on several browsers;
        //          so it's best to do this last to avoid any
        //          unforseen side-effects.
        media.play()
    } catch (err) {
        console.error(err) // eslint-disable-line no-console
    }
}

/**
 * Open Connection
 *
 * Subscribe to status changes for ALL (in-use) wallet addresses via Fulcrum
 * (`blockchain.address.subscribe`). Fulcrum filters server-side and pushes a
 * notification when a (new) transaction touches a watched address — replacing
 * the retired `bitbox.Socket` (which streamed ALL network transactions over
 * `wss://ws.bitcoin.com` and filtered them client-side).
 */
const openConn = async ({ dispatch, rootGetters }) => {
    /* Set (active) network. */
    const network = rootGetters['profile/getNetwork']

    /* Initialize the Fulcrum cluster. */
    const cluster = await getCluster(network)

    /* Retrieve (wallet) addresses. */
    // TODO: Profile the performance of this action, considering the
    //       amount of cryptography involved in deriving these addresses.
    const walletAddresses = rootGetters['wallets/getAddresses']('BCH')
    // console.log('\nWALLET ADDRESSES', walletAddresses)

    /* Build the (plain) address list. */
    const addresses = (walletAddresses || []).map(account => account.address)

    /* Subscribe to (wallet) address status changes. */
    // NOTE: This replaces `conn.listen('transactions', ...)`; Fulcrum pushes a
    //       per-address notification instead of streaming every transaction.
    await cluster.subscribeAddresses(addresses, (address) => {
        /* Handle the (incoming) payment (async; log any failure). */
        handleIncomingPayment(dispatch, rootGetters, address)
            .catch(err => console.error(err)) // eslint-disable-line no-console
    })

    console.info(`Blockchain: subscribed to ${addresses.length} address(es) on ${network}!`) // eslint-disable-line no-console
}

/* Export module. */
export default openConn
