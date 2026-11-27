// src/lib/pool/smt.js
//
// The hook-level NULLIFIER SPARSE MERKLE TREE — the Nito client port of the
// Hush reference mirror (`pusd-shielded-pool/role2-op-witness-v3.mjs`
// makeSmt), byte-exact against their committed v3 fixtures
// (`tests/fixtures/pool/v3/our-v3-proofs.json` — 5 proofs, each carrying its
// per-action SMT walk data; the oracle spec reproduces all of them).
//
// WHAT THIS IS (the v3 pool's R2 fix, script-side):
//   - a SHA256 sparse Merkle tree of DEPTH 254 over 32-byte LE nullifier
//     slices (the SMT "keys" — `le32(nf)`); the spent leaf is a fixed 32-byte
//     MARKER (01 00…00), NOT a 1-byte push — the Hush's VM landmine record
//     (BIN2NUM of bare [0x80]-style single bytes) is why the leaf is padded;
//   - the state NFT's commitment is `noteRoot ‖ nullSetRoot` (64 B): the
//     second half is THIS tree's root (v3 changed its meaning from the old
//     nullifierFold);
//   - per action the wallet produces `sibsA` (254×32 B) + walks nf0 from the
//     stored root (empty leaf → the OLD root; MARKER → midRoot), then `sibsB`
//     + walks nf1 from midRoot (→ finalNullRoot) — the two nullifier-data
//     inputs (in3/in4) of the v3 5-input action carry exactly this data at
//     the FIXED deployed walkA/walkB lockings (witness-supplied at spend
//     time; self-validating against the state).
//
// The empty-set root is the SHA256 zero ladder at depth 254 — the v3 genesis
// nullSetRoot (the genesis tree is EMPTY: no bootstrap seeds, no seed-pair
// tags; onboarding is the DEPOSIT path).
//
// Byte-order care (the repo rule): the KEYS are the carrier's 32-byte
// LITTLE-ENDIAN nullifier forms. All hashing is plain SHA256(left ‖ right)
// over raw byte strings.

import { binToHex, hexToBin, sha256 } from '@bitauth/libauth'

/* The SMT depth (the Hush spike's measured D=254). */
export const NULLIFIER_SMT_DEPTH = 254

/* SHA256(left ‖ right) over raw bytes. */
const hashConcat = (left, right) => {
    const pre = new Uint8Array(left.length + right.length)
    pre.set(left, 0)
    pre.set(right, left.length)

    return sha256.hash(pre)
}

/* The zero ladder: szh[0] = 32 zero bytes; szh[i] = SHA256(szh[i-1] ‖ szh[i-1]). */
export const SMT_ZERO_LADDER = (() => {
    const ladder = [new Uint8Array(32)]

    for (let i = 1; i <= NULLIFIER_SMT_DEPTH; i += 1) {
        ladder.push(hashConcat(ladder[i - 1], ladder[i - 1]))
    }

    return ladder
})()

/* The EMPTY-set root (the v3 genesis nullSetRoot). */
export const EMPTY_NULL_SET_ROOT = SMT_ZERO_LADDER[NULLIFIER_SMT_DEPTH]

/* The spent leaf: 0x01 followed by 31 zero bytes (the padded MARKER — a bare
   1-byte leaf would hit the BIN2NUM-of-[0x80] VM landmine on the walk). */
export const SMT_MARKER_LEAF = (() => {
    const marker = new Uint8Array(32)
    marker[0] = 1
    return marker
})()

/* The EMPTY leaf (an unspent slot folds from 32 zero bytes). */
export const SMT_EMPTY_LEAF = new Uint8Array(32)

/* Bit i of a 32-byte key (LSB-first byte order — the walk consumes bit 0 first). */
const bitOf = (key, i) => (key[i >> 3] >> (i & 7)) & 1

const bytesEqual = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i])

/**
 * Build the nullifier SMT over `keyHexes` — the spent 32-B LE nullifier
 * slices as hex strings (the exact form the state file + op records carry).
 *
 * Returns:
 *   rootOf()            — the SMT root over the current key set
 *   siblingsFor(key)    — the 254 off-path sibling nodes for a key
 *   walk(leaf, key, sibs) — the dual-walk fold: the root the tree WOULD have
 *                         if `key`'s slot held `leaf` (the spend-time walk:
 *                         EMPTY leaf → the stored root; MARKER → the root
 *                         after inserting the key)
 *   keys                — the parsed key set (32-B Uint8Arrays)
 */
export function makeNullifierSmt(keyHexes) {
    const keys = keyHexes.map((hex) => hexToBin(hex))
    const memo = new Map()

    /* subtree(mk, h): the SMT node at height h covering keys that agree with
       mk on bits h..DEPTH-1 — empty → the zero ladder; h === 0 → the leaf
       (MARKER — a key exists at this address); else SHA256(left ‖ right).
       The memo key is the mask's hex + height (the reference's convention). */
    function subtree(mask, height) {
        const id = binToHex(mask) + '|' + height

        if (memo.has(id)) return memo.get(id)

        let any = false
        for (const key of keys) {
            let agree = true
            for (let b = height; b < NULLIFIER_SMT_DEPTH; b += 1) {
                if (bitOf(key, b) !== bitOf(mask, b)) { agree = false; break }
            }
            if (agree) { any = true; break }
        }

        let node
        if (!any) {
            node = SMT_ZERO_LADDER[height]
        } else if (height === 0) {
            node = SMT_MARKER_LEAF
        } else {
            const bitIndex = height - 1
            const byteIndex = bitIndex >> 3
            const bitValue = 1 << (bitIndex & 7)

            const mask0 = new Uint8Array(mask)
            mask0[byteIndex] &= ~bitValue & 0xff
            const mask1 = new Uint8Array(mask)
            mask1[byteIndex] |= bitValue

            node = hashConcat(subtree(mask0, height - 1), subtree(mask1, height - 1))
        }

        memo.set(id, node)
        return node
    }

    const rootOf = () => subtree(new Uint8Array(32), NULLIFIER_SMT_DEPTH)

    /* The off-path siblings: at height i flip key bit i, then the subtree at
       that address (keys agreeing with the flipped key on bits i+1..). */
    function siblingsFor(key) {
        const siblings = []

        for (let i = 0; i < NULLIFIER_SMT_DEPTH; i += 1) {
            const mask = new Uint8Array(key)
            mask[i >> 3] ^= 1 << (i & 7)
            siblings.push(subtree(mask, i))
        }

        return siblings
    }

    /* The dual walk: fold the (possibly hypothetical) leaf up the sibling
       path — bit i of the key picks the left/right ordering. */
    function walk(leaf, key, siblings) {
        let current = leaf

        for (let i = 0; i < NULLIFIER_SMT_DEPTH; i += 1) {
            const bit = bitOf(key, i)
            current = hashConcat(bit ? siblings[i] : current, bit ? current : siblings[i])
        }

        return current
    }

    return { rootOf, siblingsFor, walk, keys }
}

/**
 * The per-action SMT walk data (the v3 action builder's contract — the exact
 * record the Hush reference emits as op.nullSet and the fixtures carry):
 *
 *   spentKeys — the nullifier keys already in the set (hex)
 *   kA / kB   — THIS action's two nullifier keys (32-B LE hex)
 *
 * Verifies + returns { sibsA, midRoot, sibsB, finalNullRoot, nullSetRootBefore }:
 *   sibsA — 254 siblings for kA against the set BEFORE this action
 *   midRoot — the root after inserting kA (walkA's pinned result)
 *   sibsB — 254 siblings for kB against the set after kA
 *   finalNullRoot — the root after both (walkB's pinned result; the new
 *                   state NFT's nullSetRoot half)
 *
 * THROWS when a key is already spent (the walk would not fold to the stored
 * root — the replay guard the client enforces BEFORE burning fuel).
 */
export function nullifierWalkData({ spentKeys, kA, kB }) {
    const before = makeNullifierSmt(spentKeys)
    const nullSetRootBefore = before.rootOf()

    const sibsA = before.siblingsFor(hexToBin(kA))
    const walkEmptyA = before.walk(SMT_EMPTY_LEAF, hexToBin(kA), sibsA)

    if (!bytesEqual(walkEmptyA, nullSetRootBefore)) {
        throw new Error(`pool smt: walk A does not fold to the stored nullSetRoot — the key is already spent (replay): ${kA}`)
    }

    const midRoot = before.walk(SMT_MARKER_LEAF, hexToBin(kA), sibsA)
    const afterA = makeNullifierSmt([...spentKeys, kA])

    if (!bytesEqual(afterA.rootOf(), midRoot)) {
        throw new Error('pool smt: midRoot mismatch (walk vs tree)')
    }

    const sibsB = afterA.siblingsFor(hexToBin(kB))
    const walkEmptyB = afterA.walk(SMT_EMPTY_LEAF, hexToBin(kB), sibsB)

    if (!bytesEqual(walkEmptyB, midRoot)) {
        throw new Error(`pool smt: walk B does not fold to midRoot — the key is already spent (replay): ${kB}`)
    }

    const finalNullRoot = afterA.walk(SMT_MARKER_LEAF, hexToBin(kB), sibsB)
    const afterB = makeNullifierSmt([...spentKeys, kA, kB])

    if (!bytesEqual(afterB.rootOf(), finalNullRoot)) {
        throw new Error('pool smt: finalNullRoot mismatch (walk vs tree)')
    }

    return {
        sibsA: sibsA.map((sib) => binToHex(sib)),
        midRoot: binToHex(midRoot),
        sibsB: sibsB.map((sib) => binToHex(sib)),
        finalNullRoot: binToHex(finalNullRoot),
        nullSetRootBefore: binToHex(nullSetRootBefore),
    }
}
