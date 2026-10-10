module.exports = {
    publicPath: '',
    productionSourceMap: false,

    /* Do NOT run eslint-loader during builds. The app intentionally uses
       console.* debug logging, and `.eslintrc.js` promotes `no-console` to an
       error under NODE_ENV=production — which fails CI builds (e.g. Cloudflare
       Pages) even though the logging is deliberate. Linting stays available as
       a separate step via `pnpm run lint` instead of gating the build. */
    lintOnSave: false,

    /* Transpile Ledger ES-module packages and their modern crypto deps (they
       ship class fields / optional chaining / ES2020+ that webpack 4 cannot
       parse without Babel). Paired with the transform plugins in babel.config.js. */
    transpileDependencies: [
        /@ledgerhq\/(.+)/,
        /@noble\/(.+)/,
        /@scure\/(.+)/,
        /bitcoinjs-lib/,
    ]
}
