/* Import libraries. */
import { beforeAll, describe, expect, it } from 'vitest'

/* Import pool lib. */
import { buildPoolWitness } from '@/lib/pool/prover'
import { noteCommitment, getPoseidon } from '@/lib/pool/notes'

/*
 * The bench's committed "transfer" eval fixture
 * (pusd-shielded-pool build/eval-proofs.json). The wallet's witness assembly
 * MUST reproduce these EXACT public inputs for the circuit to accept the proof.
 */
const FIXTURE = {
    assetCategory: 0x2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544n,
    ownerPub: 111n,
    /* publicSignals = [merkleRoot, actionHash]. */
    merkleRoot: '7017148170027463748288882338239306895786272080659497705757329714043148680521',
    actionHash: '4927022042255244812786945826298331265969113809810528695501987465021834541318',
}

describe('pool prover (witness assembly)', () => {
    /* Warm up the poseidon wasm singleton once (init is slow under full-suite
       CPU contention; see pool-notes.spec.js). */
    beforeAll(async () => {
        await getPoseidon()
    }, 60000)

    it('reproduces the bench transfer fixture public inputs EXACTLY', async () => {
        const { ownerPub, assetCategory } = FIXTURE

        /* Two input notes (60 + 40) spent as 70 + 30; public value 0. */
        const inNotes = [
            { note: { value: 60n, ownerPub, rho: 1001n, r: 5001n }, nk: 222n, index: 0 },
            { note: { value: 40n, ownerPub, rho: 1002n, r: 5002n }, nk: 333n, index: 1 },
        ]
        const outNotes = [
            { value: 70n, ownerPub: 444n, rho: 2001n, r: 6001n },
            { value: 30n, ownerPub: 555n, rho: 2002n, r: 6002n },
        ]
        const leaves = [
            await noteCommitment(60n, ownerPub, 1001n, 5001n),
            await noteCommitment(40n, ownerPub, 1002n, 5002n),
        ]

        const input = await buildPoolWitness({
            inNotes, outNotes, leaves,
            publicValueAbs: 0n, publicValueSign: 0n, assetCategory,
        })

        /* The two PUBLIC inputs must match the bench byte-for-byte. */
        expect(input.merkleRoot).toEqual(FIXTURE.merkleRoot)
        expect(input.actionHash).toEqual(FIXTURE.actionHash)
    })

    it('value conservation: transfer witness is internally consistent', async () => {
        const { ownerPub, assetCategory } = FIXTURE

        const inNotes = [
            { note: { value: 60n, ownerPub, rho: 1001n, r: 5001n }, nk: 222n, index: 0 },
            { note: { value: 40n, ownerPub, rho: 1002n, r: 5002n }, nk: 333n, index: 1 },
        ]
        const outNotes = [
            { value: 70n, ownerPub: 444n, rho: 2001n, r: 6001n },
            { value: 30n, ownerPub: 555n, rho: 2002n, r: 6002n },
        ]
        const leaves = [
            await noteCommitment(60n, ownerPub, 1001n, 5001n),
            await noteCommitment(40n, ownerPub, 1002n, 5002n),
        ]

        const input = await buildPoolWitness({
            inNotes, outNotes, leaves,
            publicValueAbs: 0n, publicValueSign: 0n, assetCategory,
        })

        /* inValue sum + (sign? -pv : +pv) === outValue sum (60+40 == 70+30). */
        const inSum = BigInt(input.inValue[0]) + BigInt(input.inValue[1])
        const outSum = BigInt(input.outValue[0]) + BigInt(input.outValue[1])
        const pv = BigInt(input.publicValueAbs)
        const signed = BigInt(input.publicValueSign) === 0n ? pv : -pv

        expect(inSum + signed).toEqual(outSum)

        /* 2-in/2-out shape + depth-20 paths. */
        expect(input.nf.length).toEqual(2)
        expect(input.cm.length).toEqual(2)
        expect(input.inPathElements[0].length).toEqual(20)
        expect(input.inPathBits[0].length).toEqual(20)
    })
})
