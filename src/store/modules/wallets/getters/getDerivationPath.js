/**
 * Get Derivation Path
 *
 * Based on (BIP-44) derivation paths.
 * (m / purpose' / coin_type' / account' / change / address_index)
 * source: https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
 *
 * Nito will provide native support for both Bitcoin Cash (BCH) and
 * Ethereum (ETH). Legacy Bitcoin (BTC) will be supported using
 * compatible exchange APIs (eg. Telr.Exchange).
 *
 * NOTE: Consider using the SLP default path; however, this will require
 *       a separate wallet, which MUST be separately funded with BCH;
 *       unless implementing Simple Ledger Postage Protocol.
 *       source: https://github.com/simpleledger/slp-specifications/blob/master/slp-postage-protocol.md
 */
const getDerivationPath = () => (_wallet) => {
    /* Initialize derivation paths. */
    const derivationPaths = {
        BCH: `m/44'/145'/0'/0`, // Bitcoin Cash (BCH)
        ETH: `m/44'/60'/0'/0`, // Ethereum (ETH)
        SLP: `m/44'/245'/0'/0`, // Simple Ledger Protocol (SLP)
    }

    /* Return derivation path. */
    return derivationPaths[_wallet]
}

/* Export module. */
export default getDerivationPath
