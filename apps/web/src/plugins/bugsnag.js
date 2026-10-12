/* Import bugsnag modules. */
import Bugsnag from '@bugsnag/js'
import BugsnagPluginVue from '@bugsnag/plugin-vue'

/* Initialize bugsnag. */
Bugsnag.start({
    apiKey: 'ef854244cf93e02c094a333e5fee2192',
    plugins: [new BugsnagPluginVue()],
})

/**
 * Attach bugsnag to a Vue 3 app instance.
 *
 * Called from `main.js` after `createApp(...)` so the plugin can install its
 * Vue error handler onto the running application.
 */
export function useBugsnag(app) {
    /* Retrieve the (registered) Vue plugin and attach it to the app.
       NOTE (@bugsnag/plugin-vue v9): the plugin returns an `{ install(app) }`
       object, so we register it like any other Vue plugin. */
    app.use(Bugsnag.getPlugin('vue'))
}

/* Export the (started) client for direct use if needed. */
export default Bugsnag
