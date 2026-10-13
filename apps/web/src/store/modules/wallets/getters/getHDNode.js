/* Import crypto helpers (local key/address cryptography). */
import { hdNodeFromEntropy } from '@/lib/bch/crypto.js'

/**
 * Get HD Node
 */
const getHDNode = (state, getters, rootState, rootGetters) => {
    // console.log('GET HD NODE (rootGetters)', rootGetters)

    /* Set master seed. */
    const masterSeed = rootGetters['profile/getMasterSeed']

    /* Set locale. */
    const locale = rootGetters['profile/getLocale']

    /**
     * Create mnemonic wordlist using BIP-39.
     * (https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
     *
     * Available languages are:
     *   01. English
     *   02. Japanese
     *   03. Korean
     *   04. Spanish
     *   05. Chinese (Simplified)
     *   06. Chinese (Traditional)
     *   07. French
     *   08. Italian
     *   09. Czech
     *
     * NOTE: only the English wordlist is wired up (as before); the locale
     *       switch below is retained for future multi-language support.
     */
    let language = null

    /* Handle language selection. */
    switch(locale) {
    case 'en-US':
        language = 'english'
        break
    default:
        language = 'english'
    }

    /**
     * Initialize HD node.
     *
     * Derives mnemonic -> BIP-39 seed -> BIP-32 master node (English wordlist),
     * byte-for-byte identical to the previous bitbox implementation.
     */
    // console.log('MNEMONIC WORDLIST (language)', language)
    const hdNode = hdNodeFromEntropy(masterSeed)
    // console.log('HD NODE', hdNode)

    /* Return HD node. */
    return hdNode
}

/* Export module. */
export default getHDNode
