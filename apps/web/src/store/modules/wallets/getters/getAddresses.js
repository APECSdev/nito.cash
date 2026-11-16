/* Import crypto helpers (local key/address cryptography). */
import { derivePath, toCashAddress } from '@/lib/bch/crypto.js'

/**
 * Get (Account) Addresses
 *
 * Returns (addresses for) ALL (in-use) accounts of BOTH chains:
 *   - branch 0: the (nito) receiving chain — every index in the accounts
 *     model (the model is also what nito's own send/change allocation
 *     advances — see getChangeAddress / nextAccount);
 *   - branch 1: the DISCOVERED (BIP44-standard) change chain — foreign
 *     wallets keep their change there, so restored wallets need those
 *     addresses scanned too (see getChangeIndexes / restoreWallet).
 *
 * Every entry carries `branch` (0 or 1) + `index`; the (full) derivation
 * path is `${accountBase}/${branch}/${index}` (see sendCrypto, which signs
 * per-input using that path). Consumers that only need the ADDRESS can use
 * `entry.address` directly (getBalance / getTokenBalance / getHistory /
 * openConn all do).
 */
const getAddresses = (state, getters, rootState, rootGetters) => (_wallet) => {
    /* Validate accounts. */
    if (!getters.getAccountsByWallet(_wallet)) {
        return null
    }

    /* Initialize (wallet) accounts. */
    const walletAccounts = getters.getAccountsByWallet(_wallet)

    /* Set the account base — getDerivationPath returns the branch-0 base
       (`m/44'/145'/0'/0` = purpose'/coin'/account'/change), so the CHANGE
       component is split off: slice(0, 4) keeps `m/44'/145'/0'` (three
       apostrophe levels). NOTE: slice(0, 3) would DROP the account level
       and derive a completely different wallet (caught live: every balance
       rendered 0 because the pool derived to wrong addresses). */
    const accountBase = getters.getDerivationPath(_wallet).split('/').slice(0, 4).join('/')

    /* Initialize HD node. */
    const hdNode = getters.getHDNode

    /* Set (active) network (for the CashAddress prefix). */
    const network = rootGetters['profile/getNetwork']

    /* Initialize addresses. */
    const addresses = []

    /* Add all active branch-0 (receiving) accounts. */
    Object.keys(walletAccounts).forEach(index => {
        const path = `${accountBase}/0/${index}`

        const childNode = derivePath(hdNode, path)

        addresses.push({
            address: toCashAddress(childNode, network),
            index,
            branch: 0,
        })
    })

    /* Add all DISCOVERED branch-1 (change chain) accounts.
       NOTE: the leading semicolon is REQUIRED (ASI): the preceding
       statement ends with `})`, and a following `(` would otherwise be
       parsed as a CALL of the arrow function (the exact trap that broke
       getHistory — see the fix comment there). */
    ;(getters.getChangeIndexes(_wallet) || []).forEach(index => {
        const path = `${accountBase}/1/${index}`

        const childNode = derivePath(hdNode, path)

        addresses.push({
            address: toCashAddress(childNode, network),
            index,
            branch: 1,
        })
    })

    /* Return addresses. */
    return addresses
}

/* Export module. */
export default getAddresses
