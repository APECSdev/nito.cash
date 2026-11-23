// apps/web/src/lib/pool/verifier-program-generalized.js
//
// The GENERALIZED wallet program — the wallet-committed bench-vector program
// (verifier-program.js WALLET_PROGRAM) with the input-INDEX layout corrected
// for a real action transaction. A fresh pool is deployed under THIS program so
// the wallet's own witness builder can spend it.
//
// Why this exists (the blocker this file removes):
//   · WALLET_PROGRAM is the program the wallet's produceWitness reproduces
//     byte-exactly (pool-verifier.spec's pinned ground-truth test), so the
//     wallet's witness generation is validated against it. But it carries the
//     bench FIXTURE layout: `OP_TXINPUTCOUNT == 5`, the verifier genesis read at
//     input 3 and the terminal read at input 4. A real action transaction
//     cannot satisfy that — the covenant is input 0, the three exec steps 1–3,
//     the genesis 4, the terminal 5, funding 6+. Deploying WALLET_PROGRAM as-is
//     produced the unspendable chipnet-pusd-v2 pool.
//   · The on-chain DEPLOYED_PROGRAM carries the corrected layout, but its
//     function-id numbering, fragment lengths and two 986-byte helper bodies
//     belong to a witness-generation revision whose source is not available.
//   · This module therefore takes WALLET_PROGRAM and applies ONLY the
//     input-index corrections. Every body, function id, fragment length and
//     32-byte constant stays the wallet's.
//
// The edit list below is derived from the scripts' semantics, not by copying
// bytes: an index correction is an integer push that IMMEDIATELY PRECEDES
// OP_INPUTBYTECODE / OP_UTXOBYTECODE / OP_TXINPUTCOUNT. Verified against the
// deployed program: applying these edits reproduces the deployed program's
// index references exactly (@110/@944/@952/@960/@1140/@1580/@1753, the
// @1559-1568 UTXOBYTECODE run, and the exec @33 genesis read), while every
// function-id push and fragment-length push is left as the wallet's.
//
//   exec0..2  @33   OP_3 -> OP_4      the genesis witness is input 4, not 3
//             @111  2-byte length     terminal redeem length + push overhead
//                                     (recomputed below, never hardcoded)
//   genesis   @1493 OP_0 -> OP_1      first exec step is input 1, not 0
//             @1716 OP_0 -> OP_1
//   terminal  @110  OP_3 -> OP_4      genesis witness input 4
//             @944  OP_0 -> OP_1
//             @952  OP_1 -> OP_2
//             @960  OP_2 -> OP_3
//             @1140 OP_3 -> OP_4
//             @1551 OP_EQUALVERIFY -> OP_GREATERTHANOREQUAL OP_VERIFY
//                                     (`OP_TXINPUTCOUNT >= 5`, not `== 5`)
//             @1559 @1562 @1565 @1568  OP_0..OP_3 -> OP_1..OP_4 (UTXOBYTECODE)
//             @1580 OP_3 -> OP_4
//             @1753 OP_3 -> OP_4
//
// pool-verifier-generalized.spec.js pins the result: the derived step lockings
// reproduce WALLET_STEP_LOCKINGS for WALLET_PROGRAM, and every generalized
// chunk has the same LENGTH as the corresponding deployed chunk.

import { decodeAuthenticationInstructions, encodeAuthenticationInstructions, hash256, hexToBin, binToHex } from '@bitauth/libauth'
import { WALLET_PROGRAM } from './verifier-program.js'

const OP_0 = 0x00
const OP_1 = 0x51
const OP_2 = 0x52
const OP_3 = 0x53
const OP_4 = 0x54
const OP_EQUALVERIFY = 0x88
const OP_GREATERTHANOREQUAL = 0xa2
const OP_VERIFY = 0x69

/* Replace one instruction with a single opcode. */
const op = (opcode) => ({ to: [opcode] })
/* Replace one instruction with an opcode sequence. */
const ops = (to) => ({ to })

/* The exec terminal-length slot: index 111 holds a 2-byte push of
   (terminal redeem length + 3 push-overhead bytes). Recomputed, not copied. */
const TERMINAL_LENGTH_SLOT = 111

const EXEC_EDITS = {
    33: op(OP_4),
    [TERMINAL_LENGTH_SLOT]: { terminalLength: true },
}

const GENESIS_EDITS = {
    1493: op(OP_1),
    1716: op(OP_1),
}

const TERMINAL_EDITS = {
    110: op(OP_4),
    944: op(OP_1),
    952: op(OP_2),
    960: op(OP_3),
    1140: op(OP_4),
    1551: ops([OP_GREATERTHANOREQUAL, OP_VERIFY]),
    1559: op(OP_1),
    1562: op(OP_2),
    1565: op(OP_3),
    1568: op(OP_4),
    1580: op(OP_4),
    1753: op(OP_4),
}

/* Apply an edit map to a decoded instruction list, keeping the original
   indices as the edit keys (insertions do not renumber later edits). */
function applyEdits(instructions, edits, terminalLength) {
    const out = []
    instructions.forEach((instruction, index) => {
        const edit = edits[index]
        if (!edit) {
            out.push(instruction)
            return
        }
        if (edit.terminalLength) {
            /* little-endian 2-byte push of (length + 3): the push itself costs
               3 bytes (0x4d <len> <len>) once the payload exceeds 255. */
            const value = terminalLength + 3
            out.push({ opcode: 0x02, data: Uint8Array.of(value & 0xff, (value >> 8) & 0xff) })
            return
        }
        for (const opcode of edit.to) out.push({ opcode })
    })
    return out
}

/* Build the terminal first: the exec redeems embed its length. */
const terminalInstructions = applyEdits(
    decodeAuthenticationInstructions(hexToBin(WALLET_PROGRAM.redeems[4])), TERMINAL_EDITS, 0)
const terminalHex = binToHex(encodeAuthenticationInstructions(terminalInstructions))
const terminalLength = terminalHex.length / 2

const genesisHex = binToHex(encodeAuthenticationInstructions(applyEdits(
    decodeAuthenticationInstructions(hexToBin(WALLET_PROGRAM.redeems[3])), GENESIS_EDITS, terminalLength)))

const execHexes = [0, 1, 2].map((index) => binToHex(encodeAuthenticationInstructions(applyEdits(
    decodeAuthenticationInstructions(hexToBin(WALLET_PROGRAM.redeems[index])), EXEC_EDITS, terminalLength))))

export const GENERALIZED_WALLET_REDEEMS = [...execHexes, genesisHex, terminalHex]

/* P2SH32-style step locking: OP_HASH256 <hash256(redeem)> OP_EQUAL.
   Self-checked against WALLET_STEP_LOCKINGS by the spec. */
export function deriveStepLockings(redeems) {
    return redeems.map((redeemHex) => 'aa20' + binToHex(hash256(hexToBin(redeemHex))) + '87')
}

export const GENERALIZED_WALLET_STEP_LOCKINGS = deriveStepLockings(GENERALIZED_WALLET_REDEEMS)

/* The fragments are the WALLET's — untouched by the layout patch, so the exec
   redeems' embedded hash256(fragment set) stays valid. */
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
