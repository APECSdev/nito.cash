// tests/unit/lib/pool-role2-v3-actions.spec.js
//
// The v3 (pool4) lock + action + orchestrator gate: the v3.1 FIELD SHAPES
// (the walk UTXOs at the P2SH32 wraps; the 5-input action; the 64-B state
// commitment = LE32(newRoot) ‖ finalNullRoot), the fee math (1 sat/B), the
// standing-fuel tag binding, and the broadcast/notes flow — all with a MOCKED
// prover (the pinned assets live in the store layer; the builders are
// asset-independent by design, the 2-out/3-out pattern).
//
// The live acceptance (the real proof, the real chain) is the browser run.

import { describe, expect, it, vi } from 'vitest'
import { binToHex, hexToBin, cashAddressToLockingBytecode, decodeTransaction } from '@bitauth/libauth'

import { buildRole2LockV3, ROLE2_V3_FUEL_SATS, ROLE2_V3_WALK_SATS } from '@/lib/pool/role2-lock'
import { buildRole2ActionV3 } from '@/lib/pool/role2-action'
import { submitRole2ActionV3, matchStandingFuelNotes } from '@/lib/pool/role2-actions'
import { depositTag } from '@/lib/pool/role2-carrier'

/* A deterministic test key pair (chipnet-only test material, no value). */
const PRIV = hexToBin('11'.repeat(32))

/* The v3 pool shape the builders consume (registry subset). */
const POOL = {
    id: 'chipnet-role2-pool4-v3-test',
    assetCategory: 'e56c0a8583e36092f20e54c9247f6b8e5a6afd391027aa70ae109c3c42377930',
    program: { lockingBytecode: 'aa206dc915cef6f1343b7d170caaf79346072222d66fd3285fcb4d506f184069e8cb87' },
    walkLockings: [
        'aa20f823d16d3cab573069ba562afb2bfb9a5bcb72bdae85218132e1e12e6bfeaded87',
        'aa206ae3e5fb435b33afd6e907c9beae8e139a3ea85c90d57f026e99fc4bdbb31a0687',
    ],
}

const CHANGE = 'bchtest:qzzu85xnl99u534d9z40yu7c494hknppx5lu29gl8t'

function blankUtxo(seed) {
    return { txid: `${seed}`.repeat(32).slice(0, 64), vout: 0, sats: 600, value: 600, token_data: { category: POOL.assetCategory, amount: 0, nft: { capability: 'mutable', commitment: '' } } }
}

const FUNDING = { txid: 'ab'.repeat(32), vout: 0, sats: 200000, value: 200000 }
const BLANKS = [blankUtxo('cc'), blankUtxo('dd')]

/* the carrier parts: nf0 ‖ nf1 ‖ cm0 ‖ cm1 ‖ cm2 ‖ newRoot ‖ pv(8 LE) ‖ sign */
function carrierOf(pv = 0n, sign = 0n) {
    const bytes = new Uint8Array(201)
    bytes.set(new Uint8Array(32), 32)
    const view = new DataView(bytes.buffer)
    view.setBigUint64(192, BigInt(pv), true)
    bytes[200] = Number(sign)
    return bytes
}

const MOCK_PROOF = {
    carrier: carrierOf(0n, 0n),
    unlockings: [new Uint8Array(9600), new Uint8Array(9600), new Uint8Array(9000)],
    walkUnlockings: [new Uint8Array(8445), new Uint8Array(8425)],
    newRoot: new Uint8Array(32).fill(0x0a),
    finalNullRoot: new Uint8Array(32).fill(0x0b),
    newBalance: 1000n,
    outNotes: [],
}

describe('lib/pool/role2-lock — buildRole2LockV3 (the v3.1 lock shape)', () => {
    it('creates 2 tagged fuel + 2 walk-data UTXOs at the P2SH32 wraps + the change', async () => {
        const tag = new Uint8Array(32).fill(0x33)
        const lock = await buildRole2LockV3({ pool: POOL, tag, shield: 1000n, fundingUtxo: FUNDING, blanks: BLANKS, supplyUtxo: { txid: 'ef'.repeat(32), vout: 0, sats: 1000, value: 1000, token_data: { category: POOL.assetCategory, amount: 5000, nft: undefined } }, changeAddress: CHANGE, privateKey: PRIV })

        const decoded = decodeTransaction(hexToBin(lock.hex))
        expect(typeof decoded).not.toBe('string')
        /* out0: fuel0 — the FT deposit + the tag */
        expect(decoded.outputs[0].lockingBytecode).toEqual(hexToBin(POOL.program.lockingBytecode))
        expect(decoded.outputs[0].token.amount).toBe(1000n)
        expect(binToHex(decoded.outputs[0].token.nft.commitment)).toBe(binToHex(tag))
        /* out1: fuel1 — tagged, no FT */
        expect(decoded.outputs[1].token.amount).toBe(0n)
        /* out2/out3: the walk UTXOs at the DEPLOYED P2SH32 wraps, 2,000 sats */
        expect(decoded.outputs[2].lockingBytecode).toEqual(hexToBin(POOL.walkLockings[0]))
        expect(decoded.outputs[2].valueSatoshis).toBe(ROLE2_V3_WALK_SATS)
        expect(decoded.outputs[3].lockingBytecode).toEqual(hexToBin(POOL.walkLockings[1]))
        expect(decoded.outputs[3].valueSatoshis).toBe(ROLE2_V3_WALK_SATS)
        /* the FT change rides back to the user */
        const ftChange = decoded.outputs.find((o) => o.token && o.token.amount === 4000n)
        expect(ftChange).toBeDefined()
        /* the outpoints are reported for the action */
        expect(lock.fuelOutpoints).toHaveLength(2)
        expect(lock.walkOutpoints).toHaveLength(2)
        expect(lock.walkOutpoints[0]).toMatchObject({ vout: 2, sats: Number(ROLE2_V3_WALK_SATS), walk: 'A' })
        expect(lock.walkOutpoints[1]).toMatchObject({ vout: 3, walk: 'B' })
        expect(lock.fuelSats).toBe(ROLE2_V3_FUEL_SATS)
    })
})

describe('lib/pool/role2-action — buildRole2ActionV3 (the 5-input shape)', () => {
    it('assembles the 5 inputs (fuel/fuel/state/walkA/walkB), the 64-B commitment, the payout on unshield', async () => {
        const state = { txid: '99'.repeat(32), vout: 0, sats: 10000, value: 10000 }
        const fuel = [
            { txid: 'aa'.repeat(32), vout: 0, sats: 23000, ftAmount: '0', tag: '00' },
            { txid: 'aa'.repeat(32), vout: 1, sats: 23000, tag: '00' },
        ]
        const walk = [
            { txid: 'aa'.repeat(32), vout: 2, sats: 2000, walk: 'A' },
            { txid: 'aa'.repeat(32), vout: 3, sats: 2000, walk: 'B' },
        ]
        /* a TRANSFER first (sign=0, no payout) */
        const act = await buildRole2ActionV3({ pool: POOL, carrier: carrierOf(0n, 0n), newRoot: MOCK_PROOF.newRoot, finalNullRoot: MOCK_PROOF.finalNullRoot, newBalance: 1000n, stateUtxo: state, fuelUtxos: fuel, walkUtxos: walk, unlockings: MOCK_PROOF.unlockings, walkUnlockings: MOCK_PROOF.walkUnlockings })
        expect(act.txInputCount).toBe(5)
        expect(act.txOutputCount).toBe(2)
        expect(act.newStateCommitment).toBe(binToHex(new Uint8Array([...MOCK_PROOF.newRoot, ...MOCK_PROOF.finalNullRoot])))
        /* the fee rides all five inputs */
        expect(act.fee).toBe(23000n + 23000n + 10000n + 2000n + 2000n - 10000n)

        /* an UNSHIELD adds the payout out2 */
        const unshield = await buildRole2ActionV3({ pool: POOL, carrier: carrierOf(250n, 1n), newRoot: MOCK_PROOF.newRoot, finalNullRoot: MOCK_PROOF.finalNullRoot, newBalance: 750n, stateUtxo: state, fuelUtxos: fuel, walkUtxos: walk, unlockings: MOCK_PROOF.unlockings, walkUnlockings: MOCK_PROOF.walkUnlockings, payoutAddress: CHANGE })
        expect(unshield.txOutputCount).toBe(3)
        expect(unshield.publicValue).toBe(250n)
    })

    it('REFUSES a fee below 1 sat/B (the Hush op-builder assert)', async () => {
        const state = { txid: '99'.repeat(32), vout: 0, sats: 10000, value: 10000 }
        /* the walk UTXOs pay for the ~45 KB action: 2,000-sat dust cannot */
        await expect(buildRole2ActionV3({ pool: POOL, carrier: carrierOf(0n, 0n), newRoot: MOCK_PROOF.newRoot, finalNullRoot: MOCK_PROOF.finalNullRoot, newBalance: 0n, stateUtxo: state, fuelUtxos: [{ txid: 'aa'.repeat(32), vout: 0, sats: 30 }, { txid: 'aa'.repeat(32), vout: 1, sats: 30 }], walkUtxos: [{ txid: 'aa'.repeat(32), vout: 2, sats: 30 }, { txid: 'aa'.repeat(32), vout: 3, sats: 30 }], unlockings: MOCK_PROOF.unlockings, walkUnlockings: MOCK_PROOF.walkUnlockings })).rejects.toThrow('1 sat/B')
    })
})

describe('lib/pool/role2-actions — submitRole2ActionV3 (the orchestrator)', () => {
    it('prove → tag → lock → action → broadcast together → the notes saved', async () => {
        const broadcast = vi.fn(async (hex, label) => `txid-${label}`)
        const saveNotes = vi.fn()
        const state = { txid: '77'.repeat(32), vout: 1, sats: 10000, value: 10000 }

        const result = await submitRole2ActionV3({ pool: POOL, state, blanks: BLANKS, funding: FUNDING, shield: 1000n, supply: { txid: 'ef'.repeat(32), vout: 0, sats: 1000, value: 1000, token_data: { category: POOL.assetCategory, amount: 5000 } }, changeAddress: CHANGE, privateKey: PRIV, prove: async () => ({ ...MOCK_PROOF }), broadcast, saveNotes, onStage: undefined })

        /* the lock broadcast precedes the action */
        expect(broadcast).toHaveBeenCalledTimes(2)
        expect(broadcast.mock.calls[0][1]).toBe('lock')
        expect(broadcast.mock.calls[1][1]).toBe('action')
        expect(result.actionTxid).toBe('txid-action')
        expect(saveNotes).toHaveBeenCalledTimes(1)
        /* the deposit tag binds the carrier's first 64 bytes */
        expect(result.tag).toBe(binToHex(depositTag(MOCK_PROOF.carrier)))
    })

    it('the standing path: matching fuel tags are spent as-is, NO fresh lock', async () => {
        const broadcast = vi.fn(async (hex, label) => `txid-${label}`)
        const state = { txid: '77'.repeat(32), vout: 1, sats: 10000, value: 10000 }
        const tag = binToHex(depositTag(MOCK_PROOF.carrier))
        const standing = {
            fuel: [
                { txid: '11'.repeat(32), vout: 0, sats: 23000, token_data: { category: POOL.assetCategory, amount: 0, nft: { capability: 'mutable', commitment: tag } } },
                { txid: '11'.repeat(32), vout: 1, sats: 23000, token_data: { category: POOL.assetCategory, amount: 0, nft: { capability: 'mutable', commitment: tag } } },
            ],
            walk: [
                { txid: '11'.repeat(32), vout: 2, sats: 2000, walk: 'A' },
                { txid: '11'.repeat(32), vout: 3, sats: 2000, walk: 'B' },
            ],
        }

        const result = await submitRole2ActionV3({ pool: POOL, state, blanks: BLANKS, funding: FUNDING, changeAddress: CHANGE, privateKey: PRIV, standing, prove: async () => ({ ...MOCK_PROOF }), broadcast })

        expect(broadcast).toHaveBeenCalledTimes(1)
        expect(broadcast.mock.calls[0][1]).toBe('action')
        expect(result.lockTxid).toBe(standing.fuel[0].txid)
    })

    it('the standing path REFUSES fuel tagged for a different nullifier pair (hook 4g)', async () => {
        const broadcast = vi.fn(async (hex, label) => `txid-${label}`)
        const state = { txid: '77'.repeat(32), vout: 1, sats: 10000, value: 10000 }
        const wrongTag = 'ff'.repeat(32)
        const standing = {
            fuel: [
                { txid: '11'.repeat(32), vout: 0, sats: 23000, token_data: { category: POOL.assetCategory, amount: 0, nft: { capability: 'mutable', commitment: wrongTag } } },
                { txid: '11'.repeat(32), vout: 1, sats: 23000, token_data: { category: POOL.assetCategory, amount: 0, nft: { capability: 'mutable', commitment: wrongTag } } },
            ],
            walk: [
                { txid: '11'.repeat(32), vout: 2, sats: 2000, walk: 'A' },
                { txid: '11'.repeat(32), vout: 3, sats: 2000, walk: 'B' },
            ],
        }

        await expect(submitRole2ActionV3({ pool: POOL, state, blanks: BLANKS, funding: FUNDING, changeAddress: CHANGE, privateKey: PRIV, standing, prove: async () => ({ ...MOCK_PROOF }), broadcast })).rejects.toThrow('bound to a different nullifier pair')
        expect(broadcast).not.toHaveBeenCalled()
    })
})
