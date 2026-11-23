// apps/web/tests/unit/lib/pool-actions.spec.js
//
// Tests for the shielded-pool ACTION ORCHESTRATOR (lib/pool/actions.js —
// the blocker #4 wiring): leaf-list assembly from the scan's ordered action
// chain, in-note selection (own + published bootstrap), funding selection
// (the Fulcrum token-UTXO filter, the single-key rule, and the foreign-
// category burn guard), out-note conservation per action, delivery-point
// parsing, the honest gates — and the full ORCHESTRATION integration
// (real poseidon witness → fixture-proof mock → the EXACT assembled
// buildActionTx params → mocked broadcast).
//
// The BUILDER itself (buildActionTx) is mocked here on purpose: a fixture
// proof pairs ONLY with its own publicSignals (the Groth16 pairing sanity
// check), so a real-builder run is only meaningful with the bench fixtures'
// own witness — that byte-exact ground truth is pool-build.spec.js's job
// (real bn254/secp256k1 against the REAL gate3 covenant redeem). This spec
// pins the WIRING: selection, args assembly, the two vkey shapes, funding,
// stage order, and the post-broadcast bookkeeping.
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { hexToBin } from '@bitauth/libauth'

/* The prover module: generateProof/verifyProof/fetchVerifyingKey swap for a
   fixture proof over the committed vkey (the same ground truth pool-build.spec
   uses); the REAL witness assembly (buildPoolWitness) + constants stay. */
const { generateProofMock, verifyProofMock, fetchVkeyMock } = vi.hoisted(() => ({
    generateProofMock: vi.fn(),
    verifyProofMock: vi.fn(),
    fetchVkeyMock: vi.fn(),
}))

/* The builder (getLivePoolState + buildActionTx) is mocked — see the header:
// this spec pins the ORCHESTRATOR wiring, the builder's byte-exact ground
// truth lives in pool-build.spec.js. */
const { getLiveStateMock, buildTxMock } = vi.hoisted(() => ({
    getLiveStateMock: vi.fn(),
    buildTxMock: vi.fn(),
}))

vi.mock('@/lib/pool/build', async (importOriginal) => {
    const actual = await importOriginal()

    return {
        ...actual,
        getLivePoolState: getLiveStateMock,
        buildActionTx: buildTxMock,
    }
})

vi.mock('@/lib/pool/prover', async (importOriginal) => {
    const actual = await importOriginal()

    return {
        ...actual,
        generateProof: generateProofMock,
        verifyProof: verifyProofMock,
        fetchVerifyingKey: fetchVkeyMock,
    }
})

/* Import the module under test (and its collaborators) AFTER the mock. */
import {
    assembleLeaves, selectInNotes, selectFunding, buildOutNotes,
    parseDeliveryPoint, submitPoolAction, toBenchVk, MIN_FUNDING_SATS,
} from '@/lib/pool/actions'
import { getDefaultPool } from '@/lib/pool/registry'
import { deriveSpendKey, deriveOwnerPub, getPoseidon, nullifier, noteCommitment } from '@/lib/pool/notes'
import { computeRoot } from '@/lib/pool/merkle'
import { hdNodeFromEntropy, hexToBytes } from '@/lib/bch/crypto'
import { deriveDeliveryPoint } from '@/lib/pool/carrier'

/* Bench/pool fixtures on disk (pool-build.spec.js ground truth). */
const FIX = fileURLToPath(new URL('../../fixtures/pool/', import.meta.url))
const EVAL_PROOFS = JSON.parse(readFileSync(`${FIX}/eval-proofs.json`, 'utf8'))
const FIXTURES = JSON.parse(readFileSync(`${FIX}/pusd-public-fixtures.json`, 'utf8'))
const VK = JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/proving/verification_key.json', import.meta.url)), 'utf8'))

const ENTROPY = 'ab'.repeat(32)
const HD_MASTER = hdNodeFromEntropy(ENTROPY)
const spendKey = deriveSpendKey(hexToBytes(ENTROPY))

/* ── the wallet's two GENESIS notes (the Path-A pattern: the pool's seed
   leaves are the wallet's own notes, published in the registry) ── */
let genesis = null

/* ── pure helpers ─────────────────────────────────────────────────── */

describe('assembleLeaves (the witness tree)', () => {
    it('assembles genesis leaves + every action cm0/cm1 at its global index', () => {
        const pool = { genesisLeafCount: 2, genesisLeaves: ['7', '8'] }
        const scan = { actions: [{ leafIndexBase: 2, args: { cm0: 9n, cm1: 10n } }] }

        expect(assembleLeaves(scan, pool)).toEqual([7n, 8n, 9n, 10n])
    })

    it('works for an unseeded pool (genesisLeafCount 0, no genesisLeaves)', () => {
        const pool = {}
        const scan = { actions: [{ leafIndexBase: 0, args: { cm0: 1n, cm1: 2n } }] }

        expect(assembleLeaves(scan, pool)).toEqual([1n, 2n])
    })

    it('THROWS when a seeded pool does not publish its genesis leaves (the runner-gated case)', () => {
        const pool = { genesisLeafCount: 2 }
        const scan = { actions: [] }

        expect(() => assembleLeaves(scan, pool)).toThrow(/seed leaves/)
    })

    it('THROWS when the genesis leaves are missing but actions reference the gap', () => {
        const pool = { genesisLeafCount: 2 }
        const scan = { actions: [{ leafIndexBase: 2, args: { cm0: 9n, cm1: 10n } }] }

        expect(() => assembleLeaves(scan, pool)).toThrow(/seed leaves/)
    })
})

describe('selectInNotes (exactly two in-notes)', () => {
    const note = (value, index, spent = false) => ({
        value: String(value), ownerPub: '1', rho: String(index + 1), r: String(index + 11),
        nk: '2', cm: String(value), nf: String(value), leafIndex: index, spent,
    })

    it('picks the two LARGEST own notes (largest first)', () => {
        const ownNotes = [note(5, 0), note(500, 1), note(50, 2)]

        const { picked, total } = selectInNotes({ action: 'transfer', amount: 400n, ownNotes })

        expect(picked.map((p) => p.note.value)).toEqual([500n, 50n])
        expect(total).toBe(550n)
    })

    it('skips SPENT notes', () => {
        const ownNotes = [note(5, 0, true), note(500, 1, true)]

        expect(() => selectInNotes({ action: 'shield', amount: 1n, ownNotes })).toThrow(/two input notes/)
    })

    it('fills from the pool\'s published bootstrap notes when fewer than two are held', () => {
        const ownNotes = [note(30, 4)]
        const bootstrapNotes = [
            { note: { value: '0', ownerPub: '3', rho: '5', r: '6' }, nk: '7', index: 1 },
        ]

        const { picked, total } = selectInNotes({
            action: 'shield', amount: 10n, ownNotes, bootstrapNotes,
        })

        expect(picked).toHaveLength(2)
        expect(picked[0].note.value).toBe(30n)
        expect(picked[1].index).toBe(1)
        expect(total).toBe(30n)
    })

    it('rejects fewer than two notes with no bootstrap available', () => {
        expect(() => selectInNotes({ action: 'shield', amount: 1n, ownNotes: [] })).toThrow(/two input notes/)
    })

    it('rejects a spend the two notes cannot cover', () => {
        const ownNotes = [note(30, 0), note(40, 1)]

        expect(() => selectInNotes({ action: 'unshield', amount: 100n, ownNotes }))
            .toThrow(/Insufficient shielded balance/)
    })

    it('rejects a duplicate in-note index (a self double-spend)', () => {
        const ownNotes = [note(30, 0), note(40, 0)]

        expect(() => selectInNotes({ action: 'transfer', amount: 10n, ownNotes }))
            .toThrow(/duplicate in-note/)
    })
})

describe('selectFunding (one address, one key, no foreign-token burns)', () => {
    const pool = { assetCategory: 'aabb' }
    const accounts = [{ address: 'bchtest:q', index: 0, branch: 0 }]

    const tokenUtxo = (category, amount, value = 1000) => ({
        tx_hash: 'aa', tx_pos: 0, value,
        token_data: { category, amount },
    })

    it('collects pool-category + plain UTXOs from ONE address until covered', async () => {
        const cluster = {
            getUtxosWithTokens: vi.fn(async () => [
                tokenUtxo('aabb', 2000, 1000),
                { tx_hash: 'bb', tx_pos: 1, value: 60000 },
            ]),
        }

        const { funding, fundingAddress, fundingKey } = await selectFunding({
            cluster, accounts,
            accountBase: "m/44'/145'/0'",
            derivationPath: "m/44'/145'/0'/0",
            hdNode: HD_MASTER, pool, needTokens: 1000n,
        })

        expect(funding).toHaveLength(2)
        expect(funding[0].token.amount).toBe(2000n)
        expect(funding[1].token).toBeUndefined()
        expect(fundingAddress).toBe('bchtest:q')
        expect(fundingKey.privateKeyBytes).toHaveLength(32)
        expect(fundingKey.publicKeyBytes).toHaveLength(33)
    })

    it('NEVER spends a foreign-category token UTXO (the burn guard)', async () => {
        const cluster = {
            getUtxosWithTokens: vi.fn(async () => [
                tokenUtxo('ffff', 5, 1000),
                { tx_hash: 'bb', tx_pos: 1, value: 60000 },
            ]),
        }

        await expect(selectFunding({
            cluster, accounts,
            accountBase: "m/44'/145'/0'",
            derivationPath: "m/44'/145'/0'/0",
            hdNode: HD_MASTER, pool, needTokens: 1000n,
        })).rejects.toThrow(/No single account/)
    })

    it('prefers PLAIN UTXOs when no tokens are needed (exact conservation)', async () => {
        const cluster = {
            getUtxosWithTokens: vi.fn(async () => [
                tokenUtxo('aabb', 2000, 1000),
                { tx_hash: 'bb', tx_pos: 1, value: 60000 },
            ]),
        }

        const { funding } = await selectFunding({
            cluster, accounts,
            accountBase: "m/44'/145'/0'",
            derivationPath: "m/44'/145'/0'/0",
            hdNode: HD_MASTER, pool, needTokens: 0n,
        })

        expect(funding).toHaveLength(1)
        expect(funding[0].token).toBeUndefined()
    })

    it('skips addresses that cannot cover and THROWS when none can', async () => {
        const cluster = {
            getUtxosWithTokens: vi.fn()
                .mockResolvedValueOnce([{ tx_hash: 'aa', tx_pos: 0, value: 100 }])
                .mockResolvedValueOnce([]),
        }
        const two = [{ address: 'bchtest:x', index: 0, branch: 0 }, { address: 'bchtest:y', index: 1, branch: 0 }]

        await expect(selectFunding({
            cluster, accounts: two,
            accountBase: "m/44'/145'/0'",
            derivationPath: "m/44'/145'/0'/0",
            hdNode: HD_MASTER, pool, needTokens: 0n, minSats: MIN_FUNDING_SATS,
        })).rejects.toThrow(/faucet the wallet/)
    })
})

describe('buildOutNotes (value conservation) + parseDeliveryPoint', () => {
    beforeAll(async () => {
        await getPoseidon()
    }, 60000)

    it('shield: out0 = self (total + amount), out1 = self 0', async () => {
        const selfPub = await deriveOwnerPub(spendKey)

        const outs = await buildOutNotes({ action: 'shield', amount: 1000n, total: 60n, spendKey })

        expect(outs[0].value).toBe(1060n)
        expect(outs[0].ownerPub).toBe(selfPub)
        expect(outs[1].value).toBe(0n)
    })

    it('transfer: out0 = RECIPIENT (amount), out1 = self change', async () => {
        const selfPub = await deriveOwnerPub(spendKey)

        const outs = await buildOutNotes({
            action: 'transfer', amount: 40n, total: 60n, spendKey, recipientOwnerPub: 999n,
        })

        expect(outs[0]).toMatchObject({ value: 40n, ownerPub: 999n })
        expect(outs[1]).toMatchObject({ value: 20n, ownerPub: selfPub })
    })

    it('transfer without a recipient THROWS; unshield conserves (change may be 0)', async () => {
        await expect(buildOutNotes({ action: 'transfer', amount: 1n, total: 5n, spendKey }))
            .rejects.toThrow(/recipient/)

        const outs = await buildOutNotes({ action: 'unshield', amount: 60n, total: 60n, spendKey })

        expect(outs[0].value).toBe(0n)
        expect(outs[1].value).toBe(0n)
    })

    it('parses delivery points (64 hex, optional 0x) and rejects the rest', () => {
        const hex = 'ab'.repeat(32)

        expect(parseDeliveryPoint(hex)).toEqual(hexToBytes(hex))
        expect(parseDeliveryPoint('0x' + hex.toUpperCase())).toEqual(hexToBytes(hex))

        expect(() => parseDeliveryPoint('nothex')).toThrow(/64-hex-character/)
        expect(() => parseDeliveryPoint(hex.slice(0, 62))).toThrow(/64-hex-character/)
    })
})

describe('toBenchVk (the two vkey shapes are ONE key)', () => {
    it('converts the committed snarkjs JSON to the bench shape byte-identically', () => {
        /* The committed verification_key.json and the bench fixture vk are the
           SAME key in two encodings — the conversion must be lossless. */
        expect(toBenchVk(VK)).toEqual(FIXTURES.vk)
    })
})

describe('submitPoolAction gates', () => {
    it('rejects unknown actions, non-whole amounts, and incompatible pools', async () => {
        await expect(submitPoolAction({ action: 'zorch', amount: 1n, pool: {} }))
            .rejects.toThrow(/unknown action/)

        await expect(submitPoolAction({ action: 'shield', amount: 0n, pool: {} }))
            .rejects.toThrow(/whole amount/)

        await expect(submitPoolAction({ action: 'shield', amount: '1000', pool: {} }))
            .rejects.toThrow(/whole amount/)

        await expect(submitPoolAction({
            action: 'shield', amount: 1n,
            pool: { walletProverCompatible: false },
        })).rejects.toThrow(/not wallet-prover-compatible/)
    })
})

/* ── the orchestration integration: REAL poseidon witness + the REAL wallet
   key material through the whole submitPoolAction flow, with the builder
   (getLivePoolState + buildActionTx) and the prover mocked — this pins the
   WIRING (selection, args, vkey shape, funding, stages, bookkeeping); the
   builder's byte-exact ground truth is pool-build.spec.js. ─────── */

describe('submitPoolAction orchestration (witness → proof → assembly → broadcast)', () => {
    let POOL
    let POOL_STATE
    let cluster

    beforeAll(async () => {
        await getPoseidon()

        /* The REAL gate3 registry entry, upgraded to the Path-A shape the
           flows require (compatible + PUBLISHED genesis leaves — our own two
           seed notes). The covenant redeem/locking/category stay live-real. */
        const ownerPub = await deriveOwnerPub(spendKey)

        const notes = [
            { value: 600n, ownerPub, rho: 1001n, r: 5001n },
            { value: 400n, ownerPub, rho: 1002n, r: 5002n },
        ]

        const cms = []

        for (const n of notes) {
            cms.push(await noteCommitment(n.value, n.ownerPub, n.rho, n.r))
        }

        genesis = { notes, cms, root: await computeRoot(cms) }

        POOL = {
            ...getDefaultPool('chipnet'),
            walletProverCompatible: true,
            genesisLeaves: [cms[0].toString(10), cms[1].toString(10)],
        }

        /* The live pool state the mocked getLivePoolState returns (shape per
           lib/pool/build.js; rootLE = the CURRENT root in LE byte form). */
        const rootLE = new Uint8Array(32)
        let v = genesis.root
        for (let i = 0; i < 32; i += 1) { rootLE[i] = Number(v & 0xffn); v >>= 8n }
        const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

        POOL_STATE = {
            txid: 'cc'.repeat(32),
            height: 330500,
            poolUtxo: {
                outpointTxid: 'cc'.repeat(32),
                outpointIndex: 0,
                valueSatoshis: 1000n,
                token: {
                    category: hexToBin(POOL.assetCategory),
                    amount: 1000000n,
                    nft: { capability: 'mutable', commitment: new Uint8Array(64) },
                },
            },
            stepUtxos: [1, 2, 3, 4, 5].map((vout) => ({ outpointTxid: 'cc'.repeat(32), outpointIndex: vout })),
            storedRootLE: toHex(rootLE),
            oldNfHashHex: '11'.repeat(32),
            balance: 1000000n,
        }

        cluster = {
            getUtxosWithTokens: vi.fn(async () => [
                /* The fixture-shaped BENCH program pins the action to ONE funding
                   input, so that UTXO must carry BOTH the pool tokens and the
                   >= MIN_FUNDING_SATS fee floor. */
                { tx_hash: 'dd'.repeat(32), tx_pos: 0, value: 60000, token_data: { category: POOL.assetCategory, amount: 5000 } },
                { tx_hash: 'ee'.repeat(32), tx_pos: 1, value: 60000 },
            ]),
            broadcast: vi.fn(async () => 'aabbcc'),
        }

        fetchVkeyMock.mockImplementation(async () => VK)
        getLiveStateMock.mockResolvedValue(POOL_STATE)
        buildTxMock.mockImplementation(async (params) => ({
            transaction: { outputs: [] },
            hex: 'deadbeef',
            txid: 'aabbcc',
            feeSatoshis: 37000n,
            sizeBytes: 37000,
            newBalance: 1001000n,
            newCommitmentHex: 'ab'.repeat(64),
            /* Echo the exact args the orchestrator assembled (the assertion
               target below). */
            echoedArgs: params.args,
        }))
    }, 60000)

    beforeEach(() => {
        generateProofMock.mockReset()
        verifyProofMock.mockReset()
        cluster.getUtxosWithTokens.mockClear()
        cluster.broadcast.mockClear()
        getLiveStateMock.mockClear()
        buildTxMock.mockClear()
    })

    const ownGenesisNotes = async () => {
        const notes = []

        for (let i = 0; i < 2; i += 1) {
            const n = genesis.notes[i]

            notes.push({
                value: n.value.toString(10),
                ownerPub: n.ownerPub.toString(10),
                rho: n.rho.toString(10),
                r: n.r.toString(10),
                nk: spendKey.toString(10),
                cm: genesis.cms[i].toString(10),
                nf: (await nullifier(spendKey, n.rho)).toString(10),
                leafIndex: i,
                spent: false,
            })
        }

        return notes
    }

    /* A FACTORY, not a const: the describe-body evaluates BEFORE beforeAll
       assigns POOL — a const spread would snapshot `pool: undefined` into
       every call. */
    const BASE = () => ({
        cluster,
        pool: POOL,
        networkId: 'chipnet',
        scan: { actions: [], creationTxids: ['cc'.repeat(32)], tipHeight: 330500, tipTxid: 'cc'.repeat(32) },
        hdNode: HD_MASTER,
        accounts: [{ address: 'bchtest:qq', index: 0, branch: 0 }],
        accountBase: "m/44'/145'/0'",
        derivationPath: "m/44'/145'/0'/0",
        spendKey,
        changeAddress: 'bchtest:change',
    })

    it('SHIELD: real witness → fixture-proof mock → exact assembled params → broadcast', async () => {
        let witnessInput = null

        generateProofMock.mockImplementation(async (input) => {
            witnessInput = input

            /* A real fixture proof over the committed vkey (pool-build.spec's
               ground truth) + public signals bound to OUR witness. */
            return {
                proof: EVAL_PROOFS[0].proof,
                publicSignals: [input.merkleRoot, input.actionHash],
            }
        })
        verifyProofMock.mockResolvedValue(true)

        const stages = []

        const result = await submitPoolAction({
            ...BASE(),
            ownNotes: await ownGenesisNotes(),
            action: 'shield',
            amount: 1000n,
            onStage: (stage) => stages.push(stage),
        })

        /* The UI-visible stage order. */
        expect(stages).toEqual(['witness', 'prove', 'verify', 'build', 'broadcast'])

        /* The builder received the EXACT assembled wiring. */
        expect(buildTxMock).toHaveBeenCalledTimes(1)

        const call = buildTxMock.mock.calls[0][0]

        expect(call.pool).toBe(POOL)
        expect(call.poolState).toBe(POOL_STATE)
        expect(call.publicSignals).toEqual([witnessInput.merkleRoot, witnessInput.actionHash])
        expect(call.proof).toBe(EVAL_PROOFS[0].proof)

        /* The vk is the BENCH shape of the committed key (byte-identical to
           the bench fixture vk — the toBenchVk test above). */
        expect(call.vk).toEqual(FIXTURES.vk)

        /* The covenant args are EXACTLY the proven witness values. */
        expect(call.args).toEqual({
            isUnshield: 0n,
            publicValueAbs: 1000n,
            newMerkleRoot: BigInt(witnessInput.newMerkleRoot),
            cm0: BigInt(witnessInput.cm[0]),
            cm1: BigInt(witnessInput.cm[1]),
            nf0: BigInt(witnessInput.nf[0]),
            nf1: BigInt(witnessInput.nf[1]),
        })

        /* Funding: the pool-category token UTXO + a plain BCH UTXO, signed
           by the account key. */
        /* ONE funding input: the fixture-shaped BENCH program pins tx.inputs
           to exactly 7 (5 steps + covenant + 1 funding), so the selector must
           take a single UTXO carrying both tokens and the fee floor. */
        expect(call.funding).toHaveLength(1)
        expect(call.funding[0].token.amount).toBe(5000n)
        expect(call.fundingKey.privateKeyBytes).toHaveLength(32)
        expect(call.changeAddress).toBe('bchtest:change')

        /* SHIELD has no payout + no carrier. */
        expect(call.payoutAddress).toBeUndefined()
        expect(call.carrierPacket).toBeUndefined()

        /* The mocked builder's own echo: same args object. */
        expect(result.echoedArgs).toBe(call.args)

        /* Our own two output notes (deposit + zero) at the next leaf slots. */
        expect(result.outNotes).toHaveLength(2)
        expect(result.outNotes[0].value).toBe(2000n)
        expect(result.outNotes[0].leafIndex).toBe(2)
        expect(result.outNotes[1].value).toBe(0n)
        expect(result.outNotes[1].leafIndex).toBe(3)
        expect(result.outNotes[0].nf).toBe(await nullifier(spendKey, result.outNotes[0].rho))

        /* The spent in-notes are exactly the two genesis notes. */
        expect(result.spentNfs).toEqual([
            (await nullifier(spendKey, genesis.notes[0].rho)).toString(10),
            (await nullifier(spendKey, genesis.notes[1].rho)).toString(10),
        ])

        /* Broadcast + the builder's accounting pass-through. */
        expect(result.txid).toBe('aabbcc')
        expect(result.newBalance).toBe(1001000n)
        expect(cluster.broadcast).toHaveBeenCalledTimes(1)
    }, 60000)

    it('TRANSFER: carrier packet + recipient binding, only the change note recorded', async () => {
        generateProofMock.mockImplementation(async (input) => ({
            proof: EVAL_PROOFS[0].proof,
            publicSignals: [input.merkleRoot, input.actionHash],
        }))
        verifyProofMock.mockResolvedValue(true)

        /* A REAL delivery point for a second test identity. */
        const recipientKey = deriveSpendKey(hexToBytes('cd'.repeat(32)))
        const recipientPoint = await deriveDeliveryPoint(recipientKey)
        const recipientHex = Array.from(recipientPoint, (b) => b.toString(16).padStart(2, '0')).join('')

        const result = await submitPoolAction({
            ...BASE(),
            ownNotes: await ownGenesisNotes(),
            action: 'transfer',
            amount: 500n,
            recipientDeliveryPoint: recipientHex,
        })

        const call = buildTxMock.mock.calls[0][0]

        /* The 164-byte NP01 carrier for the recipient's note. */
        expect(call.carrierPacket).toHaveLength(164)
        expect(call.args.publicValueAbs).toBe(0n)
        expect(call.args.isUnshield).toBe(0n)

        /* Only the SELF change note is recorded (the recipient's note is not
           ours to record — its ownerPub is the recipient's). */
        expect(result.outNotes).toHaveLength(1)
        expect(result.outNotes[0].value).toBe(500n)  // 600 + 400 − 500

        expect(result.txid).toBe('aabbcc')
    }, 60000)

    it('THROWS (no broadcast) when the proof fails the committed-vkey check', async () => {
        generateProofMock.mockImplementation(async (input) => ({
            proof: EVAL_PROOFS[0].proof,
            publicSignals: [input.merkleRoot, input.actionHash],
        }))
        verifyProofMock.mockResolvedValue(false)

        await expect(submitPoolAction({
            ...BASE(),
            ownNotes: await ownGenesisNotes(),
            action: 'shield',
            amount: 1n,
        })).rejects.toThrow(/failed verification/)

        expect(buildTxMock).not.toHaveBeenCalled()
        expect(cluster.broadcast).not.toHaveBeenCalled()
    }, 60000)
})

