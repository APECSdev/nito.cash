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

import { actionHash, actionHash3out, nullifier } from './notes.js'
import { computeRoot } from './merkle.js'
import { decryptPacket } from './carrier.js'
import { decodePoolAction, decodeRole2Action } from './decode.js'
import { poolAddress, poolScripthash } from './registry.js'
import { binToHex } from '@bitauth/libauth'
import { nullifierWalkData, EMPTY_NULL_SET_ROOT } from './smt.js'

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
    /* The covenant address's history IS the action chain — queried by
       SCRIPHASH: Fulcrum rejects the hashType-bit CashAddress form with
       "Invalid address" (registry.js poolScripthash). */
    const address = poolAddress(pool, networkId)

    const history = await cluster.getScripthashHistory(poolScripthash(pool))

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

        /* Role-2 first (the 642-B STMT / the 169-B carrier); the old 5-input
           decoder is the fallback for the retired pools. */
        const decoded = decodeRole2Action(rawTx) || decodePoolAction(rawTx)

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
    /* The actionHash's category witness: the HELD asset on v4h (the C
       architecture — the circuit + the hook's check 6 bind the ASSET; the
       Nito-review fix), the pool category on the legacy pools (where the pool
       category IS the asset). */
    const assetCategory = BigInt('0x' + (pool.heldCategory ?? pool.assetCategory))

    /* Genesis root: registry stores the 32-byte LE VM-number form. */
    const genesisRootBig = pool.genesisRootLE
        ? leHexToBig(pool.genesisRootLE)
        : null

    let prevRoot = genesisRootBig
    let leafCount = pool.genesisLeafCount || 0

    /* (v3) THE NULLIFIER-SET SMT reconstruction (the scan-contract §6 steps
       4–6): the spent keys insert in action order; each action's walk must
       anchor at the PREVIOUS commitment's second half and land on the NEW
       commitment's second half (out1's 64-B NFT commitment, decoded from the
       chain). The R2 replay dies HERE too — nullifierWalkData throws on a
       key already in the set (the client-side mirror of walkA's 0-walk). */
    const isV3 = pool.variant === 'v3' || pool.txInputCount === 5
    /* v4h (the C architecture): the 7-input shape — the 96-B commitment
       [noteRoot ‖ nullSetRoot ‖ balance32]; the balance is the commitment's
       THIRD field (the authenticated chain — the state NFT is FT-less; the
       real balance rides the H-covenant holdings line at out2). */
    const isV4H = pool.variant === 'v4h' || pool.txInputCount === 7
    const EMPTY_NULL_HEX = binToHex(EMPTY_NULL_SET_ROOT)
    let spentKeys = []
    let prevNullRoot = EMPTY_NULL_HEX
    let v3Balance = 0n

    if (isV3 && pool.genesisStateCommitment) {
        /* the genesis 64-B commitment = LE32(zh[20]) ‖ EMPTY_NULL_SET_ROOT —
           the SMT anchor chain starts at the empty set. */
        if (pool.genesisStateCommitment.slice(64) !== EMPTY_NULL_HEX) {
            throw new Error('pool scan: the v3 genesis commitment is not rootLE ‖ EMPTY_NULL_ROOT')
        }
    }

    if (isV4H && pool.genesisStateCommitment) {
        /* the genesis 96-B commitment = LE32(zh[20]) ‖ EMPTY_NULL_SET_ROOT ‖
           LE32(0) — the balance chain starts at 0 with the empty set. */
        if (pool.genesisStateCommitment.slice(64, 128) !== EMPTY_NULL_HEX) {
            throw new Error('pool scan: the v4h genesis commitment is not rootLE ‖ EMPTY_NULL_ROOT ‖ balance')
        }
    }

    /* The reconstructible leaf list (the R3 stopgap, 2026-11-27): the
       registry genesis leaves at their slots — the SAME layout
       assembleLeaves builds its witness tree from. Unpublished seed leaves
       leave HOLES, which DISABLE the append check for the rest of the scan
       (the runner-gated legacy pools scan for note detection only — their
       behavior is unchanged); a fully reconstructible tree (every role-2
       pool, and every v3 pool — genesis EMPTY, no seeds at all) keeps the
       check armed for every action. */
    const genesisLeaves = pool.genesisLeaves || []
    const leaves = new Array(Math.max(pool.genesisLeafCount || 0, genesisLeaves.length)).fill(undefined)

    genesisLeaves.forEach((leaf, i) => {
        leaves[i] = BigInt(leaf)
    })

    for (const action of ordered) {
        const { args, proven } = action
        const outs = action.carrierBytes === 201 || pool.outputs === 3 ? 3 : 2

        /* a. The recomputed actionHash MUST equal the proven n1 — the exact
              soundness binding the covenant enforced on-chain. */
        const recomputed = outs === 3
            ? actionHash3out({
                nf0: args.nf0,
                nf1: args.nf1,
                cm0: args.cm0,
                cm1: args.cm1,
                cm2: args.cm2,
                publicValueAbs: args.publicValueAbs,
                publicValueSign: args.isUnshield,
                assetCategory,
                newMerkleRoot: args.newMerkleRoot,
            })
            : actionHash({
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

        /* b2. APPEND RECOMPUTE — the R3-FREE-NEWROOT stopgap (2026-11-27).
              newMerkleRoot is a FREE WITNESS in every current circuit
              (bound into the actionHash, never verified against the
              append), so a TRANSFER whose newRoot anchors a FAKE tree —
              the real leaves + its own commitments + fabricated notes —
              passes BOTH checks above; the fabricated notes are then
              spendable against the planted root (the measured full-balance
              drain, hushyourmoney/docs/POOL-UPDATE-NITO-2026-11-27.md §1;
              our scan's root check was continuity-only). This recomputes
              the append the HONEST builder performs — computeRoot(leaves ‖
              this action's own cms), the exact witness formula in prover.js
              buildPoolWitness* — and HALTS the scan on a planted root.
              DETECTION, not prevention: consensus still accepts the plant;
              only the v3 in-circuit append proof prevents it. */
        if (!leaves.some((leaf) => leaf === undefined)) {
            const appendedRoot = await computeRoot([
                ...leaves,
                ...(outs === 3 ? [args.cm0, args.cm1, args.cm2] : [args.cm0, args.cm1]),
            ])

            if (appendedRoot !== args.newMerkleRoot) {
                throw new Error(`pool scan: APPEND mismatch at ${action.txid} — the carrier newMerkleRoot is not the append of this action's own commitments (a planted root: R3-FREE-NEWROOT); the on-chain state is corrupt`)
            }
        }

        /* b3. (v3) THE SMT RECONSTRUCTION — steps 4–6: insert kA = LE(nf0)
              then kB = LE(nf1) (walkA's midRoot is the intermediate); the
              walked finalNullRoot MUST equal the NEW state commitment's
              second half (out1's 64-B NFT commitment, on-chain); the walk's
              BEFORE anchor MUST equal the previous commitment's second
              half; the commitment's FIRST half must equal the carrier's
              newMerkleRoot (the hook's check-10 mirror). A key already in
              the set THROWS (the replay guard). */
        if (isV3 || isV4H) {
            const commitHexLen = isV4H ? 192 : 128
            if (!action.stateCommitment || action.stateCommitment.length !== commitHexLen) {
                throw new Error(`pool scan: the ${isV4H ? 'v4h action carries no 96-B' : 'v3 action carries no 64-B'} state commitment (${action.txid})`)
            }

            const kA = bigToLeHex(args.nf0)
            const kB = bigToLeHex(args.nf1)
            const walk = nullifierWalkData({ spentKeys, kA, kB })

            if (walk.nullSetRootBefore !== prevNullRoot) {
                throw new Error(`pool scan: nullSetRoot continuity break at ${action.txid}`)
            }

            /* the nullSetRoot half: [64..128) hex in BOTH forms (the v4h
               commitment's third field — the balance — sits at [128..192)). */
            const onChainNullRoot = isV4H ? action.stateCommitment.slice(64, 128) : action.stateCommitment.slice(64)

            if (walk.finalNullRoot !== onChainNullRoot) {
                throw new Error(`pool scan: SMT mismatch at ${action.txid} — the walked finalNullRoot is not the new state commitment's second half`)
            }

            const onChainNoteRoot = leHexToBig(action.stateCommitment.slice(0, 64))

            if (onChainNoteRoot !== args.newMerkleRoot) {
                throw new Error(`pool scan: the new state commitment's note-root half != the carrier newMerkleRoot at ${action.txid}`)
            }

            /* Step 6 — the balance chain: the v3 reads out1's FT; the v4h
               reads the commitment's THIRD field (the authenticated chain)
               and cross-checks the H-covenant holdings line at out2. */
            const expectedBalance = v3Balance + args.publicValueAbs - 2n * args.isUnshield * args.publicValueAbs

            if (action.newBalance !== expectedBalance) {
                throw new Error(`pool scan: balance mismatch at ${action.txid} — the commitment carries ${action.newBalance}, the arithmetic expects ${expectedBalance}`)
            }

            if (isV4H && action.holdingsAmount !== null && action.holdingsAmount !== action.newBalance) {
                throw new Error(`pool scan: the holdings line at out2 (${action.holdingsAmount}) != the committed balance (${action.newBalance}) at ${action.txid}`)
            }

            spentKeys = [...spentKeys, kA, kB]
            prevNullRoot = walk.finalNullRoot
            v3Balance = action.newBalance
        }

        /* The global leaf indices of this action's appended notes (2 or 3). */
        action.leafIndexBase = leafCount

        /* The reconstructible leaf list grows with this action's own
              commitments (mirrors assembleLeaves' layout exactly). */
        leaves[leafCount] = args.cm0
        leaves[leafCount + 1] = args.cm1

        if (outs === 3) {
            leaves[leafCount + 2] = args.cm2
        }

        leafCount += outs

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
        /* (v3) the reconstructed NULLIFIER-SET state — the walk-data inputs
           for the NEXT action's witness (nullifierWalkData anchors here) +
           the current nullSetRoot (the live state commitment's second half). */
        spentKeys,
        nullSetRoot: prevNullRoot,
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
                ...(action.args.cm2 !== undefined ? [action.args.cm2] : []),
            ])

            if (!note) {
                continue
            }

            /* Local index (0 = cm0, 1 = cm1) -> global leaf position. */
            const leafIndex = (action.leafIndexBase ?? 0) + (note.leafIndex === 2 ? 2 : note.leafIndex === 1 ? 1 : 0)

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
/* The inverse of leHexToBig: a BigInt → its 32-B LE hex form (the carrier's
   byte layout — the SMT keys are the LE slices). */
function bigToLeHex(value) {
    const bytes = new Uint8Array(32)
    let x = BigInt(value)

    for (let i = 0; i < 32; i += 1) {
        bytes[i] = Number(x & 0xffn)
        x >>= 8n
    }

    return binToHex(bytes)
}

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
