/* Import crypto helpers (local key/address cryptography). */
import { derivePath, toCashAddress } from '@/lib/bch/crypto.js'

/* Import the Fulcrum (Electrum) data provider. */
import { getCluster } from '@/lib/bch/provider.js'

/**
 * Get (CashToken) Balance
 *
 * Retrieves the wallet's total balance for ONE CashToken category (e.g. PUSD),
 * by summing the fungible `token_data.amount` across every receiving address
 * of the (HD) wallet. Uses the Electrum 1.5 `include_tokens` UTXO filter —
 * token-bearing UTXOs are otherwise hidden from Fulcrum responses.
 *
 * NOTE: Returns a BigInt of RAW base units. CashToken decimals are defined
 *       off-chain (BCMR metadata), not on-chain, and are not yet wired.
 */
const getTokenBalance = (state, getters, rootState, rootGetters) => async (_wallet, _category) => {
    /* Validate (wallet) accounts. */
    if (!getters.getAccountsByWallet(_wallet)) {
        return 0n
    }

    /* Set (active) network. */
    const network = rootGetters['profile/getNetwork']

    /* Initialize account addresses. */
    const addresses = []

    /* Add all active receiving account (addresses) to pool. */
    Object.keys(getters.getAccountsByWallet(_wallet)).forEach(index => {
        /* Initialize HD node. */
        const hdNode = getters.getHDNode

        /* Set derivation path. */
        const path = `${getters.getDerivationPath(_wallet)}/${index}`

        /* Initialize child node. */
        const childNode = derivePath(hdNode, path)

        /* Add (receiving) address to pool. */
        addresses.push(toCashAddress(childNode, network))
    })

    try {
        /* Retrieve (ALL) account(s) token-bearing UTXOs (quorum-verified). */
        const cluster = await getCluster(network)
        const utxoLists = await Promise.all(
            addresses.map((address) => cluster.getUtxosWithTokens(address)))

        /* Sum the fungible token amount for the requested category. */
        let balance = 0n
        utxoLists.forEach((utxos) => {
            utxos.forEach((utxo) => {
                const tokenData = utxo.token_data
                if (tokenData && tokenData.category === _category && tokenData.amount) {
                    balance += BigInt(tokenData.amount)
                }
            })
        })

        /* Return (raw) token balance. */
        return balance
    } catch (err) {
        console.error(err) // eslint-disable-line no-console

        /* Return (empty) balance. */
        return 0n
    }
}

/* Export module. */
export default getTokenBalance
