// src/lib/pool/verifier-role2-3out.js
//
// The 3-output (v3) role-2 verifier-step witness generator.
//
// The 3-out program is the same reviewed `bn-native-sound` build as the 2-out
// role-2 pool, under the NEW 3-out verifying key (the 1-of-1 demo setup,
// `build3/verification_key.json` sha256 d4ed12ee…). The carrier grows from
// 169 to 201 bytes (cm2) and the actionHash preimage from 8 to 9 fields; the
// verifier contract is unchanged (2 public inputs, 3 inputs).
//
// The program is derived at run time from the 3-out covenant hook + the
// category. The category binds the program (a different category is a
// different pool). The 3-out demo pool's live UNSHIELD (ec31a41c…) is the
// byte-exact acceptance oracle.
//
// The 2-out path (`verifier-role2.js`) is untouched; this module is additive.

import { buildProgram, setCovenant } from './role2-3out/script.mjs'
import { covenantHook, covenantParams } from './role2-3out/pool-hook.mjs'
import { poolTransactionFor } from './role2-3out/pool-tx.mjs'
import { normalizeProof } from './verifier.js'

/* The deployed 3-out demo category, little-endian (the on-chain byte order the
   program commits to): display bc607a96…2e635 reversed. */
export const ROLE2_3OUT_CATEGORY_ONCHAIN =
    '35e6720020c65d991981017406c6c334f4d30570433d2600141aa2c8967a60bc'

let _program = null
let _category = null

/* Build (and cache) the 3-out program for a category. */
export function role2Program3out(categoryOnChain = ROLE2_3OUT_CATEGORY_ONCHAIN) {
    if (_program && _category === categoryOnChain) return _program
    setCovenant(covenantHook(covenantParams({ categoryOnChain }), 3))
    _program = buildProgram()
    _category = categoryOnChain
    return _program
}

/**
 * Produce the three role-2 verifier-step unlocking bytecodes for a 3-out action.
 *
 * @param proof          the Groth16 proof ({ a, b, c } with snarkjs field encodings)
 * @param publicSignals  the proof's public signals [merkleRoot, actionHash]
 * @param categoryOnChain the pool category in on-chain (little-endian) byte order
 * @param scenarioArgs   the pool shape { sc, n0, balance, oldNull, categoryDisplay };
 *                       `sc` carries cm2 and the three out-note values.
 * @returns the three { unlocking } bytecodes in step order [fuel0, fuel1, state]
 */
export function produceRole2Inputs3out({ proof, publicSignals, categoryOnChain = ROLE2_3OUT_CATEGORY_ONCHAIN, scenarioArgs }) {
    const program = role2Program3out(categoryOnChain)
    const fx = { proof: normalizeProof(proof), publicInputs: publicSignals }
    const { unlockings } = poolTransactionFor(fx, program, { ...scenarioArgs, outs: 3 })
    return unlockings
}
