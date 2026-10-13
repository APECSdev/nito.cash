/**
* Get Ticker
*
* Retrieves the current BCH market price (in cents) from a public price API.
* (Replaces the retired `bitbox.Price.current` feed.)
*/
const getTicker = () => async (_wallet, _currency) => {
    // console.log('GET TICKER', _wallet, _currency)

    try {
        /* Normalize currency (the API expects lowercase, e.g. 'usd'). */
        const currency = (_currency || 'USD').toLowerCase()

        /* Retrieve ticker price (fiat-denominated BCH price). */
        // NOTE: Returns promise.
        const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=${currency}`)
        const data = await response.json()

        /* Convert to cents (matching the previous bitbox feed's format). */
        const ticker = Math.round(data['bitcoin-cash'][currency] * 100)

        /* Return ticker. */
        return ticker
    } catch (err) {
        console.error(err) // eslint-disable-line no-console

        /* Bugsnag alert. */
        throw new Error(err)
    }
}

/* Export module. */
export default getTicker
