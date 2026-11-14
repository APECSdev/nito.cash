/**
 * Activate Inputs
 *
 * NOTE: Intentionally a NO-OP. The original committed the NONEXISTENT
 *       `setInputs` mutation ("unknown mutation type"), and NOTHING in the
 *       app dispatches this action. Kept (like `initWallet`) so any
 *       external dispatch is harmless instead of crashing.
 */
const activateInputs = ({ commit }, _params) => {
    console.info('Activating inputs (NO-OP)...', _params) // eslint-disable-line no-console

    // NOTE: The original (broken) commit is retained as a comment.
    // commit('setInputs', 'a')
}

/* Export module. */
export default activateInputs
