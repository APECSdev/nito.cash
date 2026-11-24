// apps/web/src/store/modules/cashaccount.js
//
// CashAccounts v2 state for the Concierge's Persona desk.
//
// The resolver (lib/cashaccount/resolver.js) talks to ChainGraph; this module
// only caches PUBLIC account metadata (name, category, commitment, npub,
// profile). No private keys are stored: the CashCode scan/spend keys are
// derived on demand from the wallet seed, exactly like the pool's note keys.

import { resolveAccount as resolveCashAccount } from '../../lib/cashaccount/resolver.js'

/* Initialize state. */
const state = {
    account: null,
    accounts: [],
    status: null,
    error: null,
    lastQuery: null,
}

/* Getters. */
const getters = {
    getAccount: (state) => state.account,
    getAccounts: (state) => state.accounts,
    getStatus: (state) => state.status,
    getError: (state) => state.error,
    hasAccount: (state) => state.account !== null,
}

/* Actions. */
const actions = {
    /**
     * Resolve an account from an identifier, txid, or category.
     *
     * @param {object} context
     * @param {{ identifier?: string, txid?: string, category?: string }} payload
     * @returns {Promise<object>} the resolved account
     */
    async resolve({ commit, dispatch }, payload) {
        commit('SET_STATUS', 'resolving')
        commit('SET_ERROR', null)
        commit('SET_LAST_QUERY', payload)

        try {
            const account = await resolveCashAccount(payload)

            commit('SET_ACCOUNT', account)
            commit('SET_STATUS', 'ready')

            return account
        } catch (error) {
            commit('SET_STATUS', 'error')
            commit('SET_ERROR', error.message)
            dispatch('displayError', error.message, { root: true })

            throw error
        }
    },

    /**
     * Clear the current account (keep the list).
     *
     * @param {object} context
     */
    clear({ commit }) {
        commit('SET_ACCOUNT', null)
        commit('SET_STATUS', null)
        commit('SET_ERROR', null)
        commit('SET_LAST_QUERY', null)
    },
}

/* Mutations. */
const mutations = {
    SET_ACCOUNT(state, account) {
        state.account = account
    },
    SET_ACCOUNTS(state, accounts) {
        state.accounts = accounts
    },
    SET_STATUS(state, status) {
        state.status = status
    },
    SET_ERROR(state, error) {
        state.error = error
    },
    SET_LAST_QUERY(state, query) {
        state.lastQuery = query
    },
}

/* Export. */
export default {
    namespaced: true,
    state,
    getters,
    actions,
    mutations,
}
