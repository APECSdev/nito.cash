// tests/unit/lib/pool-witness-v3.spec.js
//
// The v3 (pool4) witness builder gate: the deposit path (phantom in-notes,
// the EMPTY genesis tree), the append witness (appendIndex + the three
// frontier sibling paths with the dense-shape + old-walk folds — R3 closed
// at the JS layer exactly as the generator enforces it), the R2 pre-check
// (nf0 == nf1 refused BEFORE fuel burns), conservation, and the EXACT
// witness-input field shape of role2-op-witness-v3.mjs (the frozen M4
// contract — the circuit's expected signal names).
//
// The full wtns constraint check (247,120 c) runs on the VM at the
// acceptance; CI asserts the JS-layer contract.

import { describe, expect, it } from 'vitest'

import { buildPoolWitnessV3 } from '@/lib/pool/prover'
import { noteCommitment, nullifier, randomField, deriveOwnerPub, TREE_DEPTH } from '@/lib/pool/notes'
import { computeRoot, zeroHashes } from '@/lib/pool/merkle'
import { actionHash3out } from '@/lib/pool/notes'

const CAT = 0xe56c0a8583e36092f20e54c9247f6b8e5a6afd391027aa70ae109c3c42377930n
const S = (v) => String(BigInt(v))

/* fresh note secrets + a committed leaf */
async function makeLeaf() {
    const nk = randomField()
    const ownerPub = await deriveOwnerPub(nk)
    const rho = randomField()
    const r = randomField()
    const value = randomField() % 1000n
    return { note: { value, ownerPub, rho, r }, nk, cm: await noteCommitment(value, ownerPub, rho, r) }
}

async function makeOutNotes(values) {
    const out = []
    for (const v of values) {
        const ownerPub = await deriveOwnerPub(randomField())
        out.push({ value: v, ownerPub, rho: randomField(), r: randomField() })
    }
    return out
}

describe('lib/pool/prover — buildPoolWitnessV3 (the v3 pool4 witness)', () => {
    it('DEPOSIT on the EMPTY genesis tree: phantom in-notes, appendIndex 0, the zero-ladder siblings, conservation', async () => {
        const outNotes = await makeOutNotes([400n, 300n, 300n])
        const { input, cm, newMerkleRoot, appendIndex, nf } = await buildPoolWitnessV3({
            inNotes: null, outNotes, leaves: [], publicValueAbs: 1000n, publicValueSign: 0n,
            assetCategory: CAT, isDeposit: true,
        })

        expect(input.isDeposit).toBe('1')
        expect(input.appendIndex).toBe('0')
        expect(BigInt(input.merkleRoot)).toBe((await zeroHashes())[TREE_DEPTH])
        /* the EMPTY-tree frontier siblings, exactly as the dense append walks
           them: slot 0 = the pure zero ladder; slot 1's level-0 sibling = cm0
           (appended by the first insert); slot 2's level-1 sibling = H(cm0,cm1)
           (zeroHashes returns depth+1 entries — the paths are 20) */
        const zeros = await zeroHashes()
        const pureZeroLadder = zeros.slice(0, TREE_DEPTH).map(S)
        expect(input.appendSiblings).toHaveLength(3)
        expect(input.appendSiblings[0]).toEqual(pureZeroLadder)
        expect(input.appendSiblings[1]).toEqual([S(cm[0]), ...zeros.slice(1, TREE_DEPTH).map(S)])
        const { poseidonHash } = await import('@/lib/pool/notes')
        expect(input.appendSiblings[2]).toEqual([S(0n), S(await poseidonHash([cm[0], cm[1]])), ...zeros.slice(2, TREE_DEPTH).map(S)])
        /* phantom in-notes: value 0, zeroed paths (boolean-safe) */
        expect(input.inValue).toEqual(['0', '0'])
        expect(input.inPathBits[0].every((b) => b === '0')).toBe(true)
        /* conservation: 0 in + 1,000 deposited === 400+300+300 out */
        expect(newMerkleRoot).toBe(await computeRoot(cm))
        expect(appendIndex).toBe(0)
        expect(nf).toHaveLength(2)
        expect(nf[0]).not.toBe(nf[1])
    })

    it('TRANSFER on a 5-leaf tree: real paths, appendIndex 5, the folds, the 9-field actionHash', async () => {
        const l0 = await makeLeaf()
        const l1 = await makeLeaf()
        const filler = [await makeLeaf(), await makeLeaf(), await makeLeaf()]
        const leaves = [l0.cm, l1.cm, ...filler.map((f) => f.cm)]
        const inSum = l0.note.value + l1.note.value
        const split = [inSum * 2n / 5n, inSum * 3n / 10n]
        const outNotes = await makeOutNotes([split[0], split[1], inSum - split[0] - split[1]])

        const { input, cm, newMerkleRoot, appendIndex, nf } = await buildPoolWitnessV3({
            inNotes: [{ note: l0.note, nk: l0.nk, index: 0 }, { note: l1.note, nk: l1.nk, index: 1 }],
            outNotes, leaves, publicValueAbs: 0n, publicValueSign: 0n, assetCategory: CAT,
        })

        expect(input.isDeposit).toBe('0')
        expect(input.appendIndex).toBe('5')
        expect(BigInt(input.merkleRoot)).toBe(await computeRoot(leaves))
        expect(newMerkleRoot).toBe(await computeRoot([...leaves, ...cm]))
        /* the in-note nullifiers bind nk ‖ rho */
        expect(nf[0]).toBe(await nullifier(l0.nk, l0.note.rho))
        expect(nf[1]).toBe(await nullifier(l1.nk, l1.note.rho))
        /* the 9-field actionHash (unchanged from the 3-out contract) */
        expect(BigInt(input.actionHash)).toBe(actionHash3out({
            nf0: nf[0], nf1: nf[1], cm0: cm[0], cm1: cm[1], cm2: cm[2],
            publicValueAbs: 0n, publicValueSign: 0n, assetCategory: CAT, newMerkleRoot,
        }))
    })

    it('R2 client-side: nf0 == nf1 (the same in-note twice) is REFUSED before fuel burns', async () => {
        const l = await makeLeaf()
        const outNotes = await makeOutNotes([l.note.value, 0n, 0n])
        await expect(buildPoolWitnessV3({
            inNotes: [{ note: l.note, nk: l.nk, index: 0 }, { note: l.note, nk: l.nk, index: 1 }],
            outNotes, leaves: [l.cm], publicValueAbs: 0n, publicValueSign: 0n, assetCategory: CAT,
        })).rejects.toThrow('nf0 == nf1')
    })

    it('conservation is enforced (an underfunded unshield throws)', async () => {
        const l = await makeLeaf()
        const outNotes = await makeOutNotes([l.note.value + 1n, 0n, 0n])
        await expect(buildPoolWitnessV3({
            inNotes: [{ note: l.note, nk: l.nk, index: 0 }, { note: (await makeLeaf()).note, nk: (await makeLeaf()).nk, index: 1 }],
            outNotes, leaves: [l.cm], publicValueAbs: 0n, publicValueSign: 0n, assetCategory: CAT,
        })).rejects.toThrow('conservation violated')
    })

    it('the witness input carries the EXACT field shape of the frozen generator contract', async () => {
        const outNotes = await makeOutNotes([100n, 0n, 0n])
        const { input } = await buildPoolWitnessV3({
            inNotes: null, outNotes, leaves: [], publicValueAbs: 100n, publicValueSign: 0n,
            assetCategory: CAT, isDeposit: true,
        })

        /* role2-op-witness-v3.mjs's `input` object, key for key (the circuit's
           signal names — frozen by the M4 contract; the MPC changes no shape) */
        expect(Object.keys(input).sort()).toEqual([
            'actionHash', 'appendIndex', 'appendSiblings', 'assetCategoryHi', 'assetCategoryLo',
            'cm', 'inOwnerPub', 'inPathBits', 'inPathElements', 'inR', 'inRho', 'inValue',
            'isDeposit', 'merkleRoot', 'newMerkleRoot', 'nk', 'nf', 'outOwnerPub', 'outR',
            'outRho', 'outValue', 'publicValueAbs', 'publicValueSign',
        ].sort())
        expect(input.appendSiblings).toHaveLength(3)
        expect(input.appendSiblings[0]).toHaveLength(TREE_DEPTH)
        expect(input.inPathElements[0]).toHaveLength(TREE_DEPTH)
    })
})
