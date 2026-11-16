/* Import crypto helpers (mnemonic -> master entropy). */
import { entropyFromMnemonic } from '@/lib/bch/crypto.js'

/* Import the shared discovery scan (BIP44-style gap scan). */
import { scanBranch } from '@/lib/bch/discovery.js'

/* Import the Fulcrum (Electrum) data provider. */
import { getCluster } from '@/lib/bch/provider.js'

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
 *   3. DISCOVER used indexes on BOTH chains (receiving branch 0 + the
 *      BIP44-standard change branch 1 — see discovery.js).
 *   4. Commit the discovered accounts model + change indexes. Address
 *      derivation, balances and history re-derive reactively from the
 *      restored seed (the getAddresses / getHDNode getters read the
 *      master seed directly), and Receive's openConn subscribes the
 *      fresh pool when it mounts.
 *
 * Discovery (why balances were 0 after restore — observed live):
 *   getBalance / getTokenBalance scan ONLY the addresses in the accounts
 *   model, and a fresh model covers index 0 ONLY. A wallet with history
 *   holds funds at WHATEVER indexes it used — so a restored wallet showed
 *   no BCH / no PUSD. The scan below probes the receiving chain (branch 0)
 *   AND the BIP44 change chain (branch 1 — where FOREIGN wallets like
 *   Cashonize/Paytaca keep their change; nito's own change is the next
 *   branch-0 index) and activates every index up to the last USED one
 *   (+1), stopping at the first fully-empty batch.
 *
 * NOTE: this REPLACES the wallet currently in the app (same semantic as
 *       "Burn your wallet" + a new wallet, but with a known seed). Also
 *       note the SHIELDED pool notes are NOT restorable from the seed
 *       alone: they are device-local (encrypted with a key derived from
 *       the seed, but the ciphertext lives in THIS browser's storage).
 */
const restoreWallet = async ({ getters, rootGetters, commit, dispatch }, _mnemonic) => {
    /* Restore the master entropy from the phrase (throws on invalid). */
    const entropy = entropyFromMnemonic(_mnemonic)

    /* Set the restored master seed (profile). The getters below re-evaluate
       against the NEW seed (the facade getters close over live state). */
    await dispatch('profile/updateMasterSeed', entropy, { root: true })

    /* ----- Discover used indexes (BOTH chains) ----- */
    const network = rootGetters['profile/getNetwork']
    const hdNode = getters.getHDNode
    const pathBase = getters.getDerivationPath('BCH').split('/').slice(0, 4).join('/')
    const cluster = await getCluster(network)

    /* NOTE: slice(0, 4) keeps `m/44'/145'/0'` (purpose'/coin'/account') —
       NOT slice(0, 3), which would DROP the account level and derive a
       completely different wallet (caught live: every balance rendered 0
       because the pool derived to wrong addresses). */

    const lastUsed0 = await scanBranch({ hdNode, pathBase, branch: 0, network, cluster })
    const lastUsed1 = await scanBranch({ hdNode, pathBase, branch: 1, network, cluster })

    /* ----- Build the discovered accounts model -----
       BCH: branch-0 indexes 0..(lastUsed0 + 1) — the +1 keeps ONE fresh
            (unused) receive address at the end of the pool, as a used
            wallet would have. ETH/SLP keep the createWallet defaults. */
    const accountsModel = {
        BCH: {},
        ETH: { 0: { s: 'a' } },
        SLP: { 0: { s: 'a', u: {} } },
    }
    for (let i = 0; i <= lastUsed0 + 1; i++) {
        accountsModel.BCH[i] = { s: 'a', u: {} }
    }

    /* Reset the (wallet) imported seeds + base accounts model. */
    dispatch('createWallet')

    /* Commit the DISCOVERED accounts (a superset of createWallet's
       index-0-only model). */
    commit('setAccounts', accountsModel)

    /* Commit the DISCOVERED branch-1 (change chain) indexes: 0..(lastUsed1 + 1)
       — the +1 covers the next foreign change index. (nito's own change
       allocation stays on branch 0 — see getChangeAddress.) */
    const changeIndexes = []
    for (let i = 0; i <= lastUsed1 + 1; i++) {
        changeIndexes.push(i)
    }
    commit('setChangeIndexes', { BCH: changeIndexes })

    /* Return the restored (master) entropy. */
    return entropy
}

/* Export module. */
export default restoreWallet
