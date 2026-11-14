/**
 * Get Fiat Currency
 *
 * The user's selected fiat currency (used for market prices + balance
 * displays). Defaults to 'USD' when none has been selected/persisted yet.
 */
const getFiatCurrency = (state) => {
    /* Return (fiat) currency (default to USD). */
    return state.fc || 'USD'
}

/* Export module. */
export default getFiatCurrency
