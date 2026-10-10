module.exports = {
    publicPath: '',
    productionSourceMap: false,

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
