/* apps/web/vitest.config.js
 *
 * Vitest config (Phase C of the Vue 3 migration). Replaces Jest
 * (`jest.config.js` / `vue-cli-service test:unit`), which was tied to
 * `@vue/test-utils@1` (Vue 2). Shares the Vite pipeline (plugin-vue, `@`
 * alias) so SFCs compile exactly as they do for the app build.
 */
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
    plugins: [
        /* Vue 3 SFC support for tests. */
        vue(),
    ],

    resolve: {
        alias: {
            /* Mirror the app's `@ -> src` alias. */
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
        /* The codebase imports SFCs extensionless in places. */
        extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json', '.vue'],
    },

    test: {
        /* Browser-like environment. */
        environment: 'jsdom',

        /* Jest-style globals (describe/it/expect) without imports. */
        globals: true,

        /* Test file locations. */
        include: ['tests/unit/**/*.spec.js'],

        /* Coverage (lcov feeds Codecov; mirrors the old Jest report path). */
        coverage: {
            provider: 'v8',
            reporter: ['lcov', 'text-summary'],
            reportsDirectory: './coverage',
            include: ['src/**/*.vue'],
            exclude: [
                '**/node_modules/**',
                'src/plugins/**',
                'tests/unit/**',
            ],
        },
    },
})
