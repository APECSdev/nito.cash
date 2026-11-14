/**
 * Update Currency
 */
const updateCurrency = ({ commit }, _currency) => {
    /* Commit (active) fiat currency. */
    commit('setFiatCurrency', _currency)
}

/* Export module. */
export default updateCurrency
