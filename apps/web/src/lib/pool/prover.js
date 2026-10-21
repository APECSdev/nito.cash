// src/lib/pool/prover.js
//
// Client-side Groth16 prover for the PUSD shielded pool (Chipnet PoC).
//
// Assembles the circuit witness (`circuits/pool.circom` in pusd-shielded-pool)
// from wallet notes and runs `snarkjs.groth16.fullProve` against the proving
// assets (`public/proving/pool.wasm` witness calculator + `pool_final.zkey`
// proving key). Proof generation is heavy (~seconds for the 183,760-constraint
// circuit) and runs async.
//
// The witness assembly reuses the wallet's existing pool primitives
// (`./notes` commitments/nullifiers/actionHash + `./merkle` roots/paths), so the
// JS-computed public inputs match the circuit EXACTLY (verified byte-for-byte
// against the bench's committed transfer fixture, which verifies on-chain).
//
// PROVING ASSETS — NOT COMMITTED. The witness calculator (`pool.wasm`) and the
// proving key (`pool_final.zkey`) that match the DEPLOYED verifying key
// (`public/proving/verification_key.json`, PPOT-derived) are gitignored in
// pusd-shielded-pool and regenerate only on the build box (bch-infra); the
// repo's committed `artifacts/` copies are a documented-STALE pre-PPOT snapshot
// that does NOT match the live vkey. Copy the live `build/pool_js/pool.wasm` +
// `build/pool_final.zkey` into `public/proving/` to enable proof generation.
// (`verification_key.json` IS committed here — it lets the wallet VERIFY proofs
// and is the live on-chain key.)

import * as snarkjs from 'snarkjs'

import { noteCommitment, nullifier, actionHash } from './notes'
import { computeRoot, merklePath } from './merkle'

/* Proving assets (served as static files, fetched on demand by snarkjs). */
export const PROVING_WASM = 'proving/pool.wasm'
export const PROVING_ZKEY = 'proving/pool_final.zkey'
export const VERIFYING_KEY = 'proving/verification_key.json'

const S = (x) => BigInt(x).toString(10)

/**
 * Build the circuit witness for a 2-in / 2-out pool action.
 *
 *   inNotes  — [{ note: {value, ownerPub, rho, r}, nk, index }]  (exactly 2;
 *               `index` is the note's leaf position in `leaves`)
 *   outNotes — [{ value, ownerPub, rho, r }]                     (exactly 2)
 *   leaves   — the current note-commitment leaves (membership paths + merkleRoot
 *               are computed against THIS list, before the outputs are appended)
 *   publicValueAbs / publicValueSign / assetCategory — the action's public value
 *               (sign 0 = shield/deposit, 1 = unshield/withdrawal). `assetCategory`
 *               is passed as a single field element, matching the DEPLOYED circuit
 *               (build/verification_key.json). NOTE: the repo's current pool.circom
 *               (Oct 20) generalizes this to assetCategoryHi/Lo limbs for arbitrary
 *               256-bit categories — a not-yet-deployed circuit; if the pool is
 *               re-deployed with it, this witness must emit Hi/Lo instead (see
 *               pusd-shielded-pool GENERALIZED-SHIELDING.md).
 *
 * Value conservation (enforced in-circuit):
 *   inValue0 + inValue1 + (sign ? -publicValueAbs : +publicValueAbs)
 *     === outValue0 + outValue1
 *
 * Returns the snarkjs input object (every signal as a decimal string).
 */
export async function buildPoolWitness({
    inNotes, outNotes, leaves, publicValueAbs, publicValueSign, assetCategory,
}) {
    /* Input commitments, nullifiers, and membership paths. */
    const nf = []
    const paths = []

    for (let i = 0; i < 2; i++) {
        const { note, nk, index } = inNotes[i]

        nf.push(await nullifier(nk, note.rho))
        paths.push(await merklePath(leaves, index))
    }

    /* Output commitments. */
    const cm = []

    for (let j = 0; j < 2; j++) {
        const o = outNotes[j]

        cm.push(await noteCommitment(o.value, o.ownerPub, o.rho, o.r))
    }

    /* Tree roots before / after appending the two output commitments. */
    const merkleRoot = await computeRoot(leaves)
    const newMerkleRoot = await computeRoot([ ...leaves, ...cm ])

    /* The second public input (SHA256-bound; see notes.js actionHash). */
    const aHash = actionHash({
        nf0: nf[0], nf1: nf[1], cm0: cm[0], cm1: cm[1],
        publicValueAbs, publicValueSign, assetCategory, newMerkleRoot,
    })

    return {
        merkleRoot: S(merkleRoot),
        actionHash: S(aHash),
        nf: [ S(nf[0]), S(nf[1]) ],
        cm: [ S(cm[0]), S(cm[1]) ],
        publicValueAbs: S(publicValueAbs),
        publicValueSign: S(publicValueSign),
        assetCategory: S(assetCategory),
        newMerkleRoot: S(newMerkleRoot),
        inValue: [ S(inNotes[0].note.value), S(inNotes[1].note.value) ],
        inOwnerPub: [ S(inNotes[0].note.ownerPub), S(inNotes[1].note.ownerPub) ],
        inRho: [ S(inNotes[0].note.rho), S(inNotes[1].note.rho) ],
        inR: [ S(inNotes[0].note.r), S(inNotes[1].note.r) ],
        nk: [ S(inNotes[0].nk), S(inNotes[1].nk) ],
        inPathElements: [ paths[0].pathElements.map(S), paths[1].pathElements.map(S) ],
        inPathBits: [ paths[0].pathBits.map(S), paths[1].pathBits.map(S) ],
        outValue: [ S(outNotes[0].value), S(outNotes[1].value) ],
        outOwnerPub: [ S(outNotes[0].ownerPub), S(outNotes[1].ownerPub) ],
        outRho: [ S(outNotes[0].rho), S(outNotes[1].rho) ],
        outR: [ S(outNotes[0].r), S(outNotes[1].r) ],
    }
}

/**
 * Generate a Groth16 proof for an assembled witness.
 * Returns { proof, publicSignals } with publicSignals = [merkleRoot, actionHash].
 */
export async function generateProof(input, wasmUrl = PROVING_WASM, zkeyUrl = PROVING_ZKEY) {
    return snarkjs.groth16.fullProve(input, wasmUrl, zkeyUrl)
}

/* Verify a proof against the verifying key (sanity check / tests). */
export async function verifyProof(vkey, proof, publicSignals) {
    return snarkjs.groth16.verify(vkey, publicSignals, proof)
}
