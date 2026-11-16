/* NOTE: address derivation now lives entirely in getAddresses (which
   carries branch-0 + discovered branch-1 entries with their addresses);
   this getter only sums the per-address Fulcrum balances. */

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

    /* Collect ALL account addresses (branch 0 receiving + DISCOVERED
       branch 1 change chain — getAddresses carries `address` per entry, so
       no per-index path rebuild is needed here; a restored wallet's
       foreign change funds MUST be scanned too). */
    const addresses = (getters.getAddresses(_wallet) || []).map((a) => a.address)
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

        /* Set (fiat) currency — the USER'S selection (Settings), which
           defaults to 'USD'; the (legacy) `_currency` argument is kept for
           call-site compatibility but the persisted selection wins. */
        const currency = rootGetters['profile/getFiatCurrency'] || _currency

        /* Retrieve market price. NOTE: a FAILED ticker fetch must not fail
           the whole balance — the wallet's BCH total is known regardless of
           the fiat price (a thrown CoinGecko error previously propagated
           out of getBalance and zeroed view-level balances). */
        let marketPrice = null
        try {
            marketPrice =
                await rootGetters['blockchain/getTicker'](_wallet, currency)
            console.info(`Market price (${currency})`, marketPrice) // eslint-disable-line no-console
        } catch (tickerErr) {
            console.error('Ticker unavailable:', tickerErr) // eslint-disable-line no-console
        }

        /* Validate market price. */
        if (marketPrice) {
            /* Format balance (for display). */
            const formattedBalance =
                rootGetters['utils/getFormattedValue'](balance, marketPrice, currency)

            /* Return (formatted) balance. */
            return formattedBalance
        } else {
            /* Ticker unavailable — return the balance WITHOUT fiat (fiat:
               null) instead of null: a failed CoinGecko call must not zero
               the wallet display or block the Send guard on a funded
               wallet (observed live on chipnet). */
            const unformattedBalance =
                rootGetters['utils/getFormattedValue'](balance, null, currency)

            /* Return (formatted, fiat-less) balance. */
            return unformattedBalance
        }
    } catch (err) {
        console.error(err) // eslint-disable-line no-console

        /* Bugsnag alert. */
        throw new Error(err)
    }
}

/* Export module. */
export default getBalance
