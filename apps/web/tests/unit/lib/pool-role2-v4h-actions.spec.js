// tests/unit/lib/pool-role2-v4h-actions.spec.js
//
// The v4h (the C architecture) lock + action + orchestrator gate: the
// SEVEN-input action shape, the 96-B state commitment
// (LE32(newRoot) ‖ finalNullRoot ‖ LE32(newBalance)), the categories SPLIT
// (the fuel/state ride the POOL category; the holdings/payout ride the HELD
// asset — the real PUSD), the in6 deposit slot (funded EVERY action; the
// deposit FT rides it, never the fuel), the genesis in5 (tokenless H dust,
// first action only), the fee math (1 sat/B over SEVEN locked inputs), and
// the standing shape { fuel, walk, holdings, slot } — all with a MOCKED
// prover (the pinned assets live in the store layer; the live acceptance is
// the browser run).

import { describe, expect, it, vi } from 'vitest'
import { binToHex, hexToBin, cashAddressToLockingBytecode, decodeTransaction } from '@bitauth/libauth'

import { buildRole2LockV4h, ROLE2_V4H_HOLDINGS_SATS } from '@/lib/pool/role2-lock'
import { buildRole2ActionV4h } from '@/lib/pool/role2-action'
import { submitRole2ActionV4h } from '@/lib/pool/role2-actions'
import { depositTag } from '@/lib/pool/role2-carrier'

/* A deterministic test key pair (test-only material, no value). */
const PRIV = hexToBin('11'.repeat(32))

/* The v4h pool shape the builders consume (the deployed mainnet record
   subset — the categories SPLIT: the pool's own + the HELD asset). */
const POOL = {
    heldCategory: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
    id: 'mainnet-role2-pool4-v4h-test',
    assetCategory: '324b1dbfb05c605937f7e68f62210102beacc8b0ece0537e5bde04e90a875814',
    program: {
        lockingBytecode: 'aa2006d764d4a149900fe8cbe2a0b01753643b21bda74b0fc76018172bfc098dc3c987',
        hLockingHex: 'aa2006fa0f9ebadd88eaac1b8801c69329c6c3e6d9209bced65ed01340a6e4e19b2087',
    },
    walkLockings: [
        'aa20cf645a0a3d532c3ea8c485a349e2550bde67725dc8cc3ef3cbbb9a67bec3fc6587',
        'aa2045a64214753dac303d84bb9e55cff327d1d9b2bc1d1e820822ca02fac955b09687',
    ],
}

const CHANGE = 'bitcoincash:qrqj0azraqskmsyh8fkaj70p0a8lrw20fcnrhvnvh8'

function blankUtxo(seed) {
    return { txid: `${seed}`.repeat(32).slice(0, 64), vout: 0, sats: 600, value: 600, token_data: { category: POOL.assetCategory, amount: 0, nft: { capability: 'mutable', commitment: '' } } }
}

const FUNDING = { txid: 'ab'.repeat(32), vout: 0, sats: 400000, value: 400000 }
const BLANKS = [blankUtxo('cc'), blankUtxo('dd')]

/* The ASSET supply UTXO (the user's pre-sent PUSD at their wallet). */
const SUPPLY = { txid: 'ef'.repeat(32), vout: 0, sats: 2000, value: 2000, token_data: { category: POOL.heldCategory, amount: 5000, nft: undefined } }

/* the carrier parts: nf0 ‖ nf1 ‖ cm0 ‖ cm1 ‖ cm2 ‖ newRoot ‖ pv(8 LE) ‖ sign */
function carrierOf(pv = 0n, sign = 0n) {
    const bytes = new Uint8Array(201)
    const view = new DataView(bytes.buffer)
    view.setBigUint64(192, BigInt(pv), true)
    bytes[200] = Number(sign)
    return bytes
}

const H_UNLOCKING = new Uint8Array(213)

const MOCK_PROOF = (pv = 0n, sign = 0n) => ({
    carrier: carrierOf(pv, sign),
    unlockings: [new Uint8Array(9600), new Uint8Array(9600), new Uint8Array(9000)],
    walkUnlockings: [new Uint8Array(8445), new Uint8Array(8425)],
    hUnlocking: H_UNLOCKING,
    newRoot: new Uint8Array(32).fill(0x0a),
    finalNullRoot: new Uint8Array(32).fill(0x0b),
    newBalance: 1000n,
    outNotes: [],
})

const FUEL = [
    { txid: '01'.repeat(32), vout: 0, sats: 23000, value: 23000, token_data: { category: POOL.assetCategory, amount: 0, nft: { capability: 'mutable', commitment: '11'.repeat(32) } } },
    { txid: '01'.repeat(32), vout: 1, sats: 23000, value: 23000, token_data: { category: POOL.assetCategory, amount: 0, nft: { capability: 'mutable', commitment: '11'.repeat(32) } } },
]
const WALKS = [
    { txid: '01'.repeat(32), vout: 2, sats: 2000, value: 2000 },
    { txid: '01'.repeat(32), vout: 3, sats: 2000, value: 2000 },
]
const STATE = { txid: '22'.repeat(32), vout: 0, sats: 10000, value: 10000 }
const HOLDINGS = { txid: '33'.repeat(32), vout: 2, sats: 1000, value: 1000, token_data: { category: POOL.heldCategory, amount: 1000, nft: undefined } }
const SLOT = { txid: '44'.repeat(32), vout: 4, sats: 1000, value: 1000 }

describe('lib/pool/role2-lock — buildRole2LockV4h (the C-architecture lock)', () => {
    it('creates the NFT-only fuel pair + walks + the in6 deposit slot (the ASSET FT rides in6, never the fuel) + the genesis in5', async () => {
        const tag = new Uint8Array(32).fill(0x33)
        const lock = await buildRole2LockV4h({
            pool: POOL, tag, shield: 1000n,
            fundingUtxo: FUNDING, blanks: BLANKS, supplyUtxo: SUPPLY,
            changeAddress: CHANGE, privateKey: PRIV, isGenesis: true,
        })

        const decoded = decodeTransaction(hexToBin(lock.hex))
        expect(typeof decoded).not.toBe('string')
        /* out0/out1: the fuel pair — NFT-ONLY (no FT ever), both tagged. */
        for (const i of [0, 1]) {
            expect(decoded.outputs[i].lockingBytecode).toEqual(hexToBin(POOL.program.lockingBytecode))
            expect(decoded.outputs[i].token.amount).toBe(0n)
            expect(binToHex(decoded.outputs[i].token.nft.commitment)).toBe(binToHex(tag))
        }
        /* out2/out3: the walk pair at the wraps. */
        expect(decoded.outputs[2].lockingBytecode).toEqual(hexToBin(POOL.walkLockings[0]))
        expect(decoded.outputs[3].lockingBytecode).toEqual(hexToBin(POOL.walkLockings[1]))
        /* out4: in6 — the deposit slot at H, carrying the ASSET FT deposit. */
        expect(decoded.outputs[4].lockingBytecode).toEqual(hexToBin(POOL.program.hLockingHex))
        expect(decoded.outputs[4].token.category).toEqual(hexToBin(POOL.heldCategory))
        expect(decoded.outputs[4].token.amount).toBe(1000n)
        /* out5: the BCH change (the FIXED index — non-zero after the fee). */
        expect(decoded.outputs[5].valueSatoshis).toBeGreaterThan(1000n)
        /* out6: the GENESIS in5 — tokenless H dust. */
        expect(decoded.outputs[6].lockingBytecode).toEqual(hexToBin(POOL.program.hLockingHex))
        expect(decoded.outputs[6].token).toBeUndefined()
        /* out7: the ASSET FT change (5000 − 1000). */
        expect(decoded.outputs[7].token.category).toEqual(hexToBin(POOL.heldCategory))
        expect(decoded.outputs[7].token.amount).toBe(4000n)
        /* the outpoints bookkeeping */
        expect(lock.fuelOutpoints).toHaveLength(2)
        expect(lock.walkOutpoints).toHaveLength(2)
        expect(lock.slotOutpoint.slot).toBe('in6')
        expect(lock.slotOutpoint.ftAmount).toBe('1000')
        expect(lock.genesisHoldingsOutpoint.slot).toBe('in5')
    })

    it('a steady lock funds in6 ONLY (no genesis in5)', async () => {
        const tag = new Uint8Array(32).fill(0x44)
        const lock = await buildRole2LockV4h({
            pool: POOL, tag, shield: 0n,
            fundingUtxo: FUNDING, blanks: BLANKS,
            changeAddress: CHANGE, privateKey: PRIV, isGenesis: false,
        })
        const decoded = decodeTransaction(hexToBin(lock.hex))
        /* 6 outputs: fuel×2 + walks×2 + in6 + change — NO in5, NO FT change. */
        expect(decoded.outputs).toHaveLength(6)
        expect(decoded.outputs[4].token).toBeUndefined()
        expect(lock.genesisHoldingsOutpoint).toBeUndefined()
    })

    it('refuses a deposit without an ASSET supply UTXO', async () => {
        const tag = new Uint8Array(32).fill(0x55)
        await expect(buildRole2LockV4h({
            pool: POOL, tag, shield: 100n,
            fundingUtxo: FUNDING, blanks: BLANKS,
            changeAddress: CHANGE, privateKey: PRIV,
        })).rejects.toThrow('needs an ASSET FT supply UTXO')
    })
})

describe('lib/pool/role2-action — buildRole2ActionV4h (the SEVEN-input shape)', () => {
    it('builds 7 inputs / 3 outputs (transfer); the 96-B commitment; out2 == newBalance at H', async () => {
        const carrier = carrierOf(0n, 0n)
        const action = await buildRole2ActionV4h({
            pool: POOL, carrier,
            newRoot: new Uint8Array(32).fill(0x0a),
            finalNullRoot: new Uint8Array(32).fill(0x0b),
            newBalance: 1500n,
            stateUtxo: STATE, fuelUtxos: FUEL, walkUtxos: WALKS,
            holdingsUtxo: HOLDINGS, depositSlotUtxo: SLOT,
            unlockings: MOCK_PROOF().unlockings,
            walkUnlockings: MOCK_PROOF().walkUnlockings,
            hUnlocking: H_UNLOCKING,
        })

        const decoded = decodeTransaction(hexToBin(action.hex))
        expect(typeof decoded).not.toBe('string')
        expect(decoded.inputs).toHaveLength(7)
        expect(decoded.outputs).toHaveLength(3)
        /* the H pair: both inputs carry the bare redeem push. */
        expect(decoded.inputs[5].unlockingBytecode).toEqual(H_UNLOCKING)
        expect(decoded.inputs[6].unlockingBytecode).toEqual(H_UNLOCKING)
        /* out0: the carrier (0 sats, OP_RETURN). */
        expect(decoded.outputs[0].valueSatoshis).toBe(0n)
        /* out1: the new state — the POOL category, NFT-only, 96-B commitment. */
        expect(decoded.outputs[1].token.category).toEqual(hexToBin(POOL.assetCategory))
        expect(decoded.outputs[1].token.amount).toBe(0n)
        expect(decoded.outputs[1].token.nft.commitment).toHaveLength(96)
        const commitment = binToHex(decoded.outputs[1].token.nft.commitment)
        expect(commitment).toBe('0a'.repeat(32) + '0b'.repeat(32) + 'dc05000000000000000000000000000000000000000000000000000000000000')
        /* out2: the holdings — the ASSET FT == newBalance at H. */
        expect(decoded.outputs[2].lockingBytecode).toEqual(hexToBin(POOL.program.hLockingHex))
        expect(decoded.outputs[2].token.category).toEqual(hexToBin(POOL.heldCategory))
        expect(decoded.outputs[2].token.amount).toBe(1500n)
        /* the fee over SEVEN locked inputs ≥ 1 sat/B. */
        expect(action.fee).toBeGreaterThanOrEqual(BigInt(action.hex.length / 2))
        expect(action.newStateCommitment).toHaveLength(192)
    })

    it('an unshield adds out3 — the payout in the ASSET category', async () => {
        const carrier = carrierOf(300n, 1n)
        const action = await buildRole2ActionV4h({
            pool: POOL, carrier,
            newRoot: new Uint8Array(32).fill(0x0a),
            finalNullRoot: new Uint8Array(32).fill(0x0b),
            newBalance: 700n,
            stateUtxo: STATE, fuelUtxos: FUEL, walkUtxos: WALKS,
            holdingsUtxo: HOLDINGS, depositSlotUtxo: SLOT,
            unlockings: MOCK_PROOF().unlockings,
            walkUnlockings: MOCK_PROOF().walkUnlockings,
            hUnlocking: H_UNLOCKING,
            payoutAddress: CHANGE,
        })
        const decoded = decodeTransaction(hexToBin(action.hex))
        expect(decoded.outputs).toHaveLength(4)
        expect(decoded.outputs[3].token.category).toEqual(hexToBin(POOL.heldCategory))
        expect(decoded.outputs[3].token.amount).toBe(300n)
        expect(decoded.outputs[3].valueSatoshis).toBe(1000n)
    })

    it('refuses a steady action without the holdings UTXO + a missing H record', async () => {
        await expect(buildRole2ActionV4h({
            pool: { ...POOL, program: { lockingBytecode: POOL.program.lockingBytecode } },
            carrier: carrierOf(), newRoot: new Uint8Array(32), finalNullRoot: new Uint8Array(32), newBalance: 0n,
            stateUtxo: STATE, fuelUtxos: FUEL, walkUtxos: WALKS,
            holdingsUtxo: HOLDINGS, depositSlotUtxo: SLOT,
            unlockings: MOCK_PROOF().unlockings, walkUnlockings: MOCK_PROOF().walkUnlockings,
            hUnlocking: H_UNLOCKING,
        })).rejects.toThrow('H covenant locking')
    })
})

describe('lib/pool/role2-actions — submitRole2ActionV4h (the orchestrator)', () => {
    it('wires prove → lock → action → broadcast and returns both txids (genesis)', async () => {
        const broadcasts = []
        const result = await submitRole2ActionV4h({
            pool: POOL, state: STATE, blanks: BLANKS, funding: FUNDING, supply: SUPPLY,
            shield: 1000n, isGenesis: true,
            changeAddress: CHANGE, privateKey: PRIV,
            prove: async () => MOCK_PROOF(1000n, 0n),
            broadcast: async (hex) => { broadcasts.push(hex); return 'ff'.repeat(32) },
            saveNotes: vi.fn(),
            payoutAddress: CHANGE,
        })
        /* the lock AND the action both broadcast. */
        expect(broadcasts).toHaveLength(2)
        expect(result.lockTxid).toBe('ff'.repeat(32))
        expect(result.actionTxid).toBe('ff'.repeat(32))
        /* the 7-input action. */
        const decoded = decodeTransaction(hexToBin(broadcasts[1]))
        expect(decoded.inputs).toHaveLength(7)
        /* the genesis action consumed the lock's in5 + in6. */
        expect(result.newHoldings.amount).toBe('1000')
    })

    it('refuses a steady action without the holdings line (the prior out2)', async () => {
        await expect(submitRole2ActionV4h({
            pool: POOL, state: STATE, blanks: BLANKS, funding: FUNDING,
            shield: 0n, isGenesis: false, holdings: null,
            changeAddress: CHANGE, privateKey: PRIV,
            prove: async () => MOCK_PROOF(),
            broadcast: async () => 'ff'.repeat(32),
        })).rejects.toThrow('needs the holdings UTXO')
    })

    it('the standing path validates the shape { fuel, walk, holdings, slot }', async () => {
        await expect(submitRole2ActionV4h({
            pool: POOL, state: STATE, blanks: BLANKS,
            standing: { fuel: FUEL, walk: WALKS, holdings: HOLDINGS },
            changeAddress: CHANGE, privateKey: PRIV,
            prove: async () => MOCK_PROOF(),
            broadcast: async () => 'ff'.repeat(32),
        })).rejects.toThrow('holdings, slot')
    })
})
