/**
 * Activate Accounts
 *
 * NOTE: Intentionally a NO-OP. The original called `commit()` with NO
 *       arguments, which (in the Vuex-compat facade) throws "unknown
 *       mutation type: undefined" — and NOTHING in the app dispatches this
 *       action. Kept (like `initWallet`) so any external dispatch is
 *       harmless instead of crashing.
 */
const activateAccounts = ({ commit }, _params) => {
    console.info('Activating accounts (NO-OP)...', _params) // eslint-disable-line no-console

    // NOTE: The original (broken) commit is retained as a comment.
    // commit()
    // commit('setAccounts', 'a')
}

/* Export module. */
export default activateAccounts
