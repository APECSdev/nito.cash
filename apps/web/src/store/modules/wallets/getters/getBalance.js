/* Import crypto helpers (local key/address cryptography). */
import { derivePath, toCashAddress } from '@/lib/bch/crypto.js'

/* Import the Fulcrum (Electrum) data provider. */
import { getCluster } from '@/lib/bch/provider.js'

/**
* Get (Total Wallet) Balance
*
* Retrieves the current (total) wallet balance.
*
* NOTE: Optional (market price) parameter is used to calculate fiat value,
*       and return a "formatted" value package.
*/
const getBalance = (state, getters, rootState, rootGetters) => async (_wallet, _currency) => {
    /* Validate (wallet) accounts. */
    if (!getters.getAccountsByWallet(_wallet)) {
        return null
    }

    /* Set (active) network. */
    const network = rootGetters['profile/getNetwork']

    /* Initialize account addresses. */
    const addresses = []

    /* Add all active receiving account (addresses) to pool. */
    Object.keys(getters.getAccountsByWallet(_wallet)).forEach(index => {
        /* Initialize HD node. */
        const hdNode = getters.getHDNode

        /* Set derivation path. */
        const path = `${getters.getDerivationPath(_wallet)}/${index}`
        // console.log('GET BALANCE (path)', path)

        /* Initialize child node. */
        const childNode = derivePath(hdNode, path)

        const address = toCashAddress(childNode, network)
        // console.log('GET WALLET BALANCE (receiving address)', address)

        /* Add to all receiving (pool). */
        addresses.push(address)
    })
    console.log('GET WALLET BALANCE (all accounts)', addresses)

    try {
        /* Initialize balance. */
        let balance = 0

        /* Retrieve (ALL) account(s) balances (quorum-verified). */
        const cluster = await getCluster(network)
        const balances = await Promise.all(
            addresses.map((address) => cluster.getBalance(address)))
        // console.log('ALL ACCOUNTS BALANCES', JSON.stringify(balances, null, 4))

        /* Validate (use of) unconfirmed transactions. */
        if (rootGetters['profile/getFlags'] && rootGetters['profile/getFlags'].ut) {
            balances.forEach((addressBalance) => {
                /* Both confirmed and unconfirmed. */
                balance += (addressBalance.confirmed + addressBalance.unconfirmed)
            })
        } else {
            balances.forEach((addressBalance) => {
                /* Confirmed ONLY. */
                balance += addressBalance.confirmed
            })
        }

        /* Retrieve market price. */
        const marketPrice =
            await rootGetters['blockchain/getTicker'](_wallet, _currency)
        console.info(`Market price (${_currency})`, marketPrice) // eslint-disable-line no-console

        /* Validate market price. */
        if (marketPrice) {
            /* Format balance (for display). */
            // TODO: Support additional currencies.
            const formattedBalance =
                rootGetters['utils/getFormattedValue'](balance, marketPrice, 'USD')

            /* Return (formatted) balance. */
            return formattedBalance
        } else {
            /* Return (empty) balance. */
            return null
        }
    } catch (err) {
        console.error(err) // eslint-disable-line no-console

        /* Bugsnag alert. */
        throw new Error(err)
    }
}

/* Export module. */
export default getBalance
