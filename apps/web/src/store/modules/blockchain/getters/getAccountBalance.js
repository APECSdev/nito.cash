/* Import the Fulcrum (Electrum) data provider. */
import { getCluster } from '@/lib/bch/provider.js'

/**
* Get Account Balance
*
* NOTE: This function will accept ANY account address to retrieve the
*       current balance (in satoshis).
*/
const getAccountBalance = (state, getters, rootState, rootGetters) => async (_account) => {
    console.log('GET ACCOUNT BALANCE', _account) // eslint-disable-line no-console

    try {
        /* Set (active) network. */
        const network = rootGetters['profile/getNetwork']

        /* Connect to the Fulcrum cluster. */
        const cluster = await getCluster(network)

        /* Retrieve account balance (quorum-verified). */
        const details = await cluster.getBalance(_account)
        console.log('ACCOUNT DETAILS', JSON.stringify(details, null, 4)) // eslint-disable-line no-console

        /* Initialize balance. */
        let balance = 0

        /* Set balance (in satoshis). */
        if (rootState.profile.useUnconfirmed) {
            /* Both confirmed and unconfirmed. */
            balance = (details.confirmed + details.unconfirmed)
        } else {
            /* Confirmed ONLY. */
            balance = details.confirmed
        }

        /* Return (satoshi) balance. */
        return balance
    } catch (err) {
        console.error(err) // eslint-disable-line no-console

        /* Bugsnag alert. */
        throw new Error(err)
    }
}

/* Export module. */
export default getAccountBalance
