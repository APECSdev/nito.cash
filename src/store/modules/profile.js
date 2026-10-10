/* Import libraries. */
// import telr from '../../api/telr'

/* Import modules (getters). */
import getFlags from './profile/getters/getFlags'
import getLocale from './profile/getters/getLocale'
import getMasterIV from './profile/getters/getMasterIV'
import getMasterSeed from './profile/getters/getMasterSeed'

/* Import modules (actions). */
import destroyProfile from './profile/actions/destroyProfile'
import initProfile from './profile/actions/initProfile'
import updateMasterIV from './profile/actions/updateMasterIV'
import updateMasterSeed from './profile/actions/updateMasterSeed'

/* Import modules (mutations). */
import setEmptyProfile from './profile/mutations/setEmptyProfile'
import setFlags from './profile/mutations/setFlags'
import setLocale from './profile/mutations/setLocale'
import setMasterIV from './profile/mutations/setMasterIV'
import setMasterSeed from './profile/mutations/setMasterSeed'

/* Initialize state. */
const state = {
    /**
     * Flags
     *
     * 1. Unconfirmed transactions (ut)
     */
    f: null,

    /**
     * Locale
     *
     * Controls the localization language.
     * (default is english)
     */
    l: null,

    /**
     * Master Initialization Vector
     *
     * A 16-byte seed, which can be generated randomly, or by importing
     * from an existing wallet.
     */
    miv: null,

    /**
     * Master Seed
     *
     * A 32-byte seed, which can be generated randomly, or by importing
     * from an existing wallet.
     */
    ms: null,
}

/* Getters. */
const getters = {
    getFlags,
    getLocale,
    getMasterIV,
    getMasterSeed,
}

/* Actions. */
const actions = {
    destroyProfile,
    initProfile,
    updateMasterIV,
    updateMasterSeed,
}

/* Mutations. */
const mutations = {
    setEmptyProfile,
    setFlags,
    setLocale,
    setMasterIV, // WARNING: This is a high risk attack vector.
    setMasterSeed, // WARNING: This is the highest risk attack vector.
}

/* Export. */
export default {
    namespaced: true,
    state,
    getters,
    actions,
    mutations
}
