// src/lib/pool/role2-actions.js
//
// The role-2 action orchestrator (handoff §4): prove FIRST → tag → lock →
// broadcast the lock + action TOGETHER.
//
// The proving pipeline is injected (`prove`) because the Hush proving assets
// are not in this repo yet. The prover must return the 169-B carrier, the three
// program unlockings, and the new state (root/null/balance). The orchestrator
// then:
//   1. tag  = depositTag(carrier) = SHA256(carrier[0..64])
//   2. lock = buildRole2Lock(...)  — 2 tagged fuel UTXOs + (shield) FT deposit
//   3. act  = buildRole2Action(...) — 3 inputs, carrier, new state, payout
//   4. broadcast lock; broadcast action (the action may spend the unconfirmed
//      lock outputs; first-seen wins the state double-spend — the client rule)
//   5. deliver the two out-notes off-chain (the carrier has no room for them)
//
// STANDING-FUEL PATH (B2): when `standingFuel` is passed (exactly TWO fuel
// UTXOs already sitting at the program — a lock whose action never
// broadcast), NO fresh lock is built and the action spends the standing fuel
// directly. The deposit tag the lock wrote on both fuel UTXOs binds the
// intended action's nullifiers (hook check 4g), so the recovery MUST reuse
// that in-note pair — matchStandingFuelNotes finds it. Only the action is
// broadcast.
//
// Every step is observable through `onStage` so the UI can show progress.

import { binToHex } from '@bitauth/libauth'

import { ROLE2_CARRIER_BYTES, ROLE2_CARRIER_BYTES_3OUT, depositTag } from './role2-carrier.js'
import { buildRole2Lock, buildRole2LockV3 } from './role2-lock.js'
import { buildRole2Action, buildRole2ActionV3 } from './role2-action.js'
import { nullifier } from './notes.js'

const STAGES = ['proving', 'tagging', 'locking', 'building', 'broadcasting', 'done']
const STAGES_STANDING = ['proving', 'tagging', 'building', 'broadcasting', 'done']

function stage(onStage, name, detail = {}) {
    if (typeof onStage === 'function') onStage(name, detail)
}

/* The standing fuel's deposit tag: the NFT commitment hex (Fulcrum spells
   it in `token_data`, the store's normalize() in `token`), normalized. */
function fuelTagOf(utxo) {
    const token = utxo?.token || utxo?.token_data || null

    return String(token?.nft?.commitment ?? '').replace(/^0x/, '').toLowerCase()
}

/*
 * matchStandingFuelNotes — the in-note pair a standing fuel's deposit tag
 * binds. The lock tagged both fuel UTXOs with SHA256(nf0_LE ‖ nf1_LE) of the
 * action it was funding (role2-lock.js), so a recovery action MUST spend
 * exactly that pair or the program's check 4g rejects the fuel: the wallet's
 * own unspent notes (BOTH orders — the tag is order-sensitive) and, for a
 * bootstrap-tagged lock, the pool's published seed pair. The same leaf can
 * never fund both slots (the selectInNotes duplicate rule).
 *
 * @param {object}   opts
 * @param {string}   opts.commitment        the standing fuel's NFT commitment (the tag) hex
 * @param {object[]} [opts.ownNotes]        the wallet's notes (the store shape)
 * @param {object[]} [opts.bootstrapNotes]  the pool's published seed pair (the
 *                                          registry bootstrapNotes, witness shape)
 * @returns {Promise<object[]|null>} the matching pair in the buildPoolWitness
 *   in-note shape [{ note: {value, ownerPub, rho, r}, nk, index }], or null.
 */
export async function matchStandingFuelNotes({ commitment, ownNotes = [], bootstrapNotes = [] }) {
    const tagHex = String(commitment ?? '').replace(/^0x/, '').toLowerCase()
    if (tagHex.length !== 64) return null

    const candidates = []

    for (const note of ownNotes || []) {
        if (note.spent) continue

        candidates.push({
            note: {
                value: BigInt(note.value),
                ownerPub: BigInt(note.ownerPub),
                rho: BigInt(note.rho),
                r: BigInt(note.r),
            },
            nk: BigInt(note.nk),
            index: note.leafIndex,
        })
    }

    for (const bootstrap of bootstrapNotes || []) {
        candidates.push({
            note: {
                value: BigInt(bootstrap.note.value),
                ownerPub: BigInt(bootstrap.note.ownerPub),
                rho: BigInt(bootstrap.note.rho),
                r: BigInt(bootstrap.note.r),
            },
            nk: BigInt(bootstrap.nk),
            index: bootstrap.index,
        })
    }

    /* One nullifier per candidate; every ordered distinct-leaf pair is trialed. */
    const nfs = []

    for (const candidate of candidates) {
        nfs.push(await nullifier(candidate.nk, candidate.note.rho))
    }

    const le32 = (value) => {
        const bytes = new Uint8Array(32)
        let x = BigInt(value)
        for (let i = 0; i < 32; i += 1) { bytes[i] = Number(x & 0xffn); x >>= 8n }
        return bytes
    }
    const tagOf = (a, b) => binToHex(depositTag(new Uint8Array([...le32(a), ...le32(b)])))

    for (let i = 0; i < candidates.length; i += 1) {
        for (let j = 0; j < candidates.length; j += 1) {
            if (i === j) continue
            if (candidates[i].index === candidates[j].index) continue
            if (tagOf(nfs[i], nfs[j]) !== tagHex) continue

            return [candidates[i], candidates[j]]
        }
    }

    return null
}

/*
 * submitRole2Action
 *
 * @param {object}   opts
 * @param {object}   opts.pool          the role-2 registry entry
 * @param {object}   opts.state         the current state UTXO
 * @param {object[]} opts.blanks        exactly TWO user-held blank UTXOs
 * @param {object}   opts.funding       a plain BCH UTXO for the fuel sats
 * @param {object}   [opts.supply]      a pool-category FT UTXO (shields)
 * @param {bigint}   [opts.shield]      the FT deposit (pv) for a shield
 * @param {object[]} [opts.standingFuel] exactly TWO fuel UTXOs already at the
 *                                       program (B2): skips the fresh lock;
 *                                       both must carry THIS action's deposit
 *                                       tag as their NFT commitment
 * @param {string}   opts.changeAddress the user's CashAddress
 * @param {Uint8Array} opts.privateKey  the user's signing key
 * @param {Function} opts.prove         async (args) => { carrier, unlockings, newRoot, newNull, newBalance }
 * @param {Function} opts.broadcast     async (hex, label) => txid (the Fulcrum broadcast)
 * @param {Function} [opts.onStage]     progress callback
 * @param {Function} [opts.saveNotes]   async (notes) => void (off-chain note delivery)
 * @param {string}   [opts.payoutAddress] the unshield payout address
 */
export async function submitRole2Action({
    pool,
    state,
    blanks,
    funding,
    supply = null,
    shield = 0n,
    standingFuel = null,
    changeAddress,
    privateKey,
    prove,
    broadcast,
    onStage,
    saveNotes,
    payoutAddress,
}) {
    if (!pool) throw new Error('role2-actions: pool is required')
    if (!state) throw new Error('role2-actions: state UTXO is required')
    if (typeof prove !== 'function') throw new Error('role2-actions: a prove function is required')
    if (typeof broadcast !== 'function') throw new Error('role2-actions: a broadcast function is required')
    if (standingFuel && (!Array.isArray(standingFuel) || standingFuel.length !== 2 || !standingFuel[0] || !standingFuel[1])) throw new Error('role2-actions: standingFuel must be exactly TWO fuel UTXOs')

    stage(onStage, 'proving')
    const proof = await prove({ pool, state, blanks, funding, supply, shield, payoutAddress, standingFuel })
    if (!proof?.carrier || (proof.carrier.length !== ROLE2_CARRIER_BYTES && proof.carrier.length !== ROLE2_CARRIER_BYTES_3OUT)) throw new Error(`role2-actions: the prover returned no ${ROLE2_CARRIER_BYTES}-B or ${ROLE2_CARRIER_BYTES_3OUT}-B carrier`)
    if (!Array.isArray(proof.unlockings) || proof.unlockings.length !== 3) throw new Error('role2-actions: the prover returned no 3 unlockings')

    stage(onStage, 'tagging')
    const tag = depositTag(proof.carrier)
    const tagHex = binToHex(tag)

    let lock = null
    let lockTxid = null

    if (standingFuel) {
        /* B2 — spend the standing fuel: the deposit tag the lock wrote must
           equal THIS action's tag or the program's check 4g rejects the fuel
           inputs; fail loudly BEFORE any broadcast. */
        for (const [index, utxo] of standingFuel.entries()) {
            const fuelTag = fuelTagOf(utxo)
            if (fuelTag !== tagHex) {
                throw new Error(`role2-actions: the standing fuel ${index} carries tag ${fuelTag.slice(0, 16) || '(none)'}… but this action's deposit tag is ${tagHex.slice(0, 16)}… — the fuel is bound to a different nullifier pair`)
            }
        }

        lockTxid = standingFuel[0].txid
    } else {
        stage(onStage, 'locking')
        lock = await buildRole2Lock({
            pool,
            tag,
            shield,
            fundingUtxo: funding,
            blanks,
            supplyUtxo: supply,
            changeAddress,
            privateKey,
        })
    }

    stage(onStage, 'building')
    const action = await buildRole2Action({
        pool,
        carrier: proof.carrier,
        newRoot: proof.newRoot,
        newNull: proof.newNull,
        newBalance: proof.newBalance,
        stateUtxo: state,
        fuelUtxos: standingFuel || [
            { txid: lock.txid, vout: 0, sats: lock.fuelSats },
            { txid: lock.txid, vout: 1, sats: lock.fuelSats },
        ],
        unlockings: proof.unlockings,
        payoutAddress,
    })

    stage(onStage, 'broadcasting')
    if (lock) lockTxid = await broadcast(lock.hex, 'lock')
    const actionTxid = await broadcast(action.hex, 'action')

    if (typeof saveNotes === 'function') {
        await saveNotes({
            lockTxid,
            actionTxid,
            carrier: proof.carrier,
            tag: lock ? lock.tag : tagHex,
            outNotes: proof.outNotes || [],
            stage: 'broadcast',
        })
    }

    stage(onStage, 'done', { lockTxid, actionTxid })
    return {
        lockTxid,
        actionTxid,
        lock,
        action,
        tag: lock ? lock.tag : tagHex,
        stages: lock ? STAGES : STAGES_STANDING,
        fee: action.fee,
    }
}

/*
 * submitRole2ActionV3 — the v3 (pool4) orchestrator: prove FIRST → tag →
 * lock (the v3.1 shape: 2 tagged fuel + 2 walk-data UTXOs at the P2SH32 walk
 * wraps) → the FIVE-input action → broadcast together → the off-chain notes.
 *
 * The v3 prove contract (injected, like the 2-out/3-out path — the pinned
 * assets live in the store layer):
 *   async (args) => {
 *     carrier,            the 201-B carrier
 *     unlockings,         the THREE program witnesses (produceRole2InputsV3)
 *     walkUnlockings,     the TWO walk witnesses (walkWitnesses: midRoot ‖
 *                         sibBlobA ‖ walkA-redeem / sibBlobB ‖ walkB-redeem)
 *     newRoot,            32-B LE (the note root half of the new commitment)
 *     finalNullRoot,      32-B (the SMT half — walkB pins it)
 *     newBalance, outNotes, opData …
 *   }
 *
 * The standing-fuel path (B2) for v3: `standing` = { fuel: [f0, f1], walk:
 * [wA, wB] } — a lock whose action never broadcast; NO fresh lock is built,
 * the fuel tags MUST match this action's (the hook's 4g), and the walk pair
 * is spent as-is (they are plain dust, untamable by tags — the graph's SHA256
 * pins bind them).
 */
export async function submitRole2ActionV3({
    pool,
    state,
    blanks,
    funding,
    supply = null,
    shield = 0n,
    standing = null,
    changeAddress,
    privateKey,
    prove,
    broadcast,
    onStage,
    saveNotes,
    payoutAddress,
}) {
    if (!pool) throw new Error('role2-actions: pool is required')
    if (!state) throw new Error('role2-actions: state UTXO is required')
    if (typeof prove !== 'function') throw new Error('role2-actions: a prove function is required')
    if (typeof broadcast !== 'function') throw new Error('role2-actions: a broadcast function is required')
    if (!Array.isArray(blanks) || blanks.length !== 2) throw new Error('role2-actions: exactly TWO blanks are required')
    if (standing && (!Array.isArray(standing?.fuel) || standing.fuel.length !== 2 || !Array.isArray(standing?.walk) || standing.walk.length !== 2)) throw new Error('role2-actions: standing must be { fuel: [f0, f1], walk: [wA, wB] }')

    stage(onStage, 'proving')
    const proof = await prove({ pool, state, blanks, funding, supply, shield, payoutAddress, standing })
    if (!proof?.carrier || proof.carrier.length !== ROLE2_CARRIER_BYTES_3OUT) throw new Error(`role2-actions: the v3 prover returned no ${ROLE2_CARRIER_BYTES_3OUT}-B carrier`)
    if (!Array.isArray(proof.unlockings) || proof.unlockings.length !== 3) throw new Error('role2-actions: the prover returned no 3 program unlockings')
    if (!Array.isArray(proof.walkUnlockings) || proof.walkUnlockings.length !== 2) throw new Error('role2-actions: the prover returned no 2 walk unlockings')

    stage(onStage, 'tagging')
    const tag = depositTag(proof.carrier)
    const tagHex = binToHex(tag)

    let lock = null
    let lockTxid = null
    let fuelUtxos
    let walkUtxos

    if (standing) {
        for (const [index, utxo] of standing.fuel.entries()) {
            const fuelTag = fuelTagOf(utxo)
            if (fuelTag !== tagHex) {
                throw new Error(`role2-actions: the standing fuel ${index} carries tag ${fuelTag.slice(0, 16) || '(none)'}… but this action's deposit tag is ${tagHex.slice(0, 16)}… — the fuel is bound to a different nullifier pair`)
            }
        }
        fuelUtxos = standing.fuel
        walkUtxos = standing.walk
        lockTxid = standing.fuel[0].txid
    } else {
        stage(onStage, 'locking')
        lock = await buildRole2LockV3({
            pool,
            tag,
            shield,
            fundingUtxo: funding,
            blanks,
            supplyUtxo: supply,
            changeAddress,
            privateKey,
        })
        fuelUtxos = lock.fuelOutpoints
        walkUtxos = lock.walkOutpoints
    }

    stage(onStage, 'building')
    const action = await buildRole2ActionV3({
        pool,
        carrier: proof.carrier,
        newRoot: proof.newRoot,
        finalNullRoot: proof.finalNullRoot,
        newBalance: proof.newBalance,
        stateUtxo: state,
        fuelUtxos,
        walkUtxos,
        unlockings: proof.unlockings,
        walkUnlockings: proof.walkUnlockings,
        payoutAddress,
    })

    stage(onStage, 'broadcasting')
    if (lock) lockTxid = await broadcast(lock.hex, 'lock')
    const actionTxid = await broadcast(action.hex, 'action')

    if (typeof saveNotes === 'function') {
        await saveNotes({
            lockTxid,
            actionTxid,
            carrier: proof.carrier,
            tag: lock ? lock.tag : tagHex,
            outNotes: proof.outNotes || [],
            stage: 'broadcast',
        })
    }

    stage(onStage, 'done', { lockTxid, actionTxid })
    return {
        lockTxid,
        actionTxid,
        lock,
        action,
        tag: lock ? lock.tag : tagHex,
        stages: lock ? STAGES : STAGES_STANDING,
        fee: action.fee,
    }
}
