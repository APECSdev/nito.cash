/*
 * BIP44-style account (index) discovery.
 *
 * Shared by:
 *   - wallets/restoreWallet (full scan of BOTH chains at seed-phrase restore)
 *   - wallets/initWallet (boot-time BACKFILL of the change chain for wallets
 *     restored before branch-1 discovery existed)
 *
 * The scan probes `blockchain.address.get_history` for consecutive indexes
 * of one derivation branch in batches and stops at the first FULLY-empty
 * batch (the gap limit). A FAILED probe is treated as "unused" (same as an
 * empty history) so a single flaky response cannot abort the scan.
 */

/* Import crypto helpers (HD derivation + CashAddress). */
import { derivePath, toCashAddress } from './crypto.js'

/* Bounds: 10 indexes per batch, hard bound 20 batches (200 indexes/chain). */
export const DISCOVERY_BATCH = 10
export const DISCOVERY_MAX_BATCHES = 20

/**
 * Gap-scan ONE derivation branch.
 *
 * @param {Object}   _opts
 * @param {Object}   _opts.hdNode    - BIP32 master node (from the wallet seed).
 * @param {String}   _opts.pathBase  - ACCOUNT base, e.g. `m/44'/145'/0'`
 *                                     (purpose'/coin'/account' — NOT the
 *                                     branch-0 path: the branch is appended).
 * @param {Number}   _opts.branch    - 0 (receiving) or 1 (BIP44 change).
 * @param {String}   _opts.network   - active network id (CashAddress prefix).
 * @param {Object}   _opts.cluster   - Fulcrum cluster (getHistory used).
 * @returns {Number} the highest index with ANY history (send or receive);
 *                   -1 = the chain is unused.
 */
export async function scanBranch(_opts) {
    const { hdNode, pathBase, branch, network, cluster } = _opts

    let lastUsed = -1

    for (let batch = 0; batch < DISCOVERY_MAX_BATCHES; batch++) {
        /* Probe one batch of indexes (in parallel). */
        const start = batch * DISCOVERY_BATCH

        const probes = []
        for (let i = start; i < start + DISCOVERY_BATCH; i++) {
            const address = toCashAddress(
                derivePath(hdNode, `${pathBase}/${branch}/${i}`),
                network)

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

    return lastUsed
}
