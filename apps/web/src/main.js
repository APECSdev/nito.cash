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

/* Import (core) modules. */
import { createApp } from 'vue'

/* Import (local) modules. */
import router from './router'
import store from './store'

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

/* Register plugins. */
app.use(store)
app.use(router)
app.use(i18n)
app.use(SvgIcon)

/* Attach Bugsnag's Vue error handler. */
useBugsnag(app)

/* Mount application. */
app.mount('#app')
