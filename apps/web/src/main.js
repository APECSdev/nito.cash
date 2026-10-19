/*
 * Node globals polyfill.
 *
 * NOTE (Vite): webpack auto-polyfilled Node builtins like `Buffer` (used by
 *       BITBOX / crypto deps); Vite does NOT. Provide `Buffer` as a global
 *       before any app/library code runs.
 */
import { Buffer } from 'buffer'
if (typeof window !== 'undefined' && !window.Buffer) {
    window.Buffer = Buffer
}

/*
 * Import the Tailwind stylesheet FIRST so its preflight (`@layer base`) is
 * emitted before App.vue's global styles. Both live in `@layer base`, so source
 * order breaks specificity ties; loading this first lets App.vue's rules (e.g.
 * the global `h6`) override preflight, preserving the original rendering.
 */
import './assets/tailwind.css'

/* Import (core) modules. */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPersist from 'pinia-plugin-persistedstate'

/* Import (local) modules. */
import router from './router'
import StoreFacade, { StoreCompatPlugin, useStore, ensureStoreFacade } from './store'

/* Import main application. */
import App from './App.vue'

/* Import i18n module. */
import { i18n } from './plugins/i18n'

/* Import SVG icon (global <svgicon>) plugin. */
import SvgIcon from './plugins/svgicon'

/* Import Bugsnag (error-handling). */
import { useBugsnag } from './plugins/bugsnag'

/* Initialize Vue. */
const app = createApp(App)

/* Initialize Pinia (state). The compat plugin reconstructs the Vuex-style
   `$store` facade (namespaced getters/actions/mutations) over the Pinia store,
   and the persistedstate plugin keeps state in cookie/localStorage as before. */
const pinia = createPinia()
pinia.use(StoreCompatPlugin)
pinia.use(piniaPersist)

/* Register plugins. */
app.use(pinia)

/* Instantiate the `main` store EAGERLY and build the `$store` facade BEFORE
   any component's created() runs. `ensureStoreFacade` is idempotent and does
   not rely on Pinia plugin timing. */
const storeFacade = ensureStoreFacade(useStore())

/* Unseal the shielded-pool note store (decrypt the persisted ciphertext into
   the runtime-only `pool.notes` mirror). Fire-and-forget: no seed yet or a
   corrupt blob leaves the pool locked without blocking app boot. */
storeFacade.dispatch('pool/unlockPool')
    .catch((err) => console.warn('[pool] failed to unseal notes', err))

app.use(StoreFacade) /* exposes `this.$store` to the Options API */
app.use(router)
app.use(i18n)
app.use(SvgIcon)

/* Attach Bugsnag's Vue error handler. */
useBugsnag(app)

/* Mount application. */
app.mount('#app')
