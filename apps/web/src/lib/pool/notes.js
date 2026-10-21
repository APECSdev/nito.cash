// src/lib/pool/notes.js
//
// Wallet-side note cryptography for the PUSD shielded pool (Chipnet PoC).
// Mirrors `circuits/note.circom` in the pusd-shielded-pool repo EXACTLY:
//   commitment = Poseidon(value, ownerPub, rho, r)
//   nullifier  = Poseidon(nk, rho)
// All arithmetic is in the BN254 scalar field. circomlibjs `buildPoseidon`
// runs the actual circomlib poseidon circuit compiled to wasm, so JS and
// circuit hashes agree 1:1.

import { sha256 } from '@bitauth/libauth'
import { buildBabyjub, buildPoseidon } from 'circomlibjs'

/* BN254 scalar-field prime (poseidon field). */
export const FR_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

/* Merkle tree depth (matches `Pool(20, 64)` in circuits/pool.circom). */
export const TREE_DEPTH = 20

/* Lazy singletons — the curve/wasm init is async and non-trivial. */
let _poseidon = null
let _babyjub = null

export async function getPoseidon() {
    if (!_poseidon) {
        _poseidon = await buildPoseidon()
    }

    return _poseidon
}

export async function getBabyjub() {
    if (!_babyjub) {
        _babyjub = await buildBabyjub()
    }

    return _babyjub
}

/* Poseidon hash over field elements; returns a BigInt < FR_PRIME. */
export async function poseidonHash(inputs) {
    const p = await getPoseidon()

    return BigInt(p.F.toString(p(inputs.map((x) => BigInt(x)))))
}

/* Note commitment — Poseidon(value, ownerPub, rho, r) (circuits/note.circom). */
export async function noteCommitment(value, ownerPub, rho, r) {
    return poseidonHash([value, ownerPub, rho, r])
}

/* Nullifier — Poseidon(nk, rho) (circuits/note.circom). */
export async function nullifier(nk, rho) {
    return poseidonHash([nk, rho])
}

/* Uniform random field element from 31 bytes (248 bits < p, no reduction). */
export function randomField() {
    const bytes = new Uint8Array(31)

    crypto.getRandomValues(bytes)

    return bytes.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
}

/*
 * Derive the pool spending key from wallet entropy (PoC derivation).
 *   sk = sha256('nito-pool/v1/sk' || accountLE32 || entropy) mod Fr
 * Domain-separated and deterministic so notes are recoverable from the
 * wallet seed alone. (PoC: a single key serves as both owner key and
 * nullifier key `nk`; see circuits/pool.circom "authorization".)
 */
export function deriveSpendKey(entropy, account = 0) {
    const domain = new TextEncoder().encode('nito-pool/v1/sk')

    const accountLE = new Uint8Array(4)
    new DataView(accountLE.buffer).setUint32(0, account, true)

    const preimage = new Uint8Array(domain.length + 4 + entropy.length)
    preimage.set(domain, 0)
    preimage.set(accountLE, domain.length)
    preimage.set(entropy, domain.length + 4)

    const digest = sha256.hash(preimage)
    const scalar = digest.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)

    return scalar % FR_PRIME
}

/*
 * Owner public key for a spend key: the x-coordinate of the BabyJubJub
 * public key A = sk · Base8 (circuits expect `ownerPub` as a field element).
 */
export async function deriveOwnerPub(spendKey) {
    const bb = await getBabyjub()

    const A = bb.mulPointEscalar(bb.Base8, BigInt(spendKey))

    return BigInt(bb.F.toString(A[0]))
}

/*
 * actionHash (Option F) — the pool's second public input, computed exactly
 * as circuits/pool.circom constrains it:
 *   SHA256 over 8 fields x 32-byte BIG-ENDIAN
 *   (nf0, nf1, cm0, cm1, publicValueAbs, publicValueSign, assetCategory, newMerkleRoot),
 *   then the top 3 bits of the BE digest are cleared (253-bit truncation, so
 *   the result is ALWAYS < the BN254 scalar-field prime — no modular reduction).
 * Returns the field element (BigInt); the covenant compares against its LE
 * VM-number byte form (covenant side, see pusd-shielded-pool COVENANT-DESIGN.md §7).
 */
export function actionHash({
    nf0, nf1, cm0, cm1,
    publicValueAbs, publicValueSign, assetCategory, newMerkleRoot,
}) {
    const fields = [
        nf0, nf1, cm0, cm1,
        publicValueAbs, publicValueSign, assetCategory, newMerkleRoot,
    ]

    const preimage = new Uint8Array(8 * 32)

    fields.forEach((f, i) => {
        const hex = BigInt(f).toString(16).padStart(64, '0')

        for (let b = 0; b < 32; b++) {
            preimage[i * 32 + b] = parseInt(hex.slice(b * 2, b * 2 + 2), 16)
        }
    })

    const digest = sha256.hash(preimage)

    /* Clear the top 3 bits (BE) — the 253-bit truncation. */
    digest[0] &= 0x1f

    return digest.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
}
