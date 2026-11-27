// src/lib/pool/verifier-role2-v4h.js
//
// The v4h (the C architecture — the "no issuer" fix) role-2 verifier-step +
// walk-input generator. The MAINNET Preview v0 pool's client path.
//
// THE C ARCHITECTURE (the Hush pivot, 2026-11-27): the pool keeps its OWN
// fresh valueless category (state NFT + blanks — our key, no third party) and
// the ASSET — a category we do NOT own and can never mint (real ParyonUSD
// 2469acc5…) — rides a dedicated holdings input (5) / deposit slot (6) pair,
// both locked to the H covenant (the theft-guard shape pin: TXINPUTCOUNT==7,
// inputs 0/1/2 pinned by SHA256 == the program locking hash, 3/4 == the walk
// wrap hashes, 5/6 pinned to each other by byte-compare — H pins the program
// by hash, the program never pins H by hash: no circular hash).
//
// The state commitment grows to 96 B — [noteRoot ‖ nullSetRoot ‖ balance32] —
// the AUTHENTICATED balance chain: the hook reads the third field (check 5),
// recomputes newBal = bal + pv − 2·sign·pv, writes it into out1's third field
// (check 9), and pins out2 == newBal (check 9h) — an action that does not
// carry the full committed balance dies on consensus token conservation.
// out1 is NFT-only; out2 recreates the holdings at the H locking carrying
// exactly newBal of the ASSET; out3 (unshield only) pays pv in the ASSET's
// bare category.
//
// CHECK 6 BINDS THE ASSET (the Hush fix after our review caught the live bug):
// the actionHash preimage's category field is the ASSET display order in
// holdings mode — the circuit's category witness is the ASSET, so the hook's
// on-chain recompute must match (honest actions would have died at check 6
// under the pool category).
//
// The commit96 walks (282/295 B — one extra SPLIT each; the scripts ride the
// unlockings as the redeem push, v3.1 form; the graph ND pins hash the P2SH32
// wraps). The VK: the THREE-CONTRIBUTION mini-MPC chain (Nito → Hush → user;
// pool4_0003_user.zkey; the fixtures file our-v3-user3.fixtures.json sha256
// e74555dd… — vendored as VK_FIXTURES_V4H).
//
// The action shape: 7 inputs / 3-4 outputs. The H pair's unlockings are the
// bare redeem pushes (the H covenant is witness-free).

import { buildProgram, setCovenant, setWalkPinHashes, clearWalkPinHashes, setHoldingsMode, clearHoldingsMode } from './role2-3out/script.mjs'
import { covenantHook, covenantParams } from './role2-3out/pool-hook.mjs'
import { buildWalkScripts } from './role2-3out/walk-scripts.mjs'
import { buildHoldingsCovenant } from './role2-3out/holdings-covenant.mjs'
import { walkV3, walkWitnesses, poolTransactionForC } from './role2-3out/pool-tx-v3.mjs'
import { pushData } from './role2-3out/asm.mjs'
import { setVkFixtures, restoreVkFixtures, VK_FIXTURES_V4H } from './role2-3out/sound-si-gls/math.mjs'
import { normalizeProof } from './verifier.js'

/* The deployed MAINNET Preview v0 pool's category pair (the state file
   role2-pool4-state.mainnet-v4h.json — display byte order; on-chain order is
   the reverse). The pool's own fresh valueless category + the real ASSET. */
export const ROLE2_V4H_MAINNET_CATEGORY_DISPLAY =
    '324b1dbfb05c605937f7e68f62210102beacc8b0ece0537e5bde04e90a875814'
export const ROLE2_V4H_MAINNET_ASSET_DISPLAY =
    '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544'

/* The deployed mainnet walk wraps' pins — sha256 of the P2SH32 wraps (the
   commit96 walks: 282/295 B raw). */
export const ROLE2_V4H_MAINNET_WALK_A_HASH =
    '1255489f8168c4110094b0701617278133aa31f43ae4cb341f2f7bdb0f21a002'
export const ROLE2_V4H_MAINNET_WALK_B_HASH =
    'b476695026823fb3466d543ec61bf468fbe434a9c1c861233f3ca2ff09ad8312'

/* The deployed mainnet program's build record (the state file): code 8,078 B,
   sha256 4f096247…, pieces [4151, 3927], locking aa2006d764… */
export const ROLE2_V4H_MAINNET_CODE_SHA256 =
    '4f096247c5b56ab682119cb4446289598b48d374bb30d10e9ad43ee23dab4493'
export const ROLE2_V4H_MAINNET_LOCKING =
    'aa2006d764d4a149900fe8cbe2a0b01753643b21bda74b0fc76018172bfc098dc3c987'

/* The deployed H covenant (the state file): 211-B script, locking
   aa2006fa0f9e…2087 — rebuilt from (progLockingHashHex, walkAHash, walkBHash)
   and asserted against this. */
export const ROLE2_V4H_MAINNET_H_LOCKING =
    'aa2006fa0f9ebadd88eaac1b8801c69329c6c3e6d9209bced65ed01340a6e4e19b2087'

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const bytesOf = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)))

let _v4hCache = null

/**
 * The v4h (holdings-mode) program build — byte-exact reproduction gate.
 *
 * @param categoryOnChain       the pool's OWN category, on-chain byte order
 * @param assetCategoryOnChain the ASSET (real PUSD), on-chain byte order
 * @param walkAHash/walkBHash  the deployed walk wrap pins (sha256 hex)
 * @returns the built program { code, pieces, R, Kcode, locking, … }
 */
export function role2ProgramV4h(categoryOnChain, assetCategoryOnChain, walkAHash, walkBHash) {
    const key = categoryOnChain + '|' + assetCategoryOnChain + '|' + walkAHash + '|' + walkBHash
    if (_v4hCache && _v4hCache.key === key) return _v4hCache.program

    /* The walk pins + the holdings flag ride the MODULE-LEVEL setters — the
       browser-safe channel (Vite's per-chunk process.env; the v3 acceptance
       measured the env assignment never reaching the graph-pin read). */
    setWalkPinHashes([walkAHash, walkBHash])
    setHoldingsMode(true)
    /* The v4h program embeds the POST-MPC VK's curve data — the
       three-contribution fixtures (the mainnet pool's VK); the 3-out default
       is restored after (the 2-out/3-out/v3 builds keep reproducing their
       deployed programs byte-exactly). */
    setVkFixtures(VK_FIXTURES_V4H)
    setCovenant(covenantHook(
        covenantParams({ categoryOnChain, assetCategoryOnChain }),
        3,
        { walkAHash: bytesOf(walkAHash), walkBHash: bytesOf(walkBHash), holdings: {} },
    ))
    let program
    try {
        program = buildProgram()
    } finally {
        restoreVkFixtures()
        clearWalkPinHashes()
        clearHoldingsMode()
    }
    _v4hCache = { key, program }
    return program
}

/**
 * The commit96 walk scripts + P2SH32 wraps for a v4h pool.
 *
 * @param categoryOnChain the pool's OWN category, on-chain byte order
 * @returns { walkA, walkB, walkLockings, walkAHash, walkBHash, sizes }
 */
export function v4hWalkScripts(categoryOnChain) {
    const w = buildWalkScripts(categoryOnChain, { commit96: true })
    const { lockings, hashes } = walkV3(w.walkA, w.walkB)
    return {
        walkA: w.walkA,
        walkB: w.walkB,
        walkLockings: lockings,
        walkAHash: hexOf(hashes[0]),
        walkBHash: hexOf(hashes[1]),
        sizes: w.sizes,
    }
}

/**
 * The H covenant for a v4h pool — built AFTER the program (it embeds the
 * program locking hash + the walk wrap hashes); assert the rebuilt locking
 * against the registry's deployed record.
 *
 * @returns { script, lockingHex, lockingHashHex, redeemBytes }
 */
export function v4hHoldingsCovenant({ progLockingHashHex, walkAHashHex, walkBHashHex }) {
    return buildHoldingsCovenant({ progLockingHashHex, walkAHashHex, walkBHashHex })
}

/**
 * The H pair's UNLOCKINGS — the bare redeem push (the H covenant is
 * witness-free; both inputs 5/6 carry the identical push).
 *
 * @returns Uint8Array — pushData(H script)
 */
export function v4hHUnlocking({ progLockingHashHex, walkAHashHex, walkBHashHex }) {
    const h = v4hHoldingsCovenant({ progLockingHashHex, walkAHashHex, walkBHashHex })
    return Uint8Array.from(pushData(Uint8Array.from(h.script)))
}

/**
 * Produce the v4h action's SEVEN unlockings for a proved action.
 *
 * `poolTransactionForC` is the pool-aware fill sizer (inputs 0-2 sized
 * against the SEVEN-input pool shape; the walks + the H pair ride along at
 * fixed sizes) — the same convergence loop the v3 acceptance proved live.
 *
 * @param proof            the Groth16 proof ({ a, b, c } snarkjs field encodings)
 * @param publicSignals    the proof's public signals [merkleRoot, actionHash]
 * @param categoryOnChain  the pool's OWN category (chain order)
 * @param assetCategoryOnChain the ASSET (chain order)
 * @param walkAHash/walkBHash the deployed walk wrap pins
 * @param hScript          the H covenant script (Uint8Array — v4hHoldingsCovenant)
 * @param hLocking         the H covenant locking (Uint8Array)
 * @param scenarioArgs     { sc, n0, nullSet, balance, categoryDisplay,
 *                          assetCategoryDisplay } — `sc` carries the covenant
 *                          args, `nullSet` the walk data, `balance` the
 *                          committed holdings balance BEFORE the action
 * @returns { program, unlockings, walkUnlockings, scenario, fills, locking }
 */
export function produceRole2InputsV4h({ proof, publicSignals, categoryOnChain, assetCategoryOnChain, walkAHash, walkBHash, hScript, hLocking, scenarioArgs }) {
    const program = role2ProgramV4h(categoryOnChain, assetCategoryOnChain, walkAHash, walkBHash)
    const fx = { proof: normalizeProof(proof), publicInputs: publicSignals }
    const { walkA, walkB } = v4hWalkScripts(categoryOnChain)
    /* The transaction build runs proveCore internally (the Groth16 pairing
       check + the c/cInv derivation) — it MUST run under the v4h fixtures
       (the post-MPC VK): the proof was made under the pool4_0003_user zkey. */
    setVkFixtures(VK_FIXTURES_V4H)
    let t
    try {
        t = poolTransactionForC(fx, program, scenarioArgs, [walkA, walkB], hScript, hLocking)
    } finally {
        restoreVkFixtures()
    }
    return {
        program,
        unlockings: t.unlockings,
        walkUnlockings: t.walkW,
        scenario: t.scenario,
        fills: t.fills,
        locking: t.locking,
    }
}
