// apps/web/tests/unit/lib/pool-build.spec.js
//
// Tests for the wallet's covenant transaction builder (lib/pool/build.js).
//
// Ground truth #1 (byte-exact, LIVE): buildCovenantUnlocking must reproduce the
// gate3 SHIELD's covenant unlocking byte-for-byte from its decoded args — the
// 9-push live format [isUnshield][pvAbs][newRoot][cm1][cm0][nf1][nf0][pad][redeem].
//
// Ground truth #2 (full assembly): buildActionTx with a REAL Groth16 proof
// (build/eval-proofs.json — real proofs over the committed verifying key) over
// a fabricated-but-consistent pool state must produce a tx that:
//   · decodes back through lib/pool/decode.js with the exact args + proven
//     public inputs + covenant prevout (the builder's own round-trip check),
//   · conserves tokens per category (sum in == sum out, BCH-level),
//   · matches the live layout: version 2, [0]=covenant [1-5]=steps [6+]=funding,
//     out[0]=continuity, carrier APPENDED after every constrained output,
//   · signs each funding input with the exact 100-byte live unlocking size.
//
// Full VM acceptance (every input against the deployed lockings on the BCH
// 2026 VM) runs on the apecsdev VM — the NOTE-CARRIER §7.1 harness pattern.
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildActionTx, buildCovenantUnlocking } from '@/lib/pool/build'
import { getDefaultPool } from '@/lib/pool/registry'
import { actionHash } from '@/lib/pool/notes'
import { hdNodeFromEntropy, derivePath, toCashAddress, toPrivateKeyBytes, toPublicKeyBytes } from '@/lib/bch/crypto'

const FIX = fileURLToPath(new URL('../../fixtures/pool/', import.meta.url))
const EVAL_PROOFS = JSON.parse(readFileSync(`${FIX}/eval-proofs.json`, 'utf8'))
const VK = JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/proving/verification_key.json', import.meta.url)), 'utf8'))
/* The live SHIELD's covenant unlocking + args (extracted from chipnet f5927a0b…). */
const LIVE = JSON.parse(readFileSync(`${FIX}/gate3-covenant-live.json`, 'utf8'))

/* The bench's snarkjs vk shape ({ alpha, beta, gamma, delta, ic }). */
const FIXTURES = JSON.parse(readFileSync(`${FIX}/pusd-public-fixtures.json`, 'utf8'))
const BENCH_VK = FIXTURES.vk

const POOL = getDefaultPool('chipnet')

/* eval-proofs' covenant fields are 32-byte LE VM-number hex strings. */
const leHexToBig = (h) => BigInt('0x' + h.match(/../g).reverse().join(''))

function hexToBinLocal(h) {
    const out = new Uint8Array(h.length / 2)
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
    return out
}

/* A wallet keypair for the funding inputs (test-only). */
const hd = derivePath(hdNodeFromEntropy('ab'.repeat(32)), "m/44'/145'/0'/0/0")
const fundingKey = { privateKeyBytes: toPrivateKeyBytes(hd), publicKeyBytes: toPublicKeyBytes(hd) }
const walletAddress = toCashAddress(hd, 'chipnet')

/* A fabricated-but-consistent pool state for the chosen proof scenario. */
function poolStateFor(scenario) {
    const n0 = BigInt(scenario.publicSignals[0])
    const rootLE = new Uint8Array(32)
    let v = n0
    for (let i = 0; i < 32; i += 1) { rootLE[i] = Number(v & 0xffn); v >>= 8n }
    const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return {
        txid: 'ab'.repeat(32),
        height: 330500,
        poolUtxo: {
            outpointTxid: 'ab'.repeat(32),
            outpointIndex: 0,
            valueSatoshis: 1000n,
            token: { category: hexToBinLocal(POOL.assetCategory), amount: 1000000n, nft: { capability: 'mutable', commitment: new Uint8Array(64) } },
        },
        stepUtxos: [1, 2, 3, 4, 5].map((vout) => ({ outpointTxid: 'ab'.repeat(32), outpointIndex: vout })),
        storedRootLE: toHex(rootLE),
        oldNfHashHex: '00'.repeat(32),
        balance: 1000000n,
    }
}

describe('lib/pool/build covenant unlocking (live byte-exact)', () => {
    it('reproduces the gate3 SHIELD covenant unlocking byte-for-byte', () => {
        const args = {}
        for (const [k, v] of Object.entries(LIVE.args)) args[k] = BigInt(v)

        const unlocking = buildCovenantUnlocking({ covenantRedeemHex: LIVE.redeemHex, args })
        const hex = Array.from(unlocking, (x) => x.toString(16).padStart(2, '0')).join('')
        expect(hex).toEqual(LIVE.unlockingHex)
    })

    it('the registry redeem hash-matches the P2SH32 locking (transcription check)', async () => {
        const { hash256 } = await import('@bitauth/libauth')
        const locking = hexToBinLocal(POOL.lockingBytecode)
        const redeem = hexToBinLocal(POOL.covenantRedeem)
        expect(locking[0]).toEqual(0xaa)
        expect(new Uint8Array(hash256(redeem))).toEqual(locking.slice(2, 34))
    })
})

describe('lib/pool/build full action assembly', () => {
    it('builds a SHIELD tx around a real proof (decode round-trip + conservation)', async () => {
        /* The eval's SHIELD scenario: pvAbs=250, isUnshield=0 — a real proof
           over the committed vkey whose n1 binds exactly these args. */
        const scenario = EVAL_PROOFS.find((p) => p.label.startsWith('shield'))
        expect(scenario).toBeTruthy()

        const cov = scenario.covenant
        const args = {
            isUnshield: BigInt(cov.isUnshield),
            publicValueAbs: BigInt(cov.publicValueAbs),
            newMerkleRoot: leHexToBig(cov.newMerkleRoot),
            cm0: leHexToBig(cov.cm0),
            cm1: leHexToBig(cov.cm1),
            nf0: leHexToBig(cov.nf0),
            nf1: leHexToBig(cov.nf1),
        }

        /* The args must hash to the proof's n1 (Option-F binding). NOTE: the eval
           proofs bind the EVAL harness's category (2469acc5…), not gate3's —
           gate3-category proofs are runner-gated (build256 zkey). */
        const EVAL_CATEGORY = 0x2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544n
        const expectedN1 = BigInt(scenario.publicSignals[1])
        expect(actionHash({ ...args, publicValueSign: args.isUnshield, assetCategory: EVAL_CATEGORY })).toEqual(expectedN1)

        const carrierPacket = new Uint8Array(164).fill(0x5a)

        const result = await buildActionTx({
            pool: POOL,
            poolState: poolStateFor(scenario),
            args,
            proof: scenario.proof,
            publicSignals: scenario.publicSignals,
            vk: BENCH_VK,
            funding: [
                { txid: 'cd'.repeat(32), vout: 0, satoshis: 1000, address: walletAddress, token: { category: hexToBinLocal(POOL.assetCategory), amount: 1000 } },
                { txid: 'ce'.repeat(32), vout: 1, satoshis: 500000, address: walletAddress },
            ],
            fundingKey,
            changeAddress: walletAddress,
            carrierPacket,
        })

        /* Decode round-trip is asserted INSIDE the builder; check the tx shape. */
        expect(result.hex.length / 2).toBeGreaterThan(36000) /* ~37 KB like the live SHIELD */
        expect(result.transaction.version).toEqual(2)
        expect(result.transaction.inputs).toHaveLength(8) /* covenant + 5 steps + 2 funding */
        expect(result.transaction.inputs[0].sequenceNumber).toEqual(0xfffffffe)
        expect(result.transaction.inputs[1].sequenceNumber).toEqual(0xfffffffe)
        expect(result.transaction.inputs[6].sequenceNumber).toEqual(0xffffffff)
        /* the funding unlockings are the exact live size (100 B). */
        for (const i of [6, 7]) expect(result.transaction.inputs[i].unlockingBytecode.length).toEqual(100)

        /* outputs: [0] continuity, [1-5] steps, [6] token change, [7] carrier, [8] BCH change. */
        expect(result.transaction.outputs).toHaveLength(9)
        const out0 = result.transaction.outputs[0]
        expect(out0.token.amount).toEqual(1000000n + 250n) /* balance + deposit */
        expect(out0.token.nft.commitment.length).toEqual(64)
        /* carrier is APPENDED after every constrained output. */
        const carrier = result.transaction.outputs[7]
        expect(carrier.lockingBytecode[0]).toEqual(0x6a)
        expect(carrier.valueSatoshis).toEqual(0n)

        /* token conservation (BCH-level): in == out per category. */
        const cat = (t) => Array.from(t.category, (x) => x.toString(16).padStart(2, '0')).join('')
        const tokenIn = 1000n /* the funding token utxo */
        const tokenOut = result.transaction.outputs.reduce((s, o) => s + (o.token ? o.token.amount : 0n), 0n)
        expect(tokenOut).toEqual(tokenIn + 1000000n - 0n) /* funding + pool balance; no payout */

        /* fee = size × 1 sat/B, change = funding − fixed − fee. */
        expect(result.feeSatoshis).toEqual(BigInt(result.sizeBytes))

        /* txid is the double-sha256 of the serialization, reversed. */
        expect(result.txid).toMatch(/^[0-9a-f]{64}$/)
    }, 300000)

    it('builds an UNSHIELD tx with the payout at outputs[1]', async () => {
        const scenario = EVAL_PROOFS.find((p) => p.label.startsWith('unshield'))
        expect(scenario).toBeTruthy()

        const cov = scenario.covenant
        const args = {
            isUnshield: BigInt(cov.isUnshield),
            publicValueAbs: BigInt(cov.publicValueAbs),
            newMerkleRoot: leHexToBig(cov.newMerkleRoot),
            cm0: leHexToBig(cov.cm0),
            cm1: leHexToBig(cov.cm1),
            nf0: leHexToBig(cov.nf0),
            nf1: leHexToBig(cov.nf1),
        }

        const recipient = derivePath(hdNodeFromEntropy('cd'.repeat(32)), "m/44'/145'/0'/0/0")

        const result = await buildActionTx({
            pool: POOL,
            poolState: poolStateFor(scenario),
            args,
            proof: scenario.proof,
            publicSignals: scenario.publicSignals,
            vk: BENCH_VK,
            funding: [{ txid: 'cf'.repeat(32), vout: 0, satoshis: 500000, address: walletAddress }],
            fundingKey,
            changeAddress: walletAddress,
            payoutAddress: toCashAddress(recipient, 'chipnet'),
        })

        /* out[0] = continuity with balance − pvAbs; out[1] = the payout. */
        expect(result.transaction.outputs[0].token.amount).toEqual(1000000n - BigInt(cov.publicValueAbs))
        const payout = result.transaction.outputs[1]
        expect(payout.token).toBeTruthy()
        expect(payout.token.amount).toEqual(BigInt(cov.publicValueAbs))
        expect(payout.token.nft).toBeUndefined() /* fungible-only */
        /* the steps follow the payout. */
        expect(result.transaction.outputs).toHaveLength(2 + 5 + 1 /* change */)
    }, 300000)

    it('rejects a proof anchored to a different pool root (root binding)', async () => {
        const scenario = EVAL_PROOFS.find((p) => p.label.startsWith('transfer'))
        const cov = scenario.covenant
        const args = {
            isUnshield: BigInt(cov.isUnshield),
            publicValueAbs: BigInt(cov.publicValueAbs),
            newMerkleRoot: leHexToBig(cov.newMerkleRoot),
            cm0: leHexToBig(cov.cm0),
            cm1: leHexToBig(cov.cm1),
            nf0: leHexToBig(cov.nf0),
            nf1: leHexToBig(cov.nf1),
        }

        const state = poolStateFor(scenario)
        state.storedRootLE = '11'.repeat(32) /* NOT the proof's n0 */

        await expect(buildActionTx({
            pool: POOL,
            poolState: state,
            args,
            proof: scenario.proof,
            publicSignals: scenario.publicSignals,
            vk: BENCH_VK,
            funding: [{ txid: 'cf'.repeat(32), vout: 0, satoshis: 500000, address: walletAddress }],
            fundingKey,
            changeAddress: walletAddress,
        })).rejects.toThrow('stored root')
    }, 300000)
})

/* ---- getLivePoolState (mocked cluster) + builder guard paths ---- */

import { getLivePoolState } from '@/lib/pool/build'
import { encodeTransactionBCH, hexToBin } from '@bitauth/libauth'
import { STEP_LOCKINGS } from '@/lib/pool/verifier-program'

/* A synthetic tip action tx: out[0] = the pool continuity UTXO (with the state
   NFT commitment), out[1..5] = the re-created verifier steps. */
function tipTxHex({ commitmentHex, amount, extraStepMissing }) {
    const outputs = [
        {
            lockingBytecode: hexToBin(POOL.lockingBytecode),
            valueSatoshis: 1000n,
            token: { category: hexToBin(POOL.assetCategory), amount: BigInt(amount), nft: { capability: 'mutable', commitment: hexToBin(commitmentHex) } },
        },
        ...(extraStepMissing ? STEP_LOCKINGS.slice(0, 4) : STEP_LOCKINGS).map((locking) => ({
            lockingBytecode: hexToBin(locking),
            valueSatoshis: 1000n,
        })),
        { lockingBytecode: new Uint8Array(25), valueSatoshis: 50000n },
    ]
    const tx = {
        version: 2,
        inputs: [{ outpointIndex: 0, outpointTransactionHash: new Uint8Array(32), sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array(0) }],
        outputs,
        locktime: 0,
    }
    const bytes = encodeTransactionBCH(tx)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const STATE_LE = /* root 32 B LE || nullifier hash 32 B */
    '2c0f533600a77df705b7a23481a16bbc2baa9e9abb6a2943857931faa3f44525' + 'ab'.repeat(32)

describe('lib/pool/build getLivePoolState (mocked cluster)', () => {
    it('extracts the pool UTXO, step UTXOs and the state commitment off the tip', async () => {
        const raw = tipTxHex({ commitmentHex: STATE_LE, amount: 1000000 })
        const cluster = {
            getHistory: async () => [{ tx_hash: 'cd'.repeat(32), height: 330600 }, { tx_hash: 'ce'.repeat(32), height: 330500 }],
            getTransaction: async (txid) => (txid === 'cd'.repeat(32) ? raw : tipTxHex({ commitmentHex: STATE_LE, amount: 1 })),
        }

        const state = await getLivePoolState({ cluster, pool: POOL, networkId: 'chipnet' })

        expect(state.txid).toEqual('cd'.repeat(32)) /* the HIGHEST entry is the tip */
        expect(state.height).toEqual(330600)
        expect(state.poolUtxo.outpointTxid).toEqual('cd'.repeat(32))
        expect(state.poolUtxo.outpointIndex).toEqual(0)
        expect(state.balance).toEqual(1000000n)
        expect(state.storedRootLE).toEqual(STATE_LE.slice(0, 64))
        expect(state.oldNfHashHex).toEqual('ab'.repeat(32))
        expect(state.stepUtxos).toEqual([1, 2, 3, 4, 5].map((vout) => ({ outpointTxid: 'cd'.repeat(32), outpointIndex: vout })))
    })

    it('throws when the covenant address has no history', async () => {
        const cluster = { getHistory: async () => [], getTransaction: async () => { throw new Error('unused') } }
        await expect(getLivePoolState({ cluster, pool: POOL, networkId: 'chipnet' })).rejects.toThrow('no history')
    })

    it('throws when the tip does not carry all 5 verifier-step UTXOs', async () => {
        const raw = tipTxHex({ commitmentHex: STATE_LE, amount: 1, extraStepMissing: true })
        const cluster = {
            getHistory: async () => [{ tx_hash: 'cd'.repeat(32), height: 1 }],
            getTransaction: async () => raw,
        }
        await expect(getLivePoolState({ cluster, pool: POOL, networkId: 'chipnet' })).rejects.toThrow('5 verifier-step')
    })
})

describe('lib/pool/build guard paths', () => {
    const evalScenario = () => EVAL_PROOFS.find((p) => p.label.startsWith('transfer'))
    const argsFor = (cov) => ({
        isUnshield: BigInt(cov.isUnshield),
        publicValueAbs: BigInt(cov.publicValueAbs),
        newMerkleRoot: leHexToBig(cov.newMerkleRoot),
        cm0: leHexToBig(cov.cm0),
        cm1: leHexToBig(cov.cm1),
        nf0: leHexToBig(cov.nf0),
        nf1: leHexToBig(cov.nf1),
    })

    it('rejects a pool registry entry without a covenant redeem', async () => {
        const scenario = evalScenario()
        await expect(buildActionTx({
            pool: { ...POOL, covenantRedeem: undefined },
            poolState: poolStateFor(scenario),
            args: argsFor(scenario.covenant),
            proof: scenario.proof,
            publicSignals: scenario.publicSignals,
            vk: BENCH_VK,
            funding: [{ txid: 'cf'.repeat(32), vout: 0, satoshis: 500000, address: walletAddress }],
            fundingKey,
            changeAddress: walletAddress,
        })).rejects.toThrow('covenantRedeem')
    }, 300000)

    it('rejects an unshield without a payout address', async () => {
        const scenario = EVAL_PROOFS.find((p) => p.label.startsWith('unshield'))
        await expect(buildActionTx({
            pool: POOL,
            poolState: poolStateFor(scenario),
            args: argsFor(scenario.covenant),
            proof: scenario.proof,
            publicSignals: scenario.publicSignals,
            vk: BENCH_VK,
            funding: [{ txid: 'cf'.repeat(32), vout: 0, satoshis: 500000, address: walletAddress }],
            fundingKey,
            changeAddress: walletAddress,
        })).rejects.toThrow('payoutAddress')
    }, 300000)

    it('rejects a malformed carrier packet', async () => {
        const scenario = evalScenario()
        await expect(buildActionTx({
            pool: POOL,
            poolState: poolStateFor(scenario),
            args: argsFor(scenario.covenant),
            proof: scenario.proof,
            publicSignals: scenario.publicSignals,
            vk: BENCH_VK,
            funding: [{ txid: 'cf'.repeat(32), vout: 0, satoshis: 500000, address: walletAddress }],
            fundingKey,
            changeAddress: walletAddress,
            carrierPacket: new Uint8Array(100),
        })).rejects.toThrow('164 bytes')
    }, 300000)

    it('rejects funding that cannot cover the fee (dust change)', async () => {
        const scenario = evalScenario()
        await expect(buildActionTx({
            pool: POOL,
            poolState: poolStateFor(scenario),
            args: argsFor(scenario.covenant),
            proof: scenario.proof,
            publicSignals: scenario.publicSignals,
            vk: BENCH_VK,
            funding: [{ txid: 'cf'.repeat(32), vout: 0, satoshis: 1000, address: walletAddress }],
            fundingKey,
            changeAddress: walletAddress,
        })).rejects.toThrow('dust')
    }, 300000)
})
