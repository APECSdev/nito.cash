/* Import crypto helpers (mnemonic -> master entropy). */
import { entropyFromMnemonic } from '@/lib/bch/crypto.js'

/**
 * Restore Wallet
 *
 * Connects an EXISTING wallet to this app from its BIP39 seed phrase
 * (the "Connect with Seed Phrase" flow). Standard 12/15/18/21/24-word
 * english phrases are accepted — nito SeedVault phrases AND phrases from
 * other BIP39-compatible wallets (the entropy round-trip is lossless and
 * the BIP39 seed depends only on the mnemonic string).
 *
 * Flow:
 *   1. mnemonic -> (validated) master entropy hex — THROWS on an invalid
 *      phrase (wrong word count / bad checksum) BEFORE anything changes.
 *   2. Set the restored master seed (profile).
 *   3. Reset the (wallet) accounts model + imported seeds. Address
 *      derivation, balances and history re-derive reactively from the
 *      restored seed (the getAddresses / getHDNode getters read the
 *      master seed directly), and Receive's openConn subscribes the
 *      fresh pool when it mounts.
 *
 * NOTE: this REPLACES the wallet currently in the app (same semantic as
 *       "Burn your wallet" + a new wallet, but with a known seed).
 */
const restoreWallet = async ({ dispatch }, _mnemonic) => {
    /* Restore the master entropy from the phrase (throws on invalid). */
    const entropy = entropyFromMnemonic(_mnemonic)

    /* Set the restored master seed (profile). */
    await dispatch('profile/updateMasterSeed', entropy, { root: true })

    /* Reset the (wallet) accounts model for the restored seed. */
    dispatch('createWallet')

    /* Return the restored (master) entropy. */
    return entropy
}

/* Export module. */
export default restoreWallet
