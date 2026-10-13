/* Import crypto helpers (local key/address cryptography). */
import { derivePath, toCashAddress } from '@/lib/bch/crypto.js'

/**
 * Get (Wallet) Address
 *
 * Returns the next avaialble "receiving" (account) address,
 * for the specified wallet type.
 *
 * TODO: Add support for ALL wallet types: BAI, BCH, DAI, NITO
 */
const getAddress = (state, getters, rootState, rootGetters) => (_wallet) => {
    /* Validate accounts. */
    if (!getters.getAccountsByWallet(_wallet)) {
        return null
    }

    /* Initialize (wallet) accounts. */
    const walletAccounts = getters.getAccountsByWallet(_wallet)

    /* Initialize current (account) index. */
    const currentIndex = Math.max(...Object.keys(walletAccounts))

    /* Set derivation path. */
    const path = `${getters.getDerivationPath(_wallet)}/${currentIndex}`
    // console.log('GET ADDRESS (path)', path)

    /* Initialize HD node. */
    const hdNode = getters.getHDNode

    /* Initialize child node. */
    const childNode = derivePath(hdNode, path)

    /* Set (receiving) address (prefixed for the ACTIVE network). */
    const address = toCashAddress(childNode, rootGetters['profile/getNetwork'])
    // console.log('GET ADDRESS (receiving address)', address)

    /* Return address. */
    return address
}

/* Export module. */
export default getAddress
