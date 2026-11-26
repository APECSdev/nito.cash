/* Import libraries. */
import { beforeAll, describe, expect, it, vi } from 'vitest'

/* Import pool lib. */
import {
    buildPoolWitness,
    buildPoolWitness3out,
    PROVING_WASM_URL, PROVING_ZKEY_URL, VERIFYING_KEY_URL,
    RELEASE_TAG, RELEASE_BASE, ASSETS_BASE,
    fetchVerifyingKey,
} from '@/lib/pool/prover'
import { noteCommitment, actionHash3out, getPoseidon } from '@/lib/pool/notes'

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

    it('assembles the 3-out witness with three commitments and the 9-field actionHash', async () => {
        const { ownerPub, assetCategory } = FIXTURE

        const inNotes = [
            { note: { value: 60n, ownerPub, rho: 1001n, r: 5001n }, nk: 222n, index: 0 },
            { note: { value: 40n, ownerPub, rho: 1002n, r: 5002n }, nk: 333n, index: 1 },
        ]
        const outNotes = [
            { value: 40n, ownerPub: 444n, rho: 2001n, r: 6001n },
            { value: 30n, ownerPub: 555n, rho: 2002n, r: 6002n },
            { value: 30n, ownerPub: 666n, rho: 2003n, r: 6003n },
        ]
        const leaves = [
            await noteCommitment(60n, ownerPub, 1001n, 5001n),
            await noteCommitment(40n, ownerPub, 1002n, 5002n),
        ]

        const input = await buildPoolWitness3out({
            inNotes, outNotes, leaves,
            publicValueAbs: 0n, publicValueSign: 0n, assetCategory,
        })

        expect(input.cm).toHaveLength(3)
        expect(input.outValue).toHaveLength(3)
        expect(input.inValue).toHaveLength(2)
        expect(input.inPathElements[0]).toHaveLength(20)

        const inSum = BigInt(input.inValue[0]) + BigInt(input.inValue[1])
        const outSum = BigInt(input.outValue[0]) + BigInt(input.outValue[1]) + BigInt(input.outValue[2])
        expect(inSum).toEqual(outSum)

        expect(input.actionHash).toEqual(actionHash3out({
            nf0: BigInt(input.nf[0]), nf1: BigInt(input.nf[1]),
            cm0: BigInt(input.cm[0]), cm1: BigInt(input.cm[1]), cm2: BigInt(input.cm[2]),
            publicValueAbs: 0n, publicValueSign: 0n, assetCategory,
            newMerkleRoot: BigInt(input.newMerkleRoot),
        }).toString())
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

describe('pool prover (release asset distribution)', () => {
    it('pins the canonical Release tag and the Worker-mirror asset URLs', () => {
        /* The canonical storage: this repo's proving-assets release. */
        expect(RELEASE_BASE).toBe(`https://github.com/APECSdev/pusd-shielded-pool/releases/download/${RELEASE_TAG}/`)

        /* The browser-fetchable default: the prover Worker's CORS-enabled
           proxy of that release (GitHub assets send NO ACAO — the Worker
           mirror is why the wallet can fetch them at all). */
        expect(ASSETS_BASE).toBe('https://prover.nito.cash/assets/')
        expect(PROVING_WASM_URL).toBe(ASSETS_BASE + 'pool.wasm')
        expect(PROVING_ZKEY_URL).toBe(ASSETS_BASE + 'pool_final.zkey')
        expect(VERIFYING_KEY_URL).toBe(ASSETS_BASE + 'verification_key.json')
    })

    it('fetches + caches the committed verifying key (app-served default path)', async () => {
        const vkey = { vk: 'fixture' }

        const fetchMock = vi.fn(async () => ({ ok: true, json: async () => vkey }))

        vi.stubGlobal('fetch', fetchMock)

        try {
            /* First call fetches. */
            expect(await fetchVerifyingKey()).toBe(vkey)
            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(fetchMock.mock.calls[0][0]).toBe('proving/verification_key.json')

            /* Second call is served from the module cache. */
            expect(await fetchVerifyingKey()).toBe(vkey)
            expect(fetchMock).toHaveBeenCalledTimes(1)

            /* An explicit URL bypasses the cache. */
            expect(await fetchVerifyingKey(VERIFYING_KEY_URL)).toBe(vkey)
            expect(fetchMock).toHaveBeenCalledTimes(2)
            expect(fetchMock.mock.calls[1][0]).toBe(VERIFYING_KEY_URL)

            /* A failing fetch surfaces a presentable error. */
            fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })
            await expect(fetchVerifyingKey('proving/other.json')).rejects.toThrow(/404/)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
