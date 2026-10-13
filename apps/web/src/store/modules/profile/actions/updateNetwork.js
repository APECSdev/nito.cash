/**
 * Update Network
 */
const updateNetwork = ({ commit }, _network) => {
    /* Commit (active) network. */
    commit('setNetwork', _network)
}

/* Export module. */
export default updateNetwork
