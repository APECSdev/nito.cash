/* Import libraries. */
// import telr from '../../api/telr'

/* Import modules (getters). */
// ...

/* Import modules (actions). */
import displayError from './system/actions/displayError'
import displayNotification from './system/actions/displayNotification'

/* Import modules (mutations). */
import setAppStarts from './system/mutations/setAppStarts'
import setError from './system/mutations/setError'
import setNotification from './system/mutations/setNotification'

/* Initialize state. */
const state = {
    /**
     * Application Starts
     */
    as: 0,

    /**
     * Application Version
     */
    av: null,

    /**
     * Error Message
     */
    em: null,

    /**
     * Notices
     *
     * System notices that nag/remind the user of some important action or
     * information; which can be permanently disabled ("Do Not Show Again")
     * via checkbox and confirmation.
     *
     * NOTE: Unique 1-byte (hex) codes (up to 255) are used to reduce the size
     *       of this storage field.
     */
    n: {},

    /**
     * Notification Message
     */
    nm: null,

    /**
     * Schema Version
     *
     * v1: Developer Preview
     * v2: Cookie (Key/Value) Optimization
     */
    sv: 2,
}

/* Getters. */
const getters = {
    /*
     * Get Dark Mode
     *
     * NOTE: The dark-mode flag lives in the (persisted) PROFILE flags
     *       (`profile.f.dm` — set via Settings' toggle and initProfile's
     *       defaults); the system module never had a `dm` field, so the
     *       previous `state.dm` read always returned `undefined`.
     */
    getDarkMode(state, getters, rootState, rootGetters) {
        /* Retrieve (profile) flags. */
        const flags = rootGetters['profile/getFlags']

        /* Return (dark-mode) flag. */
        return !!(flags && flags.dm)
    },
}

/* Actions. */
const actions = {
    displayError,
    displayNotification,
}

/* Mutations. */
const mutations = {
    setAppStarts,
    setError,
    setNotification,
}

/* Export. */
// NOTE: We DO NOT namespace here to allow for global use of `dispatch`.
export default {
    // namespaced: true,
    state,
    getters,
    actions,
    mutations
}
