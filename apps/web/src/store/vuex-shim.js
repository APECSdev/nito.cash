/*
 * `vuex` import shim (Phase B-half-2).
 *
 * Components still `import { mapGetters, mapActions, mapState } from 'vuex'`.
 * vite.config.js aliases the bare specifier `vuex` to this module, which
 * re-implements those three Options-API helpers against the Pinia-backed
 * facade in `@/store` — so no component needs to change.
 *
 * Supported forms (all that the codebase uses):
 *   mapGetters([...])                 global getters (bare names)
 *   mapGetters('<module>', [...])     namespaced getters
 *   mapActions([...])                 global actions
 *   mapActions('<module>', [...])     namespaced actions
 *   mapState({ key: state => ... })   object form (fn receives root state)
 */

import { getStoreFacade } from '@/store'

/* Normalize a mapping argument into [{ key, name }] pairs. */
function normalizeMap(map) {
    if (Array.isArray(map)) {
        return map.map((name) => ({ key: name, name }))
    }

    /* Object form: { localKey: 'getterName' | fn }. */
    return Object.keys(map).map((key) => ({ key, name: map[key] }))
}

/*
 * mapGetters.
 * Without a module namespace, getters are looked up bare (global/system).
 * With a namespace, they're prefixed `<module>/<name>`.
 */
export function mapGetters(namespaceOrMap, maybeMap) {
    const hasNamespace = typeof namespaceOrMap === 'string'
    const namespace = hasNamespace ? namespaceOrMap : null
    const map = normalizeMap(hasNamespace ? maybeMap : namespaceOrMap)

    const mapped = {}

    map.forEach(({ key, name }) => {
        mapped[key] = function () {
            const facade = getStoreFacade()
            const path = namespace ? `${namespace}/${name}` : name

            return facade.getters[path]
        }
    })

    return mapped
}

/*
 * mapActions.
 * Dispatch goes through the facade (which resolves global vs namespaced).
 */
export function mapActions(namespaceOrMap, maybeMap) {
    const hasNamespace = typeof namespaceOrMap === 'string'
    const namespace = hasNamespace ? namespaceOrMap : null
    const map = normalizeMap(hasNamespace ? maybeMap : namespaceOrMap)

    const mapped = {}

    map.forEach(({ key, name }) => {
        mapped[key] = function (payload) {
            const facade = getStoreFacade()
            const path = namespace ? `${namespace}/${name}` : name

            return facade.dispatch(path, payload)
        }
    })

    return mapped
}

/*
 * mapState (object form only, as used in this codebase):
 *   mapState({ key: state => state.profile.ms })
 * The fn receives the reactive root state.
 */
export function mapState(map) {
    const mapped = {}

    Object.keys(map).forEach((key) => {
        const fn = map[key]

        mapped[key] = function () {
            const facade = getStoreFacade()

            return fn.call(this, facade.state)
        }
    })

    return mapped
}

/* mapMutations is unused in this codebase; provided for completeness. */
export function mapMutations(namespaceOrMap, maybeMap) {
    const hasNamespace = typeof namespaceOrMap === 'string'
    const namespace = hasNamespace ? namespaceOrMap : null
    const map = normalizeMap(hasNamespace ? maybeMap : namespaceOrMap)

    const mapped = {}

    map.forEach(({ key, name }) => {
        mapped[key] = function (payload) {
            const facade = getStoreFacade()
            const path = namespace ? `${namespace}/${name}` : name

            return facade.commit(path, payload)
        }
    })

    return mapped
}
