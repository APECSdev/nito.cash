/**
 * Set Fiat Currency
 */
const setFiatCurrency = (state, _currency) => {
    /* Set (active) fiat currency. */
    state.fc = _currency
}

/* Export module. */
export default setFiatCurrency
