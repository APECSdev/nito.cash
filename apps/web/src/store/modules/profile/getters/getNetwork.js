/**
 * Get Network
 *
 * The active BCH network ('mainnet' | 'chipnet'). Defaults to 'mainnet'
 * when none has been selected/persisted yet.
 */
const getNetwork = (state) => {
    /* Return network (default to mainnet). */
    return state.net || 'mainnet'
}

/* Export module. */
export default getNetwork
