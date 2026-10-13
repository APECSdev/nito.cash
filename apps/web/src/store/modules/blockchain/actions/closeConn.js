/* Import the Fulcrum provider (address subscriptions). */
import { getCluster } from '@/lib/bch/provider.js'

/**
 * Close Connection
 *
 * Unsubscribe from ALL (wallet) address subscriptions — replacing the retired
 * `bitbox.Socket` `conn.close(callback)`.
 */
const closeConn = async ({ rootGetters }) => {
    /* Set (active) network. */
    const network = rootGetters['profile/getNetwork']

    /* Initialize the Fulcrum cluster. */
    const cluster = await getCluster(network)

    /* Unsubscribe from all (wallet) address subscriptions. */
    await cluster.unsubscribeAddresses()

    console.info('Blockchain (subscription) connection has been closed.') // eslint-disable-line no-console
}

/* Export module. */
export default closeConn
