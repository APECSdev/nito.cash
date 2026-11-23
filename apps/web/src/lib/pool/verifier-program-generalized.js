// apps/web/src/lib/pool/verifier-program-generalized.js
//
// The GENERALIZED wallet program — the LAYOUT of the on-chain deployed program
// (verifier-program.js DEPLOYED_PROGRAM) carrying the BODIES of the
// wallet-committed bench vectors (WALLET_PROGRAM). A fresh pool must be
// deployed under THIS program for the wallet's own witness builder to spend it.
//
// Why this exists (the blocker this file removes):
//   · WALLET_PROGRAM is the program the wallet's produceWitness reproduces
//     byte-exactly (pool-verifier.spec's pinned ground-truth test), so the
//     wallet's witness generation is validated against it. But it carries the
//     bench FIXTURE layout: OP_TXINPUTCOUNT == 5, verifier genesis at input 3,
//     terminal at input 4. A real action transaction cannot satisfy that — the
//     covenant is input 0, the three exec steps 1–3, the genesis 4, the
//     terminal 5, funding 6+. Deploying WALLET_PROGRAM as-is produced the
//     unspendable chipnet-pusd-v2 pool.
//   · DEPLOYED_PROGRAM carries the GENERALIZED layout (>= 5 inputs, genesis 4,
//     terminal 5) but its two 986-byte helper bodies and its terminal constants
//     belong to a witness-generation revision whose source is not available.
//   · This module combines the two: LAYOUT from DEPLOYED, BODIES from WALLET.
//     The bodies are the ones the wallet's witness generation was validated
//     against, so the pair is self-consistent by construction.
//
// Construction is an instruction-level LCS diff (wallet vs deployed) in which
// every changed run is resolved to the DEPLOYED side EXCEPT runs that carry a
// body push (a 986-byte helper or any 32-byte constant), which keep the WALLET
// side. Verified, not assumed:
//   · deriveStepLockings(WALLET_PROGRAM.redeems) reproduces WALLET_STEP_LOCKINGS
//     byte-exactly (the locking derivation is therefore correct);
//   · every generalized chunk has the SAME LENGTH as the deployed chunk;
//   · the residual difference vs DEPLOYED_PROGRAM is exactly the body pushes —
//     exec0/1/2: one 32-byte push (the shared-fragment-set hash, which follows
//     the WALLET fragments this module keeps); genesis: the two 986-byte
//     helpers; terminal: three 32-byte constants.
//   pool-verifier-generalized.spec.js pins all three facts.

import { decodeAuthenticationInstructions, encodeAuthenticationInstructions, hash256, hexToBin, binToHex } from '@bitauth/libauth'
import { DEPLOYED_PROGRAM, WALLET_PROGRAM } from './verifier-program.js'

/* A "body" push: the inline helper bodies (986 B) and every 32-byte field
   constant. These belong to the witness-generation revision, so they always
   come from WALLET_PROGRAM. */
const isBodyPush = (instruction) => Boolean(instruction.data) && (instruction.data.length === 986 || instruction.data.length === 32)

const instructionKey = (instruction) => instruction.opcode + ':' + (instruction.data ? binToHex(instruction.data) : '')

/* Longest-common-subsequence diff over the decoded instruction stream. */
function diffInstructions(a, b) {
    const n = a.length
    const m = b.length
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
            dp[i][j] = instructionKey(a[i]) === instructionKey(b[j])
                ? dp[i + 1][j + 1] + 1
                : Math.max(dp[i + 1][j], dp[i][j + 1])
        }
    }
    const out = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
        if (instructionKey(a[i]) === instructionKey(b[j])) {
            out.push({ t: '=', a: a[i] })
            i += 1
            j += 1
        } else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ t: '-', a: a[i] })
            i += 1
        } else {
            out.push({ t: '+', b: b[j] })
            j += 1
        }
    }
    while (i < n) out.push({ t: '-', a: a[i++] })
    while (j < m) out.push({ t: '+', b: b[j++] })
    return out
}

/* Merge one chunk: deployed layout, wallet bodies. */
function generalizeChunk(walletHex, deployedHex) {
    const wallet = decodeAuthenticationInstructions(hexToBin(walletHex))
    const deployed = decodeAuthenticationInstructions(hexToBin(deployedHex))
    const merged = []
    let run = []
    const flush = () => {
        if (!run.length) return
        const bodyRun = run.some((entry) => isBodyPush(entry.a || entry.b))
        if (bodyRun) {
            /* keep the wallet side of the run (body pushes, and the instructions
               adjacent to them, which are identical anyway) */
            for (const entry of run) if (entry.t !== '+') merged.push(entry.a)
        } else {
            /* take the deployed side: every layout constant */
            for (const entry of run) if (entry.t !== '-') merged.push(entry.b)
        }
        run = []
    }
    for (const entry of diffInstructions(wallet, deployed)) {
        if (entry.t === '=') {
            flush()
            merged.push(entry.a)
        } else {
            run.push(entry)
        }
    }
    flush()
    return binToHex(encodeAuthenticationInstructions(merged))
}

const CHUNK_NAMES = ['exec0', 'exec1', 'exec2', 'genesis', 'terminal']

export const GENERALIZED_WALLET_REDEEMS = CHUNK_NAMES.map((name, index) =>
    generalizeChunk(WALLET_PROGRAM.redeems[index], DEPLOYED_PROGRAM.redeems[index]))

/* P2SH32-style step locking: OP_HASH256 <hash256(redeem)> OP_EQUAL.
   Self-checked against WALLET_STEP_LOCKINGS by the spec. */
export function deriveStepLockings(redeems) {
    return redeems.map((redeemHex) => 'aa20' + binToHex(hash256(hexToBin(redeemHex))) + '87')
}

export const GENERALIZED_WALLET_STEP_LOCKINGS = deriveStepLockings(GENERALIZED_WALLET_REDEEMS)

/* The fragments are the WALLET's — unchanged by the layout patch. The exec
   redeems embed hash256 of their concatenation, which therefore also stays. */
export const GENERALIZED_WALLET_SHARED_FRAGMENTS = WALLET_PROGRAM.sharedFragments

export const GENERALIZED_WALLET_PROGRAM = {
    redeems: GENERALIZED_WALLET_REDEEMS,
    sharedFragments: GENERALIZED_WALLET_SHARED_FRAGMENTS,
    quotientLengths: WALLET_PROGRAM.quotientLengths,
    quotientSuffixes: WALLET_PROGRAM.quotientSuffixes,
    stagePads: WALLET_PROGRAM.stagePads,
    genesisPad: WALLET_PROGRAM.genesisPad,
    msmSplit: WALLET_PROGRAM.msmSplit,
    msmCuts: WALLET_PROGRAM.msmCuts,
}
