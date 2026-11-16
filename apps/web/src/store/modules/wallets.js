/* Import modules (getters). */
import getAccounts from './wallets/getters/getAccounts'
import getAccountsByWallet from './wallets/getters/getAccountsByWallet'
import getChangeIndexes from './wallets/getters/getChangeIndexes'
import getAddress from './wallets/getters/getAddress'
import getAddresses from './wallets/getters/getAddresses'
import getBalance from './wallets/getters/getBalance'
import getChangeAddress from './wallets/getters/getChangeAddress'
import getDerivationPath from './wallets/getters/getDerivationPath'
import getDustAmount from './wallets/getters/getDustAmount'
import getHDNode from './wallets/getters/getHDNode'
import getHistory from './wallets/getters/getHistory'
import getSignedInput from './wallets/getters/getSignedInput'
import getTokenBalance from './wallets/getters/getTokenBalance'

/* Import modules (actions). */
import activateAccounts from './wallets/actions/activateAccounts'
import activateInputs from './wallets/actions/activateInputs'
import addImportedSeed from './wallets/actions/addImportedSeed'
import createWallet from './wallets/actions/createWallet'
import destroyWallet from './wallets/actions/destroyWallet'
import initWallet from './wallets/actions/initWallet'
import nextAccount from './wallets/actions/nextAccount'
import restoreWallet from './wallets/actions/restoreWallet'
import sendCrypto from './wallets/actions/sendCrypto'
import updateAccounts from './wallets/actions/updateAccounts'
import updateInputs from './wallets/actions/updateInputs'

/* Import modules (mutations). */
import setAccounts from './wallets/mutations/setAccounts'
import setChangeIndexes from './wallets/mutations/setChangeIndexes'
import setEmptyWallet from './wallets/mutations/setEmptyWallet'
import setImportedSeeds from './wallets/mutations/setImportedSeeds'
import setMetadata from './wallets/mutations/setMetadata'

/* Initialize state. */
const state = {
    /**
     * Active Accounts
     *
     * List of the starting and ending indexes of ALL accounts:
     *     1. Active (a)
     *     2. Disabled (d)
     *     3. Locked (l)
     */
    a: null,

    /**
     * Change (Chain) Indexes
     *
     * DISCOVERED branch-1 (BIP44 change chain) indexes per wallet —
     * msgpack-encoded `{ BCH: [indexes] }`. Foreign (BIP44-standard)
     * wallets keep their change on branch 1 while nito's own change is
     * the next branch-0 index (see getChangeAddress); restored wallets
     * need the change chain scanned to see foreign change funds.
     * Populated by restoreWallet's discovery scan.
     */
    c: null,

    /**
     * Imported Seeds
     *
     * Seeds may be imported from UUIDs embedded in the url, as a querystring
     * (eg. https://nito.cash?<uuid>).
     */
    is: null,

    /**
     * Metadata
     *
     * Used to store (user-defined) data for:
     *     1. Individual accounts
     *     2. Individual unspent transaction outputs (UXTOs)
     *
     * TODO: Allow this data to be stored on-chain using:
     *       1. Bitcoin Files (https://bitcoinfiles.com/)
     *       2. Telr Locker (https://locker.telr.io)
     */
    m: null,
}

/* Getters. */
const getters = {
    getAccounts,
    getAccountsByWallet,
    getChangeIndexes,
    getAddress,
    getAddresses,
    getBalance,
    getChangeAddress,
    getDerivationPath,
    getDustAmount,
    getHDNode,
    getHistory,
    getSignedInput,
    getTokenBalance,
}

/* Actions. */
const actions = {
    activateAccounts,
    activateInputs,
    addImportedSeed,
    createWallet,
    destroyWallet,
    initWallet,
    nextAccount,
    restoreWallet,
    sendCrypto,
    updateAccounts,
    updateInputs,
}

/* Mutations. */
const mutations = {
    setAccounts,
    setChangeIndexes,
    setEmptyWallet,
    setImportedSeeds,
    setMetadata,
}

/* Export. */
export default {
    namespaced: true,
    state,
    getters,
    actions,
    mutations
}
