/**
 * Compiled-Icons Registration Shim
 *
 * The (generated) `@/compiled-icons/*.js` modules were produced by
 * `vue-svgicon`'s `vsvg` generator and originally did
 * `var icon = require('vue-svgicon'); icon.register({ ... })`.
 *
 * `vue-svgicon` has been removed in the Vue 3 migration (replaced by the
 * global `<svgicon>` plugin in `@/plugins/svgicon.js`). This shim provides a
 * drop-in `register()` so the generated modules keep working unchanged,
 * feeding their icon data into the plugin's global registry.
 */

import { register } from '@/plugins/svgicon'

/* Expose a `register` matching vue-svgicon's module interface. */
export default {
    register,
}

/* Also export named (for flexibility). */
export { register }
