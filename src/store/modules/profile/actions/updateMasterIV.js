/**
 * Update Master Initialization Vector
 */
const updateMasterIV = ({ commit }, _iv) => {
    /* Commit wallet's master initialization vector. */
    commit('setMasterIV', _iv)
}

/* Export module. */
export default updateMasterIV
