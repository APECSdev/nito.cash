// src/lib/pool/merkle.js
//
// Append-only Poseidon Merkle tree (depth 20) for the PUSD shielded pool,
// matching `MerkleProof(TREE_DEPTH)` in circuits/note.circom:
//   pathBits 0 => the running hash is the LEFT  child: cur = Poseidon(cur, sib)
//   pathBits 1 => the running hash is the RIGHT child: cur = Poseidon(sib, cur)
// Empty subtrees use the standard zero hashes (zero[0] = 0,
// zero[i+1] = Poseidon(zero[i], zero[i])). PoC-scale: the root and paths are
// recomputed from the leaf list on demand (fine for chipnet note counts).

import { TREE_DEPTH, poseidonHash } from './notes'

/* Zero hash per level (index 0 = empty leaf). */
export async function zeroHashes(depth = TREE_DEPTH) {
    const zeros = [0n]

    for (let i = 1; i <= depth; i++) {
        zeros[i] = await poseidonHash([zeros[i - 1], zeros[i - 1]])
    }

    return zeros
}

/* Tree root for a leaf list (leaves beyond the list are zero). */
export async function computeRoot(leaves, depth = TREE_DEPTH) {
    const zeros = await zeroHashes(depth)

    let level = leaves.slice()

    for (let d = 0; d < depth; d++) {
        /* An empty subtree at this level is the level's zero hash. */
        if (level.length === 0) {
            level = [zeros[d]]
        }

        const next = []

        for (let i = 0; i < level.length; i += 2) {
            const left = level[i]
            const right = (i + 1 < level.length) ? level[i + 1] : zeros[d]

            next.push(await poseidonHash([left, right]))
        }

        level = next
    }

    return level[0]
}

/*
 * Merkle path for the leaf at `index`: { pathElements, pathBits } in the
 * exact shape the circuit witnesses expect.
 */
export async function merklePath(leaves, index, depth = TREE_DEPTH) {
    const zeros = await zeroHashes(depth)

    const pathElements = []
    const pathBits = []

    let level = leaves.slice()
    let idx = index

    for (let d = 0; d < depth; d++) {
        const isRight = idx % 2 === 1
        const sibIdx = isRight ? idx - 1 : idx + 1

        pathBits.push(isRight ? 1 : 0)
        pathElements.push(sibIdx < level.length ? level[sibIdx] : zeros[d])

        const next = []

        for (let i = 0; i < level.length; i += 2) {
            const left = level[i]
            const right = (i + 1 < level.length) ? level[i + 1] : zeros[d]

            next.push(await poseidonHash([left, right]))
        }

        level = (next.length > 0) ? next : [zeros[d]]
        idx = Math.floor(idx / 2)
    }

    return { pathElements, pathBits }
}

/* Verify a path against a root (mirrors the circuit's fold). */
export async function verifyPath(leaf, pathElements, pathBits, root) {
    let cur = BigInt(leaf)

    for (let d = 0; d < pathElements.length; d++) {
        cur = pathBits[d] === 1
            ? await poseidonHash([pathElements[d], cur])
            : await poseidonHash([cur, pathElements[d]])
    }

    return cur === BigInt(root)
}
