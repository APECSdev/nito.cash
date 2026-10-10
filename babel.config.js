module.exports = {
  presets: [
    '@vue/cli-plugin-babel/preset'
  ],
  plugins: [
    /* Ledger (@ledgerhq/hw-app-btc v11) and its crypto deps (@noble/*, @scure/*)
       ship untranspiled ES2020+ syntax (class fields, optional chaining,
       nullish coalescing, private methods) that webpack 4 cannot parse.
       These transforms let the Vue CLI 4 build transpile them (see
       `transpileDependencies` in vue.config.js). They are no-ops for code that
       does not use the syntax, and become unnecessary once the Vite migration
       (which transpiles modern syntax natively) replaces the cli-service. */
    '@babel/plugin-transform-class-properties',
    '@babel/plugin-transform-private-methods',
    '@babel/plugin-transform-optional-chaining',
    '@babel/plugin-transform-nullish-coalescing-operator'
  ]
}
