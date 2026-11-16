/* Import the shared discovery scan (BIP44-style gap scan). */
import { scanBranch } from '@/lib/bch/discovery.js'

/* Import the Fulcrum (Electrum) data provider. */
import { getCluster } from '@/lib/bch/provider.js'

/**
 * Init Wallet
 *
 * Boot-time wallet initialization. Historical note: this used to be an
 * intentionally-safe NO-OP because its original "advance when address 0
 * has history" logic could over-advance the account pool on EVERY reload
 * (the full BIP44 account discovery it gestured at is handled by
 * restoreWallet since the seed-phrase restore feature landed).
 *
 * What it does NOW — the change-chain BACKFILL: wallets restored BEFORE
 * branch-1 discovery existed (state.c never populated) cannot see their
 * foreign change funds (e.g. PUSD/BCH change left by Cashonize/Paytaca,
 * which keep change on `m/44'/145'/0'/1/N`). On boot, IF a wallet exists
 * and the change chain was never scanned, scan it ONCE (bounded — see
 * discovery.js) and commit the discovered indexes. Idempotent: any
 * non-null state.c skips the scan entirely (re-restores re-scan through
 * restoreWallet instead).
 *
 * The scan is bounded to ONE chain (branch 1) so boot stays fast (~10
 * Fulcrum probes for an unused chain); the RECEIVING chain was already
 * discovered when the wallet was restored/created.
 */
const initWallet = async ({ state, getters, rootGetters, commit }) => {
    /* Backfill ONLY when a wallet exists AND the change chain has never
       been scanned (state.c null). */
    if (!state.a || state.c) {
        console.log('INIT WALLET (no change-chain backfill needed)') // eslint-disable-line no-console

        return
    }

    console.info('INIT WALLET (backfilling branch-1 change chain)...') // eslint-disable-line no-console

    /* Set the account base (`m/44'/145'/0'` = purpose'/coin'/account') —
       NOT slice(0, 3), which would drop the account level and derive a
       completely different wallet (see restoreWallet's comment). */
    const pathBase = getters.getDerivationPath('BCH').split('/').slice(0, 4).join('/')
    const hdNode = getters.getHDNode
    const network = rootGetters['profile/getNetwork']

    /* The scan is best-effort: a failed cluster connection (offline boot)
       leaves state.c null — the next boot retries. Nothing here may crash
       the boot flow. */
    try {
        const cluster = await getCluster(network)
        const lastUsed1 = await scanBranch({ hdNode, pathBase, branch: 1, network, cluster })

        /* Commit indexes 0..(lastUsed1 + 1) — the +1 covers the next
           foreign change index (0..0 for an unused chain). */
        const changeIndexes = []
        for (let i = 0; i <= lastUsed1 + 1; i++) {
            changeIndexes.push(i)
        }
        commit('setChangeIndexes', { BCH: changeIndexes })

        console.info(`INIT WALLET (branch-1 backfill: last used index ${lastUsed1})`) // eslint-disable-line no-console
    } catch (err) {
        console.error('INIT WALLET (change-chain backfill failed — will retry next boot):', err) // eslint-disable-line no-console
    }
}

/* Export module. */
export default initWallet
