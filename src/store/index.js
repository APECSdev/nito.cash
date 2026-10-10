/* Import (core) modules. */
import Vue from 'vue'
import Vuex from 'vuex'

/* Import persisted state (for vuex). */
import createPersistedState from 'vuex-persistedstate'
import Cookies from 'js-cookie'

/* Import (local) modules. */
import blockchain from './modules/blockchain'
import concierge from './modules/concierge'
import profile from './modules/profile'
import system from './modules/system'
import utils from './modules/utils'
import wallets from './modules/wallets'

/* Initialize Vuex. */
Vue.use(Vuex)

/* Set modules. */
const modules = {
    blockchain,
    concierge,
    profile,
    system,
    utils,
    wallets,
}

/* Initialize plugins. */
let plugins = null

/* Set plugin (based on target environment). */
if (process.env.VUE_APP_TARGET === 'nito') {
    /* Set cookie options. */
    const options = {
        domain: '.nito.cash',
        secure: true
    }

    /**
     * Nito State
     *
     * A universal state, accessible across ALL [*.]nito.cash
     * domains AND sub-domains.
     *
     * Allows shared account access to specific sub-domains, notably:
     *     1. ipfs.nito.cash
     *     2. nightly.nito.cash
     *     3. and ALL distinct versions (eg. v200219.nito.cash)
     *
     * NOTE: Cookies are EACH limited to 4 KiB in size.
     *       (compared to the local storage limit of 5 MiB)
     *
     *       This is going to mean considerations on wallet format MUST be
     *       taken into account to prevent ANY data loss or corruption
     *       (eg. loss of private key).
     *
     *       Large data sets MUST be deterministic, in the event that they
     *       ever exceed the storage limit.
     *
     * FIXME: We will need to address the security issues with `api.nito.cash`.
     *        This domain will now be sent an "unencrypted" copy of the cookie
     *        upon ANY reqeust (due to `SameSite` rules).
     *
     *        Would should consider implementing `api.telr.io`, for ANY and ALL
     *        account maintenance / recovery services.
     */
    const nitoState = {
        storage: {
            getItem: (key) => Cookies.get(key, options),
            setItem: (key, value) => Cookies.set(key, value, options),
            removeItem: (key) => Cookies.remove(key, options)
        }
    }

    /* Set plugins. */
    plugins = [
        createPersistedState(nitoState)
    ]
} else {
    /* Set plugins. */
    // NOTE: For security reasons, cookies are NOT used in the
    //       default (for-all) deployment. (default is local storage)
    plugins = [
        createPersistedState()
    ]
}

/* Set strict. */
const strict = process.env.NODE_ENV !== 'production'

/* Export store. */
export default new Vuex.Store({
    modules,
    plugins,
    strict,
})
