// src/lib/pool/verifier-role2.js
//
// The role-2 (3-input, bn-native-sound) verifier-step witness generator.
//
// The deployed role-2 program is the Hush `bn-native-sound` build under the
// ceremony VK (05250429…). Its witness is the bench `unlockingsFor` layout:
//
//   input 0 (fuel):    [S_0] [DS_0] [CODE_0] [FILL_0] [R]
//   input 1 (fuel):    [S_1] [HAND_1] [DS_1] [CODE_1] [FILL_1] [R]
//   input 2 (state):   [DG] [STMT] [S_2] [HAND_2] [DS_2] [FILL_2] [WQ] [R]
//
// The fillers only buy op budget (all zero, read by nothing except FILL_2's
// z-tail hash). The prover sizes each filler so the input's STANDARD op cost
// is at most (1 - MARGIN) of its budget, capped at the 10,000-byte limit.
//
// The program is derived at run time from the deployed covenant hook + the
// category; the category binds the program (a different category is a
// different pool). The live role-2 witnesses (9d9aa97a…, 5262417b…,
// e54d19fb…) are the byte-exact acceptance oracle.

import { buildProgram, setCovenant } from './role2/script.mjs'
import { covenantHook, covenantParams } from './role2/pool-hook.mjs'
import { transactionFor } from './role2/transaction.mjs'
import { poolTransactionFor } from './role2/pool-tx.mjs'
import { normalizeProof } from './verifier.js'

/* The deployed category, little-endian (the on-chain byte order the program commits to). */
export const ROLE2_CATEGORY_ONCHAIN = 'd0b901bd0ab5d02856399af26615f676173b36be2ddde96f0b5f3f1dff300e48'

let _program = null
let _category = null

/* Build (and cache) the deployed program for a category. */
export function role2Program(categoryOnChain = ROLE2_CATEGORY_ONCHAIN) {
    if (_program && _category === categoryOnChain) return _program
    setCovenant(covenantHook(covenantParams({ categoryOnChain })))
    _program = buildProgram()
    _category = categoryOnChain
    return _program
}

/**
 * Produce the three role-2 verifier-step unlocking bytecodes.
 *
 * @param proof        the Groth16 proof ({ a, b, c } with snarkjs field encodings)
 * @param publicSignals the proof's public signals [merkleRoot, actionHash]
 * @param categoryOnChain the pool category in on-chain (little-endian) byte order
 * @param scenarioArgs   optional pool shape { sc, n0, balance, oldNull, categoryDisplay };
 *                       when supplied the fillers are sized against the REAL pool
 *                       transaction (pool-tx.mjs), not the stock synthetic one. The
 *                       state input reads the outputs (token conservation), so the
 *                       stock sizer underestimates its op-cost and leaves FILL_2
 *                       short (450 B on the live shield); the live FILL_2 feeds the
 *                       z challenge, so fuel1/state only match with this path.
 * @returns the three { unlocking } bytecodes in step order [fuel0, fuel1, state]
 */
export function produceRole2Inputs({ proof, publicSignals, categoryOnChain = ROLE2_CATEGORY_ONCHAIN, scenarioArgs }) {
    const program = role2Program(categoryOnChain)
    const fx = { proof: normalizeProof(proof), publicInputs: publicSignals }
    const { unlockings } = scenarioArgs
        ? poolTransactionFor(fx, program, scenarioArgs)
        : transactionFor(fx, program)
    return unlockings
}
