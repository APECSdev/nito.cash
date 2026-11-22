// src/lib/pool/decode.js
//
// Pool covenant ACTION decoder (wallet side) — the note-indexer data path.
//
// Decodes one raw pool action transaction (SHIELD / TRANSFER / UNSHIELD):
//   - locates the covenant input (the input spending the pool P2SH32 UTXO,
//     identified by its unlocking bytecode ending in the ~222-347 B redeem
//     script push),
//   - extracts the covenant arguments from the unlocking bytecode pushes, and
//   - extracts any encrypted-note CARRIER packets from the outputs
//     (see carrier.js / NOTE-CARRIER.md).
//
// ARGUMENT LAYOUT — established EMPIRICALLY by apps/web/indexer-proto.mjs
// against LIVE chipnet action txs (the recomputed Option-F actionHash MATCHED
// the documented on-chain values): the unlocking bytecode's pushes, left to
// right, are
//     [isUnshield, publicValueAbs, newMerkleRoot, cm1, cm0, nf1, nf0, <pad>, redeem]
// — cashscript pushes the function's declared args in REVERSE order (stack
// discipline), after the small-int pushes land first. All field elements are
// 32-byte LE VM-number forms; small ints (isUnshield/publicValueAbs) are
// minimal LE VM numbers.
//
// PROVEN PUBLIC INPUTS — the two values the on-chain Groth16 verifier proved
// for this action live at FIXED byte offsets of the verifier genesis step's
// unlocking bytecode (tx input index 3; stable across all fixtures — the
// deployed covenant itself reads them there, asset-pool.cash):
//     n0 = merkleRoot  — 32-byte LE VM number at byte offset 1825
//     n1 = actionHash  — 32-byte LE VM number at byte offset 1792
// (byte 1824 / 1791 is the 0x20 push opcode; the DATA starts at +1.)

import { binToHex, decodeTransaction, hexToBin } from '@bitauth/libauth'

import { parseCarrierLockingBytecode } from './carrier'

/* Byte offset of the n0 (merkleRoot) / n1 (actionHash) DATA payloads in the
   verifier genesis step's unlocking bytecode (asset-pool.cash comments). */
export const PROVEN_N0_OFFSET = 1825
export const PROVEN_N1_OFFSET = 1792

/*
 * The verifier genesis input's INDEX is a BUILDER choice and differs between
 * pool deployments — do NOT hardcode it. The live gate3 SHIELD (f5927a0b)
 * carries its genesis at input index 4 with the covenant input at 0, while
 * the eval harness used input 3 — but in EVERY layout the genesis witness
 * carries the 0x20 push opcodes at the two documented offsets. The genesis
 * is therefore FOUND by its marker profile (verified live: only the true
 * genesis matches).
 */
export function findVerifierGenesisIndex(tx) {
    return tx.inputs.findIndex((input) =>
        input.unlockingBytecode.length > PROVEN_N0_OFFSET + 32 &&
        input.unlockingBytecode[PROVEN_N1_OFFSET - 1] === 0x20 &&
        input.unlockingBytecode[PROVEN_N0_OFFSET - 1] === 0x20)
}

/*
 * Parse a bitcoin-script bytecode into its DATA PUSHES (adapted verbatim from
 * apps/web/indexer-proto.mjs, the live-verified prototype).
 *
 * Handles: OP_0, direct pushes (<= 0x4b), OP_PUSHDATA1/2, and the small
 * OP_1..OP_16 constants (as 1-byte items). Any other opcode terminates the
 * item as `null` (non-push) — callers only consume data pushes.
 */
export function scriptPushes(bytecode) {
    const items = []

    let i = 0

    while (i < bytecode.length) {
        const op = bytecode[i]
        i += 1

        let len

        if (op === 0) {
            items.push(new Uint8Array(0))

            continue
        } else if (op <= 0x4b) {
            len = op
        } else if (op === 0x4c) {
            len = bytecode[i]
            i += 1
        } else if (op === 0x4d) {
            len = bytecode[i] | (bytecode[i + 1] << 8)
            i += 2
        } else if (op >= 0x51 && op <= 0x60) {
            items.push(new Uint8Array([op - 0x50]))

            continue
        } else {
            items.push(null)

            continue
        }

        items.push(bytecode.slice(i, i + len))
        i += len
    }

    return items
}

/* 32-byte LE VM-number bytes -> BigInt (indexer-proto.mjs leToBig). */
export function leToBig(bytes) {
    return (bytes && bytes.length)
        ? BigInt('0x' + binToHex(new Uint8Array(bytes).reverse()))
        : 0n
}

/* Byte array -> display txid hex (BCH txids are the double-SHA256 in
   little-endian display order; libauth's outpoint hash is the LE byte form). */
export function txidHexOf(bytes) {
    return binToHex(new Uint8Array(bytes).reverse())
}

/*
 * The covenant input index of a decoded transaction, or -1: the input whose
 * unlocking bytecode ends in the ~222-347 byte redeem-script push (>= 8
 * pushes — 7 covenant args + the redeem; the pool input in the live 7-input
 * tx shapes). The verifier inputs (5,909 B / 7,769 B witnesses) and plain
 * P2PKH funding inputs never match this profile.
 */
export function findCovenantInputIndex(tx) {
    return tx.inputs.findIndex((input) => {
        const pushes = scriptPushes(input.unlockingBytecode)

        if (pushes.length < 8) return false

        const last = pushes[pushes.length - 1]

        return last && last.length > 200 && last.length < 400
    })
}

/*
 * Decode ONE pool action tx.
 *
 * @param {string|Uint8Array} rawTx — the raw transaction (hex or bytes).
 * @returns {object|null} null when the tx is NOT a pool action (e.g. the
 *   DEPLOY/GENESIS creation tx has no covenant input); otherwise:
 *   {
 *     covenantInputIndex,
 *     prevoutTxid,           — display txid of the PREVIOUS pool state output
 *                              (the tx that created this input — the chain key)
 *     args: { isUnshield, publicValueAbs, newMerkleRoot, cm0, cm1, nf0, nf1 },
 *     carriers,              — extracted NP01 packets ([] when none)
 *     proven: { merkleRoot, actionHash },  — n0/n1 from the verifier witness
 *   }
 * @throws on an undecodable transaction (bad hex/truncation).
 */
export function decodePoolAction(rawTx) {
    const bin = (typeof rawTx === 'string') ? hexToBin(rawTx) : rawTx

    const tx = decodeTransaction(bin)

    if (typeof tx === 'string') {
        throw new Error(`pool decode: not a transaction (${tx})`)
    }

    const idx = findCovenantInputIndex(tx)

    if (idx === -1) {
        /* Not an action (state-creation tx — DEPLOY/GENESIS). */
        return null
    }

    const pushes = scriptPushes(tx.inputs[idx].unlockingBytecode)

    /* Empirical arg layout — see the file header / indexer-proto.mjs. */
    const args = {
        isUnshield: leToBig(pushes[0]),
        publicValueAbs: leToBig(pushes[1]),
        newMerkleRoot: leToBig(pushes[2]),
        cm1: leToBig(pushes[3]),
        cm0: leToBig(pushes[4]),
        nf1: leToBig(pushes[5]),
        nf0: leToBig(pushes[6]),
    }

    /* Carrier packets from the outputs (non-carrier outputs yield null). */
    const carriers = tx.outputs
        .map((output) => parseCarrierLockingBytecode(output.lockingBytecode))
        .filter(Boolean)

    /* The proven public inputs, read from the verifier genesis witness at the
       FIXED offsets the deployed covenant itself uses (found by marker — see
       findVerifierGenesisIndex). */
    const genesisIndex = findVerifierGenesisIndex(tx)

    if (genesisIndex === -1) {
        throw new Error('pool decode: no verifier genesis input (marker profile not found)')
    }

    const genesisUnlocking = tx.inputs[genesisIndex].unlockingBytecode

    const proven = {
        merkleRoot: leToBig(genesisUnlocking.slice(PROVEN_N0_OFFSET, PROVEN_N0_OFFSET + 32)),
        actionHash: leToBig(genesisUnlocking.slice(PROVEN_N1_OFFSET, PROVEN_N1_OFFSET + 32)),
    }

    return {
        covenantInputIndex: idx,
        prevoutTxid: txidHexOf(tx.inputs[idx].outpointTransactionHash),
        args,
        carriers,
        proven,
    }
}
