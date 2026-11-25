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
// Every step is observable through `onStage` so the UI can show progress.

import { depositTag } from './role2-carrier.js'
import { buildRole2Lock } from './role2-lock.js'
import { buildRole2Action } from './role2-action.js'

const STAGES = ['proving', 'tagging', 'locking', 'building', 'broadcasting', 'done']

function stage(onStage, name, detail = {}) {
    if (typeof onStage === 'function') onStage(name, detail)
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

    stage(onStage, 'proving')
    const proof = await prove({ pool, state, blanks, funding, supply, shield, payoutAddress })
    if (!proof?.carrier || proof.carrier.length !== 169) throw new Error('role2-actions: the prover returned no 169-B carrier')
    if (!Array.isArray(proof.unlockings) || proof.unlockings.length !== 3) throw new Error('role2-actions: the prover returned no 3 unlockings')

    stage(onStage, 'tagging')
    const tag = depositTag(proof.carrier)

    stage(onStage, 'locking')
    const lock = await buildRole2Lock({
        pool,
        tag,
        shield,
        fundingUtxo: funding,
        blanks,
        supplyUtxo: supply,
        changeAddress,
        privateKey,
    })

    stage(onStage, 'building')
    const action = await buildRole2Action({
        pool,
        carrier: proof.carrier,
        newRoot: proof.newRoot,
        newNull: proof.newNull,
        newBalance: proof.newBalance,
        stateUtxo: state,
        fuelUtxos: [
            { txid: lock.txid, vout: 0, sats: lock.fuelSats },
            { txid: lock.txid, vout: 1, sats: lock.fuelSats },
        ],
        unlockings: proof.unlockings,
        payoutAddress,
    })

    stage(onStage, 'broadcasting')
    const lockTxid = await broadcast(lock.hex, 'lock')
    const actionTxid = await broadcast(action.hex, 'action')

    if (typeof saveNotes === 'function') {
        await saveNotes({
            lockTxid,
            actionTxid,
            carrier: proof.carrier,
            tag: lock.tag,
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
        tag: lock.tag,
        stages: STAGES,
        fee: action.fee,
    }
}
