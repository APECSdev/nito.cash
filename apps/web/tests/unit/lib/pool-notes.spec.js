/* Import libraries. */
import { beforeAll, describe, expect, it } from 'vitest'

/* Import pool lib. */
import {
    FR_PRIME,
    TREE_DEPTH,
    actionHash,
    deriveOwnerPub,
    deriveSpendKey,
    noteCommitment,
    nullifier,
    poseidonHash,
    randomField,
} from '@/lib/pool/notes'
import { computeRoot, merklePath, verifyPath, zeroHashes } from '@/lib/pool/merkle'
import { getBabyjub, getPoseidon } from '@/lib/pool/notes'

describe('pool notes (circomlib parity)', () => {
    /* Warm up the wasm/curve singletons once (the init is slow under
       full-suite CPU contention and would otherwise blow the 5s per-test
       timeout on the first poseidon call). */
    beforeAll(async () => {
        await getPoseidon()
        await getBabyjub()
    }, 60000)

    it('poseidon matches the canonical circomlib vector', async () => {
        /* poseidon([1,2,3,4]) — well-known circomlib test vector. */
        const h = await poseidonHash([1n, 2n, 3n, 4n])

        expect(h).toEqual(18821383157269793795438455681495246036402687001665670618754263018637548127333n)
    })

    it('note commitment is deterministic and rho-sensitive', async () => {
        const cm1 = await noteCommitment(1000n, 42n, 7n, 9n)
        const cm2 = await noteCommitment(1000n, 42n, 7n, 9n)
        const cm3 = await noteCommitment(1000n, 42n, 8n, 9n)

        expect(cm1).toEqual(cm2)
        expect(cm1).not.toEqual(cm3)
        expect(cm1 < FR_PRIME).toBe(true)
    })

    it('nullifier is deterministic and distinct from the commitment', async () => {
        const cm = await noteCommitment(1000n, 42n, 7n, 9n)
        const nf1 = await nullifier(42n, 7n)
        const nf2 = await nullifier(42n, 7n)

        expect(nf1).toEqual(nf2)
        expect(nf1).not.toEqual(cm)
        expect(nf1 < FR_PRIME).toBe(true)
    })

    it('randomField stays in range and differs across calls', () => {
        const a = randomField()
        const b = randomField()

        expect(a < FR_PRIME).toBe(true)
        expect(a).not.toEqual(b)
    })

    it('derives deterministic spend key + BabyJub owner pub from entropy', async () => {
        const entropy = new Uint8Array(32).fill(1)

        const sk1 = deriveSpendKey(entropy, 0)
        const sk2 = deriveSpendKey(entropy, 0)
        const sk3 = deriveSpendKey(entropy, 1)

        expect(sk1).toEqual(sk2)
        expect(sk1).not.toEqual(sk3)
        expect(sk1 < FR_PRIME).toBe(true)

        const pub1 = await deriveOwnerPub(sk1)
        const pub2 = await deriveOwnerPub(sk1)

        expect(pub1).toEqual(pub2)
        expect(pub1 < FR_PRIME).toBe(true)
    })

    it('merkle: empty root is the folded zero hashes', async () => {
        const zeros = await zeroHashes(TREE_DEPTH)
        const root = await computeRoot([], TREE_DEPTH)

        expect(root).toEqual(zeros[TREE_DEPTH])
    })

    it('merkle: path verifies against the root (both sides)', async () => {
        const leaves = [
            await noteCommitment(1n, 2n, 3n, 4n),
            await noteCommitment(5n, 6n, 7n, 8n),
            await noteCommitment(9n, 10n, 11n, 12n),
        ]

        const root = await computeRoot(leaves, TREE_DEPTH)

        for (let i = 0; i < leaves.length; i++) {
            const { pathElements, pathBits } = await merklePath(leaves, i, TREE_DEPTH)

            expect(pathElements.length).toEqual(TREE_DEPTH)
            expect(pathBits.length).toEqual(TREE_DEPTH)

            /* Circuit convention: index 0 (even) => leaf is LEFT (bit 0);
               index 1 (odd) => leaf is RIGHT (bit 1). */
            expect(pathBits[0]).toEqual(i % 2)

            const ok = await verifyPath(leaves[i], pathElements, pathBits, root)

            expect(ok).toBe(true)
        }
    })

    it('actionHash is 253-bit, deterministic, and input-sensitive', () => {
        const args = {
            nf0: 11n, nf1: 22n, cm0: 33n, cm1: 44n,
            publicValueAbs: 55n, publicValueSign: 0n,
            assetCategory: 66n, newMerkleRoot: 77n,
        }

        const h1 = actionHash(args)
        const h2 = actionHash(args)
        const h3 = actionHash({ ...args, publicValueSign: 1n })

        expect(h1).toEqual(h2)
        expect(h1).not.toEqual(h3)
        /* 253-bit truncation: top 3 bits cleared => < 2^253 < p. */
        expect(h1 < (1n << 253n)).toBe(true)
    })
})
