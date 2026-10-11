/* apps/web/vite.config.js
 *
 * Vite build config (Phase A of the Vue 3 migration). Runs the CURRENT Vue 2.7
 * app through Vite + Tailwind v4 in parallel with the legacy webpack build, so
 * the toolchain is proven before the Vue 3 runtime flip (Phase B). Webpack /
 * @vue/cli-service (vue.config.js) remains the production build until then.
 */
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue2'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    /* Relative base so the static SPA can be served from any sub-path
       (matches vue.config.js `publicPath: ''`). */
    base: './',

    plugins: [
        /* Vue 2.7 SFC support (template compiler is bundled in vue@2.7). */
        vue(),

        /* Tailwind v4 (scans sources, generates the utility layer). */
        tailwindcss(),
    ],

    resolve: {
        alias: {
            /* Mirror webpack's `@ -> src` alias used across the codebase. */
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
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
