// apps/web/src/lib/pool/build.js
//
// The wallet-side COVENANT TRANSACTION BUILDER — assembles the full BCH
// transaction for a shielded-pool action (SHIELD / TRANSFER / UNSHIELD):
//
//   in 0   : the pool covenant UTXO   (9-push unlocking: the action args +
//            the function-selector pad + the deployed 347 B redeem)
//   in 1–5 : the five verifier-step UTXOs (unlockings from lib/pool/verifier.js,
//            built from the wallet's OWN Groth16 proof)
//   in 6+  : the wallet's funding P2PKH inputs (Schnorr SIGHASH_ALL|FORKID,
//            token-bearing source outputs — the chipnet NULLFAIL gotcha)
//
//   out 0  : the pool continuity UTXO (covenant P2SH32 + the NEW state NFT
//            commitment  root[32 LE] ‖ sha256(oldNfHash ‖ nf0 ‖ nf1)[32]  +
//            the new token balance)
//   out 1  : UNSHIELD only — the public payout (fungible pool-category tokens
//            of exactly publicValueAbs to the recipient; the covenant reads
//            outputs[1] when isUnshield = 1)
//   then   : the five verifier-step UTXOs re-created (deployed lockings),
//            optional NP01 carrier OP_RETURN (always APPENDED — never inserted,
//            so no constrained output index shifts), token change, BCH change.
//
// The exact on-chain shapes are mirrored from the LIVE chipnet pools (the
// Option B action chain + gate3-demo-pool), whose deployed covenant is the
// merged spend()/init() variant: genesis input index 4 hardcoded, n1/n0 read
// from the genesis witness at byte offsets 1792/1825, the `<pad>` arg = the
// function selector (empty push 0 = spend). The tx layout is thereby FIXED:
//   [0]=covenant, [1–3]=execs, [4]=genesis, [5]=terminal, [6+]=funding;
//   [0]=continuity, [1]=payout (unshield only), then steps + extras.
//
// The proof is an INPUT (from lib/pool/prover.js); the builder binds it to the
// covenant args + the pool state (root binding: the proof's n0 must equal the
// pool UTXO's stored root — validated here before building).

import { encodeTransactionBCH, hexToBin, binToHex, encodeDataPush, bigIntToVmNumber, sha256, decodeTransaction } from '@bitauth/libauth'

import { addressToLockingBytecode, signP2pkhInput } from '../bch/crypto.js'
import { poolAddress } from './registry.js'
import { produceVerifierInputs } from './verifier.js'
import { DEPLOYED_PROGRAM, STEP_LOCKINGS } from './verifier-program.js'
import { decodePoolAction } from './decode.js'

const concatBytes = (parts) => {
    const total = parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return out
}

const be32 = (v) => {
    const out = new Uint8Array(32)
    let x = BigInt(v)
    for (let i = 31; i >= 0; i -= 1) { out[i] = Number(x & 0xffn); x >>= 8n }
    return out
}

/** 32-byte LE VM-number byte form of a field element (the covenant arg form). */
const le32 = (v) => be32(v).reverse()

const num = (v) => new Uint8Array(bigIntToVmNumber(BigInt(v)))

/**
 * Read the CURRENT live pool state (the pool UTXO + the 5 verifier-step UTXOs
 * + the state commitment) off the tip of the covenant-address history.
 *
 * @param cluster  the Fulcrum cluster (lib/bch/provider.js getCluster())
 * @param pool     the registry pool entry
 * @param networkId the network ('chipnet' | 'mainnet')
 * @returns { txid, height, poolUtxo, stepUtxos, storedRootLE, oldNfHashHex, balance }
 */
export async function getLivePoolState({ cluster, pool, networkId }) {
    const address = poolAddress(pool, networkId)
    const history = (await cluster.getHistory(address)).filter((h) => h.height > 0)
    if (history.length === 0) throw new Error('pool build: no history for the pool address')

    /* The tip = the highest confirmed entry (ties broken by the scan's chain
       rule are unnecessary here — the pool address only receives covenant
       outputs, so the highest entry IS the latest state). */
    const tip = history.reduce((a, b) => (b.height > a.height ? b : a))
    const raw = await cluster.getTransaction(tip.tx_hash)
    const tx = decodeTransaction(hexToBin(raw))
    if (typeof tx === 'string') throw new Error(`pool build: cannot decode tip ${tip.tx_hash}`)

    const poolLocking = hexToBin(pool.lockingBytecode)
    const out0 = tx.outputs[0]
    if (binToHex(out0.lockingBytecode) !== pool.lockingBytecode || !out0.token || !out0.token.nft) {
        throw new Error('pool build: tip output 0 is not the pool covenant UTXO')
    }
    const commitment = out0.token.nft.commitment
    if (commitment.length !== 64) throw new Error('pool build: pool state commitment must be 64 bytes')

    /* The 5 verifier-step UTXOs: outputs with the deployed step lockings, in
       step order [exec0, exec1, exec2, genesis, terminal]. The three EXEC
       lockings are IDENTICAL, so slots are assigned by consuming each matching
       output exactly once (multiplicity-aware; a bare indexOf would collide
       all three execs onto slot 0 and leave sparse holes some()/map() skip). */
    const stepOuts = new Array(5).fill(undefined)
    const used = new Set()
    for (let slot = 0; slot < 5; slot += 1) {
        for (let i = 0; i < tx.outputs.length; i += 1) {
            if (used.has(i)) continue
            if (binToHex(tx.outputs[i].lockingBytecode) === STEP_LOCKINGS[slot]) { stepOuts[slot] = i; used.add(i); break }
        }
    }
    if (stepOuts.some((i) => i === undefined)) throw new Error('pool build: tip does not carry all 5 verifier-step UTXOs')

    return {
        txid: tip.tx_hash,
        height: tip.height,
        poolUtxo: {
            outpointTxid: tip.tx_hash,
            outpointIndex: 0,
            valueSatoshis: out0.valueSatoshis,
            token: {
                category: out0.token.category,
                amount: out0.token.amount,
                nft: { capability: out0.token.nft.capability, commitment },
            },
        },
        stepUtxos: stepOuts.map((vout) => ({ outpointTxid: tip.tx_hash, outpointIndex: vout })),
        storedRootLE: binToHex(commitment.slice(0, 32)),
        oldNfHashHex: binToHex(commitment.slice(32, 64)),
        balance: out0.token.amount,
    }
}

/**
 * The covenant input's 9-push unlocking bytecode (on-chain push order):
 *   [isUnshield][publicValueAbs][newMerkleRoot][cm1][cm0][nf1][nf0][pad][redeem]
 * — the deployed spend() path (pad = empty push, the function selector 0).
 * Mirrors the live actions exactly (decode.js's parser is the inverse).
 */
export function buildCovenantUnlocking({ covenantRedeemHex, args }) {
    const redeem = hexToBin(covenantRedeemHex)
    const pushes = [
        num(args.isUnshield), /* int: minimal VM number (0 = empty push, live) */
        num(args.publicValueAbs),
        le32(args.newMerkleRoot), /* bytes32: exact 32-byte LE VM-number form */
        le32(args.cm1),
        le32(args.cm0),
        le32(args.nf1),
        le32(args.nf0),
        new Uint8Array(0), /* the <pad> function selector: 0 = spend() */
        redeem,
    ]
    return concatBytes(pushes.map((p) => new Uint8Array(encodeDataPush(p))))
}

/**
 * Assemble + sign a full pool action transaction.
 *
 * @param pool            the registry pool entry (needs lockingBytecode,
 *                        assetCategory, covenantRedeem)
 * @param poolState       getLivePoolState() result (pool UTXO + step UTXOs +
 *                        storedRootLE / oldNfHashHex / balance)
 * @param args            { isUnshield, publicValueAbs, newMerkleRoot, cm0, cm1,
 *                        nf0, nf1 } — BigInts; MUST be the values the proof
 *                        attests to (validated against publicSignals[1]).
 * @param proof           the Groth16 proof ({ a, b, c }, snarkjs encoding)
 * @param publicSignals   [merkleRoot, actionHash] (the proof's public inputs)
 * @param vk              the verifying key (public/proving/verification_key.json)
 * @param funding         [{ txid, vout, satoshis, token?: { category, amount }, address }]
 *                        — the wallet's P2PKH inputs (SHIELD: must carry ≥
 *                        publicValueAbs of the pool category across inputs)
 * @param fundingKey      { privateKeyBytes, publicKeyBytes } for ALL funding inputs
 * @param changeAddress   the wallet's change address (BCH + token change)
 * @param payoutAddress   UNSHIELD: the recipient address for outputs[1]
 * @param carrierPacket   optional 164-byte NP01 packet (lib/pool/carrier.js
 *                        encryptNote) — appended as an OP_RETURN output
 * @param feeRateSatPerB  optional fee rate (default 1 sat/B)
 * @returns { transaction, hex, txid, feeSatoshis, sizeBytes }
 */
export async function buildActionTx({
    pool,
    poolState,
    args,
    proof,
    publicSignals,
    vk,
    funding = [],
    fundingKey,
    changeAddress,
    payoutAddress,
    carrierPacket,
    feeRateSatPerB = 1n,
}) {
    if (!pool.covenantRedeem) throw new Error('pool build: the pool registry entry has no covenantRedeem (cannot build the covenant unlocking)')

    const isUnshield = BigInt(args.isUnshield)
    const publicValueAbs = BigInt(args.publicValueAbs)
    const n0 = BigInt(publicSignals[0])
    const n1 = BigInt(publicSignals[1])

    /* ── root binding: the proof is anchored to THIS pool's current root. ── */
    const storedRootLE = le32(n0)
    if (binToHex(storedRootLE) !== poolState.storedRootLE) {
        throw new Error('pool build: proof merkleRoot (n0) does not match the pool UTXO stored root — re-scan the pool and re-prove against the current state')
    }

    /* ── the NEW state commitment ──
       newNullifierHash = sha256(oldNullifierHash ‖ nf0 ‖ nf1) — the ARG BYTES
       (32-byte LE VM-number form), exactly as the covenant folds them. */
    const nf0LE = le32(args.nf0)
    const nf1LE = le32(args.nf1)
    const newNfHash = new Uint8Array(sha256.hash(concatBytes([hexToBin(poolState.oldNfHashHex), nf0LE, nf1LE])))
    const newRootLE = le32(args.newMerkleRoot)
    const newCommitment = concatBytes([newRootLE, newNfHash])

    /* ── token conservation (the covenant's own check, mirrored) ──
       balance' = balance + pvAbs − 2·isUnshield·pvAbs  (must be ≥ 0). */
    const balance = BigInt(poolState.balance)
    const newBalance = balance + publicValueAbs - 2n * isUnshield * publicValueAbs
    if (newBalance < 0n) throw new Error('pool build: unshield exceeds the pool balance')

    /* ── the verifier inputs (from the wallet's own proof) ── */
    const verifierUnlockings = produceVerifierInputs({ vk, proof, publicSignals, program: DEPLOYED_PROGRAM })

    /* ── assemble the tx skeleton ── */
    const category = hexToBin(pool.assetCategory)
    const covenantUnlocking = buildCovenantUnlocking({ covenantRedeemHex: pool.covenantRedeem, args })

    const fundingInputs = funding.map((utxo) => ({
        outpointTransactionHash: hexToBin(utxo.txid),
        outpointIndex: utxo.vout,
        sequenceNumber: 0xffffffff,
        /* Placeholder unlocking of the exact signed size (65 B sig + 1 B type
           + 33 B pubkey + push opcodes = 100 B — the live funding size). */
        unlockingBytecode: new Uint8Array(100),
    }))

    const transaction = {
        version: 2, /* the covenant requires tx.version == 2 */
        inputs: [
            {
                outpointTransactionHash: hexToBin(poolState.poolUtxo.outpointTxid),
                outpointIndex: poolState.poolUtxo.outpointIndex,
                sequenceNumber: 0xfffffffe, /* live convention for all script inputs */
                unlockingBytecode: covenantUnlocking,
            },
            ...poolState.stepUtxos.map((utxo, i) => ({
                outpointTransactionHash: hexToBin(utxo.outpointTxid),
                outpointIndex: utxo.outpointIndex,
                sequenceNumber: 0xfffffffe,
                unlockingBytecode: verifierUnlockings[i],
            })),
            ...fundingInputs,
        ],
        outputs: [],
        locktime: 0,
    }

    /* ── outputs ── */
    const STEP_SATS = 1000n
    const outputs = []

    /* out[0]: the pool continuity UTXO — NEW state + NEW balance. */
    outputs.push({
        lockingBytecode: hexToBin(pool.lockingBytecode),
        valueSatoshis: STEP_SATS,
        token: { category, amount: newBalance, nft: { capability: 'mutable', commitment: newCommitment } },
    })

    /* out[1] (unshield only): the public payout — fungible-only tokens of
       EXACTLY publicValueAbs (no NFT; the covenant reads outputs[1]). */
    if (isUnshield === 1n) {
        if (!payoutAddress) throw new Error('pool build: unshield requires payoutAddress')
        outputs.push({
            lockingBytecode: addressToLockingBytecode(payoutAddress),
            valueSatoshis: STEP_SATS,
            token: { category, amount: publicValueAbs },
        })
    }

    /* the five verifier-step UTXOs, re-created with the deployed lockings. */
    for (const locking of STEP_LOCKINGS) {
        outputs.push({ lockingBytecode: hexToBin(locking), valueSatoshis: STEP_SATS })
    }

    /* token change: funding tokens in − (shield deposit) must return to the wallet. */
    const fundingTokens = funding.reduce((sum, utxo) => sum + (utxo.token && binToHex(utxo.token.category) === pool.assetCategory ? BigInt(utxo.token.amount) : 0n), 0n)
    let tokenChange = fundingTokens - (isUnshield === 1n ? 0n : publicValueAbs)
    if (tokenChange < 0n) throw new Error('pool build: funding inputs carry fewer pool-category tokens than the deposit')
    if (tokenChange > 0n) {
        outputs.push({
            lockingBytecode: addressToLockingBytecode(changeAddress),
            valueSatoshis: STEP_SATS,
            token: { category, amount: tokenChange },
        })
    }

    /* the NP01 carrier (always APPENDED after every constrained output). */
    if (carrierPacket) {
        if (carrierPacket.length !== 164) throw new Error('pool build: carrier packet must be 164 bytes')
        outputs.push({
            lockingBytecode: concatBytes([new Uint8Array([0x6a, 0x4c, carrierPacket.length]), carrierPacket]),
            valueSatoshis: 0n,
        })
    }

    /* BCH change + fee: sign first (sizes are deterministic), then set change.
       The funding unlocking size is constant (100 B), so fee estimation is
       stable across signing. */
    const sourceOutputs = [
        /* covenant input's source output (the pool UTXO being spent). */
        {
            lockingBytecode: hexToBin(pool.lockingBytecode),
            valueSatoshis: poolState.poolUtxo.valueSatoshis,
            token: poolState.poolUtxo.token,
        },
        /* the verifier-step source outputs. */
        ...poolState.stepUtxos.map(() => ({ lockingBytecode: new Uint8Array(35), valueSatoshis: STEP_SATS })),
        /* the funding source outputs — token data INCLUDED (the chipnet
           NULLFAIL gotcha: spending a token-bearing UTXO requires the token
           prefix in the sighash's corresponding source output). */
        ...funding.map((utxo) => ({
            lockingBytecode: addressToLockingBytecode(utxo.address),
            valueSatoshis: BigInt(utxo.satoshis),
            token: utxo.token ? { category: utxo.token.category, amount: BigInt(utxo.token.amount) } : undefined,
        })),
    ]

    /* Determine the change output, then sign. Two passes because the fee
       depends on the final encoded size (which is deterministic once the
       output set is fixed). */
    const fundingSats = funding.reduce((sum, utxo) => sum + BigInt(utxo.satoshis), 0n)
    const fixedSpend = outputs.reduce((sum, out) => sum + out.valueSatoshis, 0n)

    const changeOutput = { lockingBytecode: addressToLockingBytecode(changeAddress), valueSatoshis: 0n }
    outputs.push(changeOutput)

    /* Wire the outputs into the transaction (the funding sigs below cover them). */
    transaction.outputs = outputs

    /* size probe with the placeholder funding unlockings (same size as signed). */
    const probe = encodeTransactionBCH({ ...transaction, outputs })
    const sizeBytes = BigInt(probe.length)
    const feeSatoshis = sizeBytes * feeRateSatPerB
    const change = fundingSats - fixedSpend - feeSatoshis
    if (change < 546n) throw new Error(`pool build: change would be ${change} sats (dust) — add funding`)
    changeOutput.valueSatoshis = change

    /* ── sign the funding inputs (Schnorr SIGHASH_ALL|FORKID via crypto.js) ── */
    const bundle = {
        transaction,
        sourceOutputs,
        /* indexed by ABSOLUTE input position (signP2pkhInput reads [inputIndex]). */
        coveredBytecodes: [
            hexToBin(pool.lockingBytecode),
            ...STEP_LOCKINGS.map((locking) => hexToBin(locking)),
            ...funding.map((utxo) => addressToLockingBytecode(utxo.address)),
        ],
    }
    for (let i = 0; i < funding.length; i += 1) {
        await signP2pkhInput(bundle, 6 + i, fundingKey.privateKeyBytes, fundingKey.publicKeyBytes)
    }

    /* ── self-check: decode.js must recover our args + proven inputs. ── */
    const finalHex = binToHex(encodeTransactionBCH(transaction))
    const decoded = decodePoolAction(finalHex)
    if (!decoded) throw new Error('pool build: the built tx does not decode as a pool action (internal consistency)')
    if (decoded.args.isUnshield !== isUnshield || decoded.args.publicValueAbs !== publicValueAbs) {
        throw new Error('pool build: decode round-trip mismatch on the action args')
    }
    if (decoded.proven.merkleRoot !== n0 || decoded.proven.actionHash !== n1) {
        throw new Error('pool build: decode round-trip mismatch on the proven public inputs')
    }
    if (decoded.prevoutTxid !== poolState.poolUtxo.outpointTxid) {
        throw new Error('pool build: decode round-trip mismatch on the covenant prevout')
    }

    return {
        transaction,
        hex: finalHex,
        txid: binToHex(new Uint8Array(sha256.hash(new Uint8Array(sha256.hash(encodeTransactionBCH(transaction))))).reverse()),
        feeSatoshis,
        sizeBytes: Number(sizeBytes),
        newBalance,
        newCommitmentHex: binToHex(newCommitment),
    }
}
