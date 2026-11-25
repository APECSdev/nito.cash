/* apps/demo/vite.config.js
 *
 * The demo portal is a static Vite + Vue 3 app. `base: './'` matches the
 * wallet (apps/web/vite.config.js) so the built portal can be served from any
 * sub-path. The real wallet bundle is copied into dist/app/ by
 * scripts/copy-app.mjs after the Vite build; the portal frames it same-origin
 * so the tour can seed the store + mock chain (see src/lib/demo.js).
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    base: './',
    plugins: [vue(), tailwindcss()],
})
