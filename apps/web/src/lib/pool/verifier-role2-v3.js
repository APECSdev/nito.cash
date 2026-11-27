// src/lib/pool/verifier-role2-v3.js
//
// The v3 (pool4) role-2 verifier-step + walk-input generator.
//
// The v3 program is the SAME reviewed `bn-native-sound` build as the 2-out/3-out
// pools, under the pool4 VK (247,120-c circuit, nPublic 2), with the graph's
// shape pin at NROLES+2 (the v3-graph-pin patch, env-gated — stock builds stay
// byte-identical) and the v3 role-2 hook (check 4w pins the walk lockings by
// SHA256; the fold check 7 is GONE — the SHA256 SMT the walk scripts verify
// replaces it; check 10 verifies the 64-B state commitment's first half).
//
// The v3.1 FIELD CORRECTION (measured on chipnet 2026-11-27, pool-tx-v3.mjs):
// the walk UTXOs are P2SH32-WRAPPED on chain — the RAW 278/291-B scripts are a
// NON-STANDARD scriptPubKey and relay refuses the creating tx ("scriptpubkey
// (code 64)"). The scripts ride the unlockings as the redeem push (P2SH32
// form, exactly like the program's own inputs); the hook's 4w and the graph's
// ND pins hash the P2SH32 LOCKINGS (SHA256(UTXOBYTECODE(3/4)) — the source
// locking, whatever its form). The deployed pool's pins (state file
// role2-pool4-state.json): walkA 9f0a1a98… walkB 338f4d86… = sha256 of the
// aa20…87 wraps, NOT of the raw scripts.
//
// The action shape: 5 inputs / 3 outputs. Inputs 3/4 are the walk-data UTXOs
// (witnesses = midRoot + sibBlobA + walkA redeem / sibBlobB + walkB redeem).
// The 2-out and 3-out paths in this module's dependencies are untouched; the
// vendored pool-hook.mjs v3 branch is additive (v3 = null keeps the deployed
// hooks byte-identical).

import { buildProgram, setCovenant } from './role2-3out/script.mjs'
import { covenantHook, covenantParams } from './role2-3out/pool-hook.mjs'
import { buildWalkScripts } from './role2-3out/walk-scripts.mjs'
import { walkV3, poolTransactionForV3 } from './role2-3out/pool-tx-v3.mjs'
import { setVkFixtures, restoreVkFixtures, VK_FIXTURES_V3 } from './role2-3out/sound-si-gls/math.mjs'
import { normalizeProof } from './verifier.js'

/* The deployed chipnet v3 pool's category, display byte order (the state
   file's `category` field). The on-chain order is this reversed. */
export const ROLE2_V3_CHIPNET_CATEGORY_DISPLAY =
    'e56c0a8583e36092f20e54c9247f6b8e5a6afd391027aa70ae109c3c42377930'

/* The deployed walk-locking pins — sha256 of the P2SH32 wraps (v3.1). These
   are what the deployed program's hook 4w + graph ND pins commit to. */
export const ROLE2_V3_CHIPNET_WALK_A_HASH =
    '9f0a1a9827c5c9889a888a71d8ac8ebc35e8819f8f097fb72a69cd64dab507f8'
export const ROLE2_V3_CHIPNET_WALK_B_HASH =
    '338f4d86798584041cb87801f3b15ccdd656a1be8313bdd29c3d5b69e26ffd6f'

/* The deployed program's build record (the state file): code 7,998 B,
   sha256 27b904a2…, pieces [4111, 3887], locking aa206dc9… */
export const ROLE2_V3_CHIPNET_CODE_SHA256 =
    '27b904a2ddec9e6b4ad5a261084be6ed18e59420e5e41e9400f72586bda88510'
export const ROLE2_V3_CHIPNET_LOCKING =
    'aa206dc915cef6f1343b7d170caaf79346072222d66fd3285fcb4d506f184069e8cb87'

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)))

let _v3Cache = null

/**
 * The walk scripts + their P2SH32 wraps for a v3 pool category.
 *
 * `buildWalkScripts` emits the RAW 278/291-B scripts (the redeem bytecodes);
 * `walkV3` wraps them (the on-chain lockings) and hashes the WRAPS — the
 * deployed program's pin target (v3.1). Byte-fidelity: the raw scripts derive
 * from the category alone, so the deployed pool's scripts reproduce exactly.
 *
 * @param categoryOnChain the pool category in on-chain (little-endian) byte order
 * @returns { walkA, walkB, walkLockings, walkAHash, walkBHash, sizes }
 */
export function v3WalkScripts(categoryOnChain) {
    const { walkA, walkB, sizes } = buildWalkScripts(categoryOnChain)
    const { lockings, hashes } = walkV3(walkA, walkB)
    return {
        walkA,
        walkB,
        walkLockings: lockings,
        walkAHash: hexOf(hashes[0]),
        walkBHash: hexOf(hashes[1]),
        sizes,
    }
}

/**
 * Build (and cache) the v3 hooked program for a category + walk-locking pins.
 *
 * The graph pin is env-gated in the vendored generator (their exact build
 * recipe, pool-build-v3.mjs): POOL_NULLDATA_HASHES = [walkAHash, walkBHash]
 * flips the GRAPH local to NROLES+2 with the two SHA256 pins; the env is
 * restored after the build so stock (2-out/3-out) builds stay byte-identical.
 *
 * @param categoryOnChain the pool category in on-chain (little-endian) byte order
 * @param walkAHash sha256 hex of the deployed walkA P2SH32 locking
 * @param walkBHash sha256 hex of the deployed walkB P2SH32 locking
 */
export function role2ProgramV3(categoryOnChain, walkAHash, walkBHash) {
    const key = categoryOnChain + '|' + walkAHash + '|' + walkBHash
    if (_v3Cache && _v3Cache.key === key) return _v3Cache.program
    const prevNd = process.env.POOL_NULLDATA_HASHES
    process.env.POOL_NULLDATA_HASHES = JSON.stringify([walkAHash, walkBHash])
    /* the program build EMBEDS the VK's curve data — the v3 (pool4) program
       requires the v3 fixtures (the VM's BN_VK_FIXTURES build of record); the
       3-out default is restored after (the 2-out/3-out builds must keep
       reproducing their deployed programs byte-exactly). */
    setVkFixtures(VK_FIXTURES_V3)
    setCovenant(covenantHook(covenantParams({ categoryOnChain }), 3, {
        walkAHash: bytesOf(walkAHash),
        walkBHash: bytesOf(walkBHash),
    }))
    const program = buildProgram()
    restoreVkFixtures()
    if (prevNd === undefined) delete process.env.POOL_NULLDATA_HASHES
    else process.env.POOL_NULLDATA_HASHES = prevNd
    _v3Cache = { key, program }
    return program
}

/**
 * Produce the five v3 action unlockings for a proved action.
 *
 * `poolTransactionForV3` is the pool-aware fill sizer (inputs 0-2 sized against
 * the FIVE-input pool shape; the walks ride at fixed witness sizes) — the same
 * convergence loop the 3-out acceptance proved on live actions.
 *
 * @param proof          the Groth16 proof ({ a, b, c } with snarkjs field encodings)
 * @param publicSignals  the proof's public signals [merkleRoot, actionHash]
 * @param categoryOnChain the pool category in on-chain (little-endian) byte order
 * @param walkAHash/walkBHash the deployed walk-locking pins (sha256 hex)
 * @param scenarioArgs   { sc, n0, nullSet, balance, categoryDisplay } — `sc`
 *                       carries the covenant args (nf0, nf1, cm0..cm2, newRoot,
 *                       pv, sign as BigInt), `nullSet` the op JSON's walk data
 *                       (sibsA, midRoot, sibsB, finalNullRoot, nullSetRootBefore)
 * @returns { program, unlockings, walkUnlockings, fills, scenario, locking }
 */
export function produceRole2InputsV3({ proof, publicSignals, categoryOnChain, walkAHash, walkBHash, scenarioArgs }) {
    const program = role2ProgramV3(categoryOnChain, walkAHash, walkBHash)
    const fx = { proof: normalizeProof(proof), publicInputs: publicSignals }
    const { walkA, walkB } = v3WalkScripts(categoryOnChain)
    const t = poolTransactionForV3(fx, program, scenarioArgs, [walkA, walkB])
    return {
        program,
        unlockings: t.unlockings,
        walkUnlockings: t.walkW,
        fills: t.fills,
        scenario: t.scenario,
        locking: t.locking,
    }
}
