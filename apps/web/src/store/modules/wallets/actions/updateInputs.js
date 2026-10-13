/* Import crypto helpers (local key/address cryptography). */
import { derivePath, toCashAddress } from '@/lib/bch/crypto.js'

/**
 * Update Inputs
 */
const updateInputs = ({ commit, getters, rootGetters }, _params) => {
    console.info('Updating inputs...', _params)

    /* Set wallet. */
    const wallet = _params.wallet
    console.log('WALLET', wallet)

    /* Set (input) action. */
    const inputAction = _params.action
    console.log('INPUT ACTION', inputAction)

    /* Set (input) address. */
    const inputAddress = _params.address
    console.log('INPUT ADDRESS', inputAddress)

    /* Retreive accounts. */
    const accounts = getters.getAccounts
    console.log('ALL ACCOUNTS', accounts)

    /* Retrieve wallet accounts. */
    const walletAccounts = getters.getAccountsByWallet(wallet)
    console.log('WALLET ACCOUNTS', walletAccounts)

    /* Filter "active" accounts. */
    Object.keys(walletAccounts).forEach(index => {
        if (walletAccounts[index].s === 'a') {
            /* Set (derivation) path. */
            const path = `${getters.getDerivationPath('BCH')}/${index}`
            console.log('ACTIVE ACCOUNT (path)', path)

            /* Initialize HD node. */
            const hdNode = getters.getHDNode

            /* Initialize child node (scure/bip32 `.derive`). */
            const childNode = derivePath(hdNode, path)

            /* Set (active) address (prefixed for the ACTIVE network). */
            const activeAddress = toCashAddress(childNode, rootGetters['profile/getNetwork'])
            console.log('ACTIVE ACCOUNT (address)', activeAddress)

            /* Validate (matching) input address. */
            if (inputAddress === activeAddress) {
                /* Handle input update. */
                switch(inputAction) {
                case 'add':
                    // FIXME: Support handling of multiple UTXOs per account.
                    walletAccounts[index].u[0] = {
                        s: 'a',
                    }
                    break
                }
            }

        }
    })

    /* Update accounts. */
    accounts[wallet] = walletAccounts

    /* Commit updated accounts. */
    commit('setAccounts', accounts)
}

/* Export module. */
export default updateInputs
