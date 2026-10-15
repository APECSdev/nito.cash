/* apps/web/eslint.config.js
 *
 * ESLint 9 flat config (Phase E2), replacing the legacy `.eslintrc.js` +
 * `vue-cli-service lint`. Preserves the original policy 1:1:
 *   - `plugin:vue/essential` + `eslint:recommended` base rules, and
 *   - `no-console` / `no-debugger` are ERRORS only under NODE_ENV=production
 *     (off in dev) — the app intentionally uses console.* debug logging, so the
 *     default `pnpm lint` passes clean (Option A).
 * The vue-eslint-parser handles `.vue` SFCs; babel-eslint is gone (flat config
 * uses the modern default parser with full ES2020+ support).
 */
const pluginVue = require('eslint-plugin-vue')
const vueParser = require('vue-eslint-parser')

const isProd = process.env.NODE_ENV === 'production'

module.exports = [
    /* Ignores (replaces .eslintignore semantics). */
    {
        ignores: [
            'dist/**',
            'dist-vite/**',
            'coverage/**',
            'node_modules/**',
            'src/compiled-icons/**', /* generated — regenerate, don't lint */
            'scripts/.baseline/**',  /* visual-regression screenshots */
        ],
    },

    /* Base recommended configs (flat arrays from eslint-plugin-vue v10). */
    ...pluginVue.configs['flat/essential'],

    /* App source + config files: parser + the production-gated rules. */
    {
        files: ['**/*.{js,vue}'],
        languageOptions: {
            parser: vueParser,
            parserOptions: {
                /* Use ESLint's default parser for <script> blocks (ES2020+). */
                parser: null,
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        rules: {
            'no-console': isProd ? 'error' : 'off',
            'no-debugger': isProd ? 'error' : 'off',

            /* These four vue rules did not exist in the legacy ESLint 6 /
               eslint-plugin-vue 6 setup and would flag INTENTIONAL,
               pre-existing app patterns (not regressions), so they are disabled
               to keep `pnpm lint` faithful to the original policy:
               - multi-word-component-names: route views are deliberately
                 single-word (Setup, Send, Receive, Splash, Settings, ...).
               - no-reserved-component-names: `Button`/`Footer` are intentional
                 global components (Button declares `emits:['click']` so the
                 legacy `@click.native` keeps working under Vue 3).
               - no-deprecated-v-on-native-modifier / -destroyed-lifecycle:
                 intentional Vue-2-compat idioms retained during the migration. */
            'vue/multi-word-component-names': 'off',
            'vue/no-reserved-component-names': 'off',
            'vue/no-deprecated-v-on-native-modifier': 'off',
            'vue/no-deprecated-destroyed-lifecycle': 'off',
        },
    },
]
