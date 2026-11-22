// src/lib/pool/scan.js
//
// The shielded-pool NOTE-DETECTION scan (wallet side) — blocker #2 of the
// private-payments wiring (see pusd-shielded-pool NOTE-CARRIER.md §5).
//
// The wallet needs NO dedicated indexer for the PoC: every pool action is
// PUBLIC chain data reachable through the existing Fulcrum cluster —
//   1. the pool covenant ADDRESS's history IS the action chain (every action
//      pays output[0] back to the covenant, `blockchain.address.get_history`),
//   2. each history tx decodes into its covenant arguments (decode.js), and
//   3. the action's outputs carry the encrypted-note CARRIER packets
//      (carrier.js) which trial-decrypt into received notes.
//
// VALIDATION (all three, per action — the same bindings the covenant itself
// enforces on-chain, re-verified locally by the scan):
//   a. actionHash   — recomputed from the decoded args (notes.js Option-F
//      SHA256) must equal the PROVEN n1 read from the verifier witness.
//   b. root chain  — the action's PROVEN n0 (old root) must equal the
//      previous action's args.newMerkleRoot; the FIRST action's n0 must equal
//      the pool's genesis root (registry). This gives full tree CONTINUITY
//      WITHOUT the genesis seed leaves (which are not public — see
//      registry.js).
//   c. tx chain     — actions are ordered by the covenant input's outpoint
//      (each action spends the previous action's pool output), which orders
//      same-block chained transfers correctly where height alone cannot.
//
// RECEIVED-NOTE VALIDATION does not need the full tree either: a received
// note is always in the APPENDED portion, and its commitment is ON-CHAIN in the
// delivering action's args (cm0/cm1) — so decryption validates against those
// two leaves, and the global leaf index is derived from the genesis leaf
// count + the running append offset.

import { actionHash, nullifier } from './notes'
import { decryptPacket } from './carrier'
import { decodePoolAction } from './decode'
import { poolAddress } from './registry'

/**
 * Scan one pool's full action chain from the network.
 *
 * @param {object} params
 *   cluster   — a connected FulcrumCluster (apps/web/src/lib/bch/provider.js).
 *   pool      — a registry entry (lib/pool/registry.js).
 *   networkId — 'mainnet' | 'chipnet' (for the covenant address prefix).
 * @returns {Promise<object>} {
 *   address,               — the covenant address that was scanned
 *   actions,               — ordered action list, each:
 *       { txid, height, covenantInputIndex, prevoutTxid, args, carriers,
 *         proven, leafIndexBase }  (leafIndexBase = the global index of
 *         this action's cm0; cm1 sits at leafIndexBase + 1)
 *   creationTxids,         — history txs that CREATE pool state (DEPLOY /
 *                            GENESIS; they carry no covenant input)
 *   tipHeight, tipTxid,    — the most recent action (or the creation tip)
 * }
 * @throws on a broken chain (gap in history, actionHash/root mismatch, or an
 *   outpoint that does not close) — a silently wrong scan is worse than none.
 */
export async function scanPoolActions({ cluster, pool, networkId }) {
    /* The covenant address's history IS the action chain. */
    const address = poolAddress(pool, networkId)

    const history = await cluster.getHistory(address)

    /* Confirmed only (height > 0) — unconfirmed mempool actions are skipped
       (the PoC scans settled state; note counts are chipnet-scale). */
    const confirmed = (history || [])
        .filter((entry) => entry.height > 0)
        .sort((a, b) => a.height - b.height)

    /* Decode every history tx (raw hex -> covenant args / carriers). */
    const actions = []
    const creationTxids = []

    for (const entry of confirmed) {
        const rawTx = await cluster.getTransaction(entry.tx_hash)

        const decoded = decodePoolAction(rawTx)

        if (decoded) {
            actions.push({ txid: entry.tx_hash, height: entry.height, ...decoded })
        } else {
            creationTxids.push(entry.tx_hash)
        }
    }

    /* ── order by the covenant-input outpoint chain ──────────────────────
       Each action's pool input spends the PREVIOUS action's pool output:
       next.prevoutTxid === current.txid. The chain starts at the action whose
       prevout is NOT another action (it spends a creation tx — DEPLOY). */
    const byTxid = new Map(actions.map((a) => [a.txid, a]))
    const byPrevout = new Map(actions.map((a) => [a.prevoutTxid, a]))

    const head = actions.filter((a) => !byTxid.has(a.prevoutTxid))

    /* An empty history is a valid (fresh/unused) pool — no actions, no head. */
    if (actions.length > 0 && head.length !== 1) {
        throw new Error(`pool scan: expected exactly one chain head, found ${head.length}`)
    }

    const ordered = []

    let current = head[0]

    while (current) {
        ordered.push(current)

        current = byPrevout.get(current.txid) || null
    }

    /* Every action must be on the chain (an orphan = a history gap). */
    if (ordered.length !== actions.length) {
        throw new Error(`pool scan: broken action chain (${ordered.length}/${actions.length} chained)`)
    }

    /* Heights must be non-decreasing along the chain. */
    for (let i = 1; i < ordered.length; i += 1) {
        if (ordered[i].height < ordered[i - 1].height) {
            throw new Error(`pool scan: action ${ordered[i].txid} precedes its prevout`)
        }
    }

    /* ── per-action validation + leaf-index bookkeeping ─────────────────── */
    const assetCategory = BigInt('0x' + pool.assetCategory)

    /* Genesis root: registry stores the 32-byte LE VM-number form. */
    const genesisRootBig = pool.genesisRootLE
        ? leHexToBig(pool.genesisRootLE)
        : null

    let prevRoot = genesisRootBig
    let leafCount = pool.genesisLeafCount || 0

    for (const action of ordered) {
        const { args, proven } = action

        /* a. The recomputed actionHash MUST equal the proven n1 — the exact
              soundness binding the covenant enforced on-chain. */
        const recomputed = actionHash({
            nf0: args.nf0,
            nf1: args.nf1,
            cm0: args.cm0,
            cm1: args.cm1,
            publicValueAbs: args.publicValueAbs,
            publicValueSign: args.isUnshield,
            assetCategory,
            newMerkleRoot: args.newMerkleRoot,
        })

        if (recomputed !== proven.actionHash) {
            throw new Error(`pool scan: actionHash mismatch at ${action.txid}`)
        }

        /* b. Root continuity: the proof's n0 (the anchored OLD root) must be
              the previous action's newMerkleRoot (or the genesis root). */
        if (prevRoot !== null && proven.merkleRoot !== prevRoot) {
            throw new Error(`pool scan: root-continuity break at ${action.txid}`)
        }

        /* The global leaf indices of this action's two appended notes. */
        action.leafIndexBase = leafCount

        leafCount += 2

        prevRoot = args.newMerkleRoot
    }

    const tip = ordered.length > 0
        ? ordered[ordered.length - 1]
        : { txid: creationTxids[creationTxids.length - 1] || null, height: confirmed.length ? confirmed[confirmed.length - 1].height : 0 }

    return {
        address,
        actions: ordered,
        creationTxids,
        tipHeight: tip.height,
        tipTxid: tip.txid,
    }
}

/*
 * Detect notes received by a spend key across a scanned action list.
 *
 * Trial-decrypts every action's carrier packets (Zcash-style): a packet that
 * decrypts under this key to a commitment equal to the action's own cm0/cm1
 * is a note PAID TO THIS WALLET. The PoC key model (notes.js deriveSpendKey:
 * one key = owner key = nullifier key nk) supplies `nk` + the derived
 * `nf` so the store's note shape is complete.
 *
 * @returns {Promise<Array>} received notes:
 *   { value, ownerPub, rho, r, cm, nf, nk, leafIndex, txid, height }
 */
export async function detectReceived({ actions, spendKey, genesisLeafCount = 0 }) {
    const received = []

    for (const action of actions) {
        for (const packet of action.carriers) {
            /* Membership is validated against THIS action's two on-chain
               commitments — a wrong key / tampered packet yields a cm that
               matches neither and is silently rejected. */
            const note = await decryptPacket(packet, spendKey, [
                action.args.cm0,
                action.args.cm1,
            ])

            if (!note) {
                continue
            }

            /* Local index (0 = cm0, 1 = cm1) -> global leaf position. */
            const leafIndex = (action.leafIndexBase ?? 0) + (note.leafIndex === 1 ? 1 : 0)

            received.push({
                value: note.value,
                ownerPub: note.ownerPub,
                rho: note.rho,
                r: note.r,
                cm: note.cm,
                nf: await nullifier(spendKey, note.rho),
                nk: BigInt(spendKey),
                leafIndex,
                txid: action.txid,
                height: action.height,
            })
        }
    }

    return received
}

/*
 * Detect which of the wallet's notes were SPENT by the scanned actions: any
 * action revealing a nullifier equal to one of the wallet's unspent notes'
 * nullifiers marks that note spent (the on-chain nullifier set the covenant
 * commits to, mirrored wallet-side).
 *
 * @param {Array} notes — the wallet's notes (each with nk + rho; the store's
 *   note shape).
 * @returns {Promise<Array<string>} the nullifiers that were spent on-chain.
 */
export async function detectSpent({ actions, notes }) {
    const spent = []

    for (const note of notes) {
        if (note.spent || note.nk === undefined || note.rho === undefined) {
            continue
        }

        const nf = (await nullifier(note.nk, note.rho)).toString(10)

        const spentOnChain = actions.some((action) =>
            action.args.nf0.toString(10) === nf ||
            action.args.nf1.toString(10) === nf)

        if (spentOnChain) {
            spent.push(nf)
        }
    }

    return spent
}

/*
 * The convenience orchestrator used by the store: full scan + detection.
 *
 * @param {object} params — { cluster, pool, networkId, spendKey, notes }
 * @returns {Promise<object>} { address, actions, creationTxids, tipHeight,
 *   tipTxid, received, spent }
 */
export async function scanPool({ cluster, pool, networkId, spendKey, notes = [] }) {
    const scan = await scanPoolActions({ cluster, pool, networkId })

    const received = await detectReceived({
        actions: scan.actions,
        spendKey,
        genesisLeafCount: pool.genesisLeafCount,
    })

    const spent = await detectSpent({ actions: scan.actions, notes })

    return { ...scan, received, spent }
}

/* 32-byte LE VM-number hex -> BigInt (registry genesis roots are stored in
   the on-chain LE byte form). */
function leHexToBig(hex) {
    const bytes = new Uint8Array(32)

    for (let i = 0; i < 32; i += 1) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
    }

    let n = 0n

    for (let i = 31; i >= 0; i -= 1) {
        n = (n << 8n) | BigInt(bytes[i])
    }

    return n
}
