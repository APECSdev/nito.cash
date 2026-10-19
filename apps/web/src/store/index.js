/*
 * Vuex → Pinia Migration (Phase B-half-2) — Compatibility Layer
 *
 * This module replaces the Vuex `createStore` with a Pinia store, WITHOUT
 * touching the 50 store sub-files (getters/actions/mutations) or the 12
 * components that consume them. Those sub-files were written against the
 * Vuex module API (namespaced modules, `rootGetters`, `commit`/`dispatch`,
 * `state.<module>.<key>`), so we reconstruct an IDENTICAL surface on top of
 * a single Pinia store.
 *
 * What this provides (1:1 parity with the old Vuex store):
 *   - `this.$store.state.<module>.<key>`        (reactive, via mapState + direct)
 *   - `this.$store.getters['<module>/<name>']`  (cross-namespace getter access)
 *   - `this.$store.dispatch('<module>/<name>', payload)` + `{ root: true }`
 *   - `this.$store.commit('<module>/<name>', payload)`
 *   - Namespaced `mapGetters('<module>', [...])` / `mapActions('<module>', [...])`
 *   - Global (non-namespaced) `system` actions/getters (displayError, etc.)
 *   - `mapState({ key: state => state.<module>... })` object form
 *
 * The `vuex` import specifier in components is aliased to `@/store/vuex-shim`
 * (see vite.config.js), which re-exports the shims defined here.
 */

/* Import Pinia. */
import { defineStore } from 'pinia'

/* Import cookie helper (for the `nito` target's cross-subdomain persistence). */
import Cookies from 'js-cookie'

/* Import (local) module definitions. */
import blockchain from './modules/blockchain'
import concierge from './modules/concierge'
import pool from './modules/pool'
import profile from './modules/profile'
import system from './modules/system'
import utils from './modules/utils'
import wallets from './modules/wallets'

/* Module registry (name -> { namespaced, state, getters, actions, mutations }). */
const MODULES = {
    blockchain,
    concierge,
    pool,
    profile,
    system,
    utils,
    wallets,
}

/* A module is namespaced ONLY if it explicitly sets `namespaced: true`.
   The `system` module deliberately leaves `namespaced` commented out
   (`undefined`) so its actions/getters/mutations are registered GLOBALLY
   (bare names) — matching the original Vuex store's behavior. */
const isNamespaced = (name) => MODULES[name].namespaced === true

/*
 * Build the flat `rootGetters` / dispatch / commit registries.
 *
 * Keys are `<module>/<name>` for namespaced modules, or bare `<name>` for the
 * (global) system module — matching the original Vuex store exactly.
 */
const flatGetters = {}   // '<module>/<name>' | '<name>'  -> getter fn
const flatActions = {}   // ''                              -> action fn
const flatMutations = {} // ''                              -> mutation fn

Object.keys(MODULES).forEach((modName) => {
    const mod = MODULES[modName]
    const prefix = isNamespaced(modName) ? `${modName}/` : ''

    Object.keys(mod.getters || {}).forEach((k) => {
        flatGetters[prefix + k] = { modName, name: k, fn: mod.getters[k] }
    })
    Object.keys(mod.actions || {}).forEach((k) => {
        /* `fn` is read LIVE from the module (not snapshotted) so tests can
           stub an action on the module and have dispatch pick it up. */
        flatActions[prefix + k] = {
            modName,
            name: k,
            get fn() { return MODULES[modName].actions[k] },
        }
    })
    Object.keys(mod.mutations || {}).forEach((k) => {
        flatMutations[prefix + k] = {
            modName,
            name: k,
            get fn() { return MODULES[modName].mutations[k] },
        }
    })
})

/*
 * The Pinia store. State is the (reactive) union of each module's `state()`
 * under its module key, so `state.profile.ms`, `state.wallets.a`, etc. work
 * exactly as before.
 */
/* Build the target-dependent storage (cookie for `nito`, else localStorage).
   Declared before `defineStore` so it's available at store-definition time. */
function buildStorage() {
    if (import.meta.env.VITE_APP_TARGET === 'nito') {
        /* Cross-subdomain secure cookie options (see original store/index.js). */
        const options = {
            domain: '.nito.cash',
            secure: true,
        }

        return {
            getItem: (key) => Cookies.get(key, options) ?? null,
            setItem: (key, value) => Cookies.set(key, value, options),
            removeItem: (key) => Cookies.remove(key, options),
        }
    }

    /* Default: localStorage (for-all deployment; cookies NOT used).
       Guard `window` for non-browser (test/SSR) contexts. */
    return (typeof window !== 'undefined') ? window.localStorage : undefined
}

export const useStore = defineStore('main', {
    state: () => {
        const state = {}

        Object.keys(MODULES).forEach((modName) => {
            /* Each module's `state` is an object (Vuex calls it as a fn in
               strict builds; here we shallow-copy the literal). */
            const modState = MODULES[modName].state

            state[modName] = (typeof modState === 'function') ? modState() : { ...modState }
        })

        return state
    },

    /* Persistence (Phase B-half-2, parity with vuex-persistedstate):
       the whole root state is persisted. On the `nito` target it goes to a
       cross-subdomain secure cookie (`.nito.cash`); otherwise localStorage.
       `VITE_APP_TARGET` replaces the old `process.env.VUE_APP_TARGET`. */
    persist: {
        key: 'vuex',
        storage: buildStorage(),
    },
})

/*
 * Wire the Vuex-compatible runtime onto each store instance.
 *
 * We expose a `$store`-shaped facade: reactive `state`, computed `getters`
 * (an object of getters keyed by `<module>/<name>`), plus `dispatch`/`commit`
 * that resolve namespaced paths and forward the Vuex calling conventions.
 */
function buildFacade(store) {
    /* Reactive root state proxy: `state.<module>`. */
    const state = store

    /* Per-module state accessor. */
    const moduleState = (modName) => store[modName]

    /*
     * Build the live `rootGetters` object. Each key is a lazily-evaluated
     * accessor that invokes the underlying Vuex getter with the proper
     * `(state, getters, rootState, rootGetters)` signature.
     */
    const makeRootGetters = () => {
        const rootGetters = {}

        Object.keys(flatGetters).forEach((key) => {
            const { modName, name, fn } = flatGetters[key]

            Object.defineProperty(rootGetters, key, {
                enumerable: true,
                get() {
                    /* Local (module) getters object for this getter's own module. */
                    const localGetters = buildLocalGetters(modName, rootGetters)

                    return fn(moduleState(modName), localGetters, state, rootGetters)
                },
            })
        })

        return rootGetters
    }

    /* Build a module-local getters object (bare names) bound to rootGetters. */
    const buildLocalGetters = (modName, rootGetters) => {
        const localGetters = {}
        const prefix = isNamespaced(modName) ? `${modName}/` : ''

        Object.keys(MODULES[modName].getters || {}).forEach((name) => {
            Object.defineProperty(localGetters, name, {
                enumerable: true,
                get() {
                    return rootGetters[prefix + name]
                },
            })
        })

        return localGetters
    }

    /*
     * Dispatch (Vuex-compatible).
     *   dispatch('displayError', msg)                  -> global (system) action
     *   dispatch('wallets/sendCrypto', pkg)            -> namespaced action
     *   dispatch('wallets/nextAccount', 'BCH', { root: true })
     *   commit('system/setError', msg)                 -> namespaced mutation
     */
    const dispatch = (type, payload, options = {}, _localModule = null) => {
        /* Resolve the action entry. A `<module>/<name>` path is used as-is.
           A bare (no '/') type targets a GLOBAL action, OR a LOCAL action
           within `_localModule` (the calling action's own module). */
        let entry = flatActions[type]

        if (!entry && _localModule && !options.root) {
            entry = flatActions[`${_localModule}/${type}`]
        }

        if (!entry) {
            throw new Error(`[store] unknown action type: ${type}`)
        }

        const { modName, fn } = entry
        const rootGetters = facade.getters

        const context = {
            state: moduleState(modName),
            getters: buildLocalGetters(modName, rootGetters),
            rootState: state,
            rootGetters,
            /* Local commit/dispatch resolve bare names within THIS module. */
            commit: (t, p, o) => commit(t, p, o, modName),
            dispatch: (t, p, o) => dispatch(t, p, o, modName),
        }

        return fn(context, payload)
    }

    const commit = (type, payload, options = {}, _localModule = null) => {
        /* Resolve the mutation entry (namespaced path, else local to the
           calling action's module). */
        let entry = flatMutations[type]

        if (!entry && _localModule) {
            entry = flatMutations[`${_localModule}/${type}`]
        }

        if (!entry) {
            throw new Error(`[store] unknown mutation type: ${type}`)
        }

        return entry.fn(moduleState(entry.modName), payload)
    }

    /* The facade. `getters` is built once (its accessors close over live state). */
    const facade = {
        state,
        commit,
        dispatch,
    }

    facade.getters = makeRootGetters()

    return facade
}

/*
 * Pinia plugin: attach the `$store`-compatible facade to the app so
 * `this.$store` (Options API) resolves to it, and stash it for the shims.
 *
 * The facade is stored on `globalThis` (NOT a module-level `let`) because
 * Vitest/Vite can instantiate this module in more than one realm (the app
 * imports `@/store` directly, while components import the `vuex` shim, which
 * re-imports `@/store`). A module-local variable would leave one copy's
 * `_facade` as `null`. `globalThis` guarantees a single shared reference.
 */
const FACADE_KEY = '__nito_store_facade__'

/*
 * Build + cache the facade for the `main` store (idempotent). Called from
 * StoreCompatPlugin AND exported so `main.js` / tests can build it directly
 * after `useStore()` — Pinia plugins do NOT reliably re-fire for a store that
 * was already instantiated in the same (test) worker, so an explicit ensure
 * is the robust path.
 */
export function ensureStoreFacade(store) {
    if (!globalThis[FACADE_KEY] && store && store.$id === 'main') {
        globalThis[FACADE_KEY] = buildFacade(store)
    }

    return globalThis[FACADE_KEY] || null
}

export function StoreCompatPlugin({ store }) {
    if (store.$id === 'main') {
        ensureStoreFacade(store)
    }
}

/* Retrieve the active facade (used by the map* shims). */
export function getStoreFacade() {
    return globalThis[FACADE_KEY] || null
}

/* Vue plugin: expose `this.$store` to all components (Options API). */
export default {
    install(app) {
        app.config.globalProperties.$store = {
            get state() { return getStoreFacade().state },
            get getters() { return getStoreFacade().getters },
            dispatch: (...args) => getStoreFacade().dispatch(...args),
            commit: (...args) => getStoreFacade().commit(...args),
        }
    },
}
