/* apps/web/vite.config.js
 *
 * Vite build config. Vite is the PRODUCTION build (since Phase B of the Vue 3
 * migration); the legacy webpack toolchain (@vue/cli-service, vue.config.js,
 * babel.config.js, the Babel transform plugins, core-js, .browserslistrc) was
 * removed in Phase E.
 */
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
    /* Relative base so the static SPA can be served from any sub-path
       (matches vue.config.js `publicPath: ''`). */
    base: './',

    plugins: [
        /* Vue 2.7 SFC support (template compiler is bundled in vue@2.7). */
        vue(),

        /* Tailwind v4 (scans sources, generates the utility layer). */
        tailwindcss(),

        /* Node builtins/globals for the browser. webpack 4 auto-polyfilled these
           (Buffer, process, stream, crypto) and BITBOX / the Ledger deps use bare
           `Buffer` at runtime; Vite does NOT polyfill, so provide them here. */
        nodePolyfills({
            globals: { Buffer: true, global: true, process: true },
            protocolImports: true,
        }),
    ],

    resolve: {
        alias: [
            /* Mirror webpack's `@ -> src` alias used across the codebase. */
            { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },

            /* Phase B-half-2 (Vuex → Pinia): components still
               `import { mapGetters, mapActions, mapState } from 'vuex'`.
               Alias the bare `vuex` specifier to the shim, which re-implements
               those helpers against the Pinia-backed facade in `@/store`.
               The regex anchors an EXACT match so `vuex-persistedstate` and
               other `vuex*` packages are NOT clobbered. */
            { find: /^vuex$/, replacement: fileURLToPath(new URL('./src/store/vuex-shim.js', import.meta.url)) },
        ],
        /* The codebase imports SFCs extensionless (`@/views/Splash`). Webpack
           resolves `.vue` automatically; Vite does not, so add it here. */
        extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.vue'],
    },

    /* The app reads `process.env.VUE_APP_TARGET` / `NODE_ENV` (webpack-style).
       Shim them for the Vite build; Phase B moves these to `import.meta.env`. */
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
        'process.env.VUE_APP_TARGET': JSON.stringify(process.env.VITE_APP_TARGET || process.env.VUE_APP_TARGET || 'all'),
    },

    build: {
        /* Emit to a separate dir so the Vite output never clobbers webpack's
           `dist/` while both toolchains coexist during the migration. */
        outDir: 'dist-vite',
        sourcemap: false,
    },
})
