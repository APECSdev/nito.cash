/**
 * Init Wallet
 *
 * NOTE: This is a legacy, currently-inactive initializer:
 *   1. `App.vue` calls it with NO argument, so the original `_wallet.network`
 *      logic could never execute.
 *   2. It also (incorrectly) dispatched `getHDNode` — a GETTER, not an action.
 *   3. The (wallet) account pool (`state.wallets.a`) is initialized by
 *      `createWallet` and is PERSISTED, so accounts are already restored on
 *      every reload — making this advance-on-load logic redundant.
 *   4. Naively re-enabling its "advance when address 0 has history" check
 *      would OVER-advance the account pool on EVERY reload.
 *
 *      Proper BIP44-style account discovery (loop until the first unused
 *      account index) is a FUTURE enhancement (tracked separately). For now
 *      this is an intentionally-safe no-op, free of the retired BITBOX
 *      dependency.
 */
const initWallet = async ({ dispatch }, _wallet) => {
    console.log('INIT WALLET', _wallet) // eslint-disable-line no-console

    // NOTE: Intentionally a no-op (see header comment).
}

/* Export module. */
export default initWallet
