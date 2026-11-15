/* Import crypto helpers (mnemonic -> master entropy + HD derivation). */
import { entropyFromMnemonic, derivePath, toCashAddress } from '@/lib/bch/crypto.js'

/* Import the Fulcrum (Electrum) data provider. */
import { getCluster } from '@/lib/bch/provider.js'

/*
 * Account (index) discovery bounds — BIP44-style gap scan over the
 * RECEIVING chain. NOTE: nito uses a SINGLE chain — "change" addresses
 * are the NEXT index on the same chain (see getChangeAddress, which
 * appends index + 1 to the pool) — so scanning branch 0 covers both
 * received funds and (nito-native) change.
 */
const DISCOVERY_BATCH = 10        // indexes probed per batch
const DISCOVERY_MAX_BATCHES = 20  // hard bound: at most 200 indexes probed

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
 *   3. DISCOVER used receiving indexes (see below).
 *   4. Commit the discovered accounts model. Address derivation, balances
 *      and history re-derive reactively from the restored seed (the
 *      getAddresses / getHDNode getters read the master seed directly),
 *      and Receive's openConn subscribes the fresh pool when it mounts.
 *
 * Discovery (why balances were 0 after restore — observed live):
 *   getBalance / getTokenBalance scan ONLY the addresses in the accounts
 *   model, and a fresh model covers index 0 ONLY. A wallet with history
 *   holds funds at WHATEVER indexes it used — so a restored wallet showed
 *   no BCH / no PUSD. The scan below probes the receiving chain in
 *   batches (via `blockchain.address.get_history`) and activates every
 *   index up to the last USED one (+1 = the next fresh receive address),
 *   stopping at the first fully-empty batch (the gap limit).
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

    /* ----- Discover used receiving indexes ----- */
    const network = rootGetters['profile/getNetwork']
    const hdNode = getters.getHDNode
    const pathBase = getters.getDerivationPath('BCH')
    const cluster = await getCluster(network)

    /* Highest index with ANY history (send or receive); -1 = none used. */
    let lastUsed = -1

    for (let batch = 0; batch < DISCOVERY_MAX_BATCHES; batch++) {
        /* Probe one batch of indexes (in parallel). */
        const start = batch * DISCOVERY_BATCH

        const probes = []
        for (let i = start; i < start + DISCOVERY_BATCH; i++) {
            const address = toCashAddress(derivePath(hdNode, `${pathBase}/${i}`), network)

            /* A FAILED probe is treated as "unused" (same as an empty
               history): a single flaky response must not abort the scan. */
            probes.push(cluster.getHistory(address).catch(() => []))
        }
        const histories = await Promise.all(probes)

        /* Track the highest used index within this batch. */
        histories.forEach((history, offset) => {
            if (Array.isArray(history) && history.length > 0) {
                lastUsed = start + offset
            }
        })

        /* Gap limit: an ENTIRE batch without any usage ends the scan. */
        if (histories.every((history) => !Array.isArray(history) || history.length === 0)) {
            break
        }
    }

    /* ----- Build the discovered accounts model -----
       BCH: indexes 0..(lastUsed + 1) — the +1 keeps ONE fresh (unused)
            receive address at the end of the pool, as a used wallet would
            have. ETH/SLP keep the createWallet defaults (index 0). */
    const accountsModel = {
        BCH: {},
        ETH: { 0: { s: 'a' } },
        SLP: { 0: { s: 'a', u: {} } },
    }
    for (let i = 0; i <= lastUsed + 1; i++) {
        accountsModel.BCH[i] = { s: 'a', u: {} }
    }

    /* Reset the (wallet) imported seeds + base accounts model. */
    dispatch('createWallet')

    /* Commit the DISCOVERED accounts (a superset of createWallet's
       index-0-only model). */
    commit('setAccounts', accountsModel)

    /* Return the restored (master) entropy. */
    return entropy
}

/* Export module. */
export default restoreWallet
