// src/lib/pool/role2-lock.js
//
// The role-2 tagged-pool LOCK tx (handoff §4).
//
// The user's wallet signs a normal P2PKH tx that pre-creates the next action's
// TWO fuel UTXOs at the program P2SH32. Each fuel carries the pool category as
// a MUTABLE NFT whose commitment is the deposit tag:
//
//     tag = SHA256(carrier[0..64]) = SHA256(nf0_LE ‖ nf1_LE)
//
// of the action the fuel funds. A SHIELD's FT deposit rides output 0 (the
// chain shape); the supply UTXO's remainder goes back to the user as FT change.
// The two blanks (pool category, mutable, EMPTY commitment, 0 FT) are spent and
// re-issued with the tag commitment. The action may spend the lock's UNCONFIRMED
// outputs (first-seen wins the state double-spend; broadcast lock + action
// together).
//
// Fee policy: BARE — 1 sat/B; 15,000 sats per fuel UTXO (30,000 total) covers
// every real action (~28.1 KB) at ~1.07 sat/B. TXINPUTCOUNT==3 forbids a fee
// input, so the fee must already ride the fuel.

import {
    SigningSerializationTypeBCH,
    cashAddressToLockingBytecode,
    decodeTransaction,
    encodeDataPush,
    encodeTransactionBCH,
    generateSigningSerializationBCH,
    hash256,
    hexToBin,
    instantiateSecp256k1,
    instantiateSha256,
} from '@bitauth/libauth'
import { binToHex } from '@bitauth/libauth'

import { ROLE2_CARRIER_BYTES, ROLE2_CARRIER_BYTES_3OUT } from './role2-carrier.js'

export const ROLE2_FUEL_SATS = 15000n
export const ROLE2_STATE_FLOAT = 10000n
/* The reference lock sizes its fee against 100-byte P2PKH unlockings. */
export const ROLE2_LOCK_PLACEHOLDER_BYTES = 100

function toBigInt(value) {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number') return BigInt(value)
    return BigInt(value ?? 0)
}

function tokenOf(utxo) {
    return utxo?.token || utxo?.token_data || null
}

function outpointOf(utxo) {
    return {
        outpointTransactionHash: typeof utxo.txid === 'string' ? hexToBin(utxo.txid) : utxo.outpointTransactionHash,
        outpointIndex: utxo.vout ?? utxo.outpointIndex,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: new Uint8Array(0),
    }
}

function sourceOf(utxo, categoryBytes) {
    const token = tokenOf(utxo)
    const source = {
        lockingBytecode: utxo.lockingBytecode,
        valueSatoshis: toBigInt(utxo.sats ?? utxo.value),
    }
    if (token) {
        source.token = {
            category: categoryBytes,
            amount: toBigInt(token.amount),
            ...(token.nft ? { nft: { capability: token.nft.capability, commitment: hexToBin(token.nft.commitment || '') } } : {}),
        }
    }
    return source
}

/*
 * buildRole2Lock — assemble + sign the lock tx.
 *
 * @param {object}   opts
 * @param {object}   opts.pool          registry pool (program.lockingBytecode, assetCategory)
 * @param {Uint8Array} opts.tag         the 32-byte deposit tag (depositTag(carrier))
 * @param {bigint}   [opts.shield]      the FT deposit (pv) for a SHIELD; 0 otherwise
 * @param {object|object[]} opts.fundingUtxo  plain (tokenless) BCH UTXO(s) for the fuel sats
 * @param {object[]} opts.blanks        exactly TWO blank UTXOs (user P2PKH)
 * @param {object}   [opts.supplyUtxo]  a pool-category FT UTXO for the shield deposit
 * @param {string}   opts.changeAddress the user's CashAddress
 * @param {Uint8Array} opts.privateKey  the user's signing key
 * @param {Uint8Array} [opts.publicKey] the compressed public key (derived when omitted)
 */
export async function buildRole2Lock({
    pool,
    tag,
    shield = 0n,
    fundingUtxo,
    blanks,
    supplyUtxo = null,
    changeAddress,
    privateKey,
    publicKey,
    fuelSats = ROLE2_FUEL_SATS,
}) {
    if (!pool?.program?.lockingBytecode) throw new Error('role2-lock: pool program locking missing')
    if (!tag || tag.length !== 32) throw new Error('role2-lock: a 32-byte deposit tag is required')
    if (!Array.isArray(blanks) || blanks.length !== 2) throw new Error('role2-lock: exactly TWO blanks are required')
    const fundingUtxos = Array.isArray(fundingUtxo) ? fundingUtxo : [fundingUtxo]
    if (fundingUtxos.length === 0 || !fundingUtxos[0]) throw new Error('role2-lock: a funding UTXO is required')

    const sha256 = await instantiateSha256()
    const secp = await instantiateSecp256k1()
    const categoryBytes = hexToBin(pool.assetCategory)
    const programLocking = hexToBin(pool.program.lockingBytecode)
    const changeLocking = cashAddressToLockingBytecode(changeAddress).bytecode
    const pub = publicKey || secp.derivePublicKeyCompressed(privateKey)
    if (typeof pub === 'string') throw new Error('role2-lock: public-key derivation failed: ' + pub)

    const deposit = toBigInt(shield)
    const supplyAmount = supplyUtxo ? toBigInt(tokenOf(supplyUtxo)?.amount) : 0n
    if (deposit > 0n && !supplyUtxo) throw new Error('role2-lock: a shield deposit needs a supply FT UTXO')
    if (deposit > 0n && supplyAmount < deposit) throw new Error('role2-lock: the supply UTXO is smaller than the deposit')

    const inputs = [...fundingUtxos.map(outpointOf), outpointOf(blanks[0]), outpointOf(blanks[1])]
    if (supplyUtxo) inputs.push(outpointOf(supplyUtxo))

    const outputs = [
        /* out0 — the deposit/fuel UTXO; a SHIELD's FT deposit rides here. */
        {
            lockingBytecode: programLocking,
            valueSatoshis: toBigInt(fuelSats),
            token: { category: categoryBytes, amount: deposit, nft: { capability: 'mutable', commitment: tag } },
        },
        /* out1 — the second fuel UTXO (tagged, no FT). */
        {
            lockingBytecode: programLocking,
            valueSatoshis: toBigInt(fuelSats),
            token: { category: categoryBytes, amount: 0n, nft: { capability: 'mutable', commitment: tag } },
        },
        /* BCH change (filled after the fee is measured). */
        { lockingBytecode: changeLocking, valueSatoshis: 0n },
    ]
    const ftChange = supplyAmount - deposit
    if (ftChange > 0n) {
        outputs.push({ lockingBytecode: changeLocking, valueSatoshis: 1000n, token: { category: categoryBytes, amount: ftChange } })
    }

    const transaction = { version: 2, locktime: 0, inputs, outputs }
    const sources = [
        ...fundingUtxos.map((utxo) => ({ lockingBytecode: changeLocking, valueSatoshis: toBigInt(utxo.sats ?? utxo.value) })),
        ...[blanks[0], blanks[1]].map((utxo) => ({
            lockingBytecode: changeLocking,
            valueSatoshis: toBigInt(utxo.sats ?? utxo.value),
            token: { category: categoryBytes, amount: 0n, nft: { capability: 'mutable', commitment: new Uint8Array(0) } },
        })),
        ...(supplyUtxo ? [{
            lockingBytecode: changeLocking,
            valueSatoshis: toBigInt(supplyUtxo.sats ?? supplyUtxo.value),
            token: { category: categoryBytes, amount: supplyAmount },
        }] : []),
    ]

    /* Measure the signed size with 100-byte P2PKH placeholders (reference fee policy). */
    const probe = {
        ...transaction,
        inputs: transaction.inputs.map((input) => ({ ...input, unlockingBytecode: new Uint8Array(ROLE2_LOCK_PLACEHOLDER_BYTES) })),
    }
    const probeFee = BigInt(encodeTransactionBCH(probe).length) * 2n
    const fixed = 2n * toBigInt(fuelSats) + (ftChange > 0n ? 1000n : 0n)
    const inSats = sources.reduce((sum, source) => sum + source.valueSatoshis, 0n)
    const change = inSats - fixed - probeFee
    if (change < 0n) throw new Error(`role2-lock: funding cannot cover the lock (short ${-change} sats)`)
    transaction.outputs[2].valueSatoshis = change

    for (let i = 0; i < transaction.inputs.length; i += 1) {
        const serialization = generateSigningSerializationBCH(
            { inputIndex: i, sourceOutputs: sources, transaction },
            { coveredBytecode: changeLocking, signingSerializationType: Uint8Array.of(SigningSerializationTypeBCH.allOutputs) },
            sha256,
        )
        const digest = hash256(serialization, sha256)
        const signature = secp.signMessageHashSchnorr(privateKey, digest)
        if (typeof signature === 'string') throw new Error('role2-lock: Schnorr signing failed: ' + signature)
        transaction.inputs[i].unlockingBytecode = Uint8Array.from([
            ...encodeDataPush(Uint8Array.from([...signature, SigningSerializationTypeBCH.allOutputs])),
            ...encodeDataPush(pub),
        ])
    }

    const hex = binToHex(encodeTransactionBCH(transaction))
    const decoded = decodeTransaction(hexToBin(hex))
    if (typeof decoded === 'string') throw new Error('role2-lock: the lock does not decode: ' + decoded)
    const txid = binToHex(new Uint8Array(hash256(encodeTransactionBCH(transaction), sha256)).reverse())

    return {
        transaction,
        hex,
        txid,
        fee: probeFee,
        fuelSats: toBigInt(fuelSats),
        deposit,
        tag: binToHex(tag),
        fuelOutpoints: [
            { txid, vout: 0, sats: Number(fuelSats), ftAmount: deposit.toString(), tag: binToHex(tag) },
            { txid, vout: 1, sats: Number(fuelSats), tag: binToHex(tag) },
        ],
        carrierBytes: ROLE2_CARRIER_BYTES,
    }
}

/*
 * The v3 (pool4) lock — the v3.1 FIELD SHAPE (measured on chipnet 2026-11-27:
 * the RAW walk scripts are a relay-NONSTANDARD scriptPubKey, "code 64" — the
 * walk UTXOs are P2SH32-WRAPPED on chain, the scripts ride the ACTION's
 * unlockings as the redeem push; the hook 4w/graph pins hash the WRAPS).
 *
 * Beyond the 2-out/3-out lock's two tagged fuel UTXOs, the v3 lock pre-creates
 * the action's TWO walk-data UTXOs at the deployed P2SH32 walk lockings
 * (dust, 2,000 sats each — above the ~1,370-sat relay dust threshold of a
 * ~300-B locking). Fuel 23,000 × 2 (the deployed default; the v3 action is
 * ~45 KB — the walk unlockings alone are 8,445 + 8,425 B).
 */
export const ROLE2_V3_FUEL_SATS = 23000n
export const ROLE2_V3_WALK_SATS = 2000n

export async function buildRole2LockV3({
    pool,
    tag,
    shield = 0n,
    fundingUtxo,
    blanks,
    supplyUtxo = null,
    changeAddress,
    privateKey,
    publicKey,
    fuelSats = ROLE2_V3_FUEL_SATS,
    walkSats = ROLE2_V3_WALK_SATS,
}) {
    if (!pool?.program?.lockingBytecode) throw new Error('role2-lock: pool program locking missing')
    /* The walk wraps are a DEPLOYED-PROGRAM property (they're pinned inside
       the program's graph) — they live on the program descriptor; a pool
       entry may also carry them at the top level (the spec fixture shape). */
    const walkLockings = pool.walkLockings ?? pool.program.walkLockings
    if (!Array.isArray(walkLockings) || walkLockings.length !== 2) throw new Error('role2-lock: the v3 pool needs exactly TWO walk lockings (the P2SH32 wraps)')
    if (!tag || tag.length !== 32) throw new Error('role2-lock: a 32-byte deposit tag is required')
    if (!Array.isArray(blanks) || blanks.length !== 2) throw new Error('role2-lock: exactly TWO blanks are required')
    const fundingUtxos = Array.isArray(fundingUtxo) ? fundingUtxo : [fundingUtxo]
    if (fundingUtxos.length === 0 || !fundingUtxos[0]) throw new Error('role2-lock: a funding UTXO is required')

    const sha256 = await instantiateSha256()
    const secp = await instantiateSecp256k1()
    const categoryBytes = hexToBin(pool.assetCategory)
    const programLocking = hexToBin(pool.program.lockingBytecode)
    const walkA = hexToBin(walkLockings[0])
    const walkB = hexToBin(walkLockings[1])
    const changeLocking = cashAddressToLockingBytecode(changeAddress).bytecode
    const pub = publicKey || secp.derivePublicKeyCompressed(privateKey)
    if (typeof pub === 'string') throw new Error('role2-lock: public-key derivation failed: ' + pub)

    const deposit = toBigInt(shield)
    const supplyAmount = supplyUtxo ? toBigInt(tokenOf(supplyUtxo)?.amount) : 0n
    if (deposit > 0n && !supplyUtxo) throw new Error('role2-lock: a shield deposit needs a supply FT UTXO')
    if (deposit > 0n && supplyAmount < deposit) throw new Error('role2-lock: the supply UTXO is smaller than the deposit')

    const inputs = [...fundingUtxos.map(outpointOf), outpointOf(blanks[0]), outpointOf(blanks[1])]
    if (supplyUtxo) inputs.push(outpointOf(supplyUtxo))

    const outputs = [
        /* out0 — the deposit/fuel UTXO; a DEPOSIT's FT rides here (sign=0). */
        {
            lockingBytecode: programLocking,
            valueSatoshis: toBigInt(fuelSats),
            token: { category: categoryBytes, amount: deposit, nft: { capability: 'mutable', commitment: tag } },
        },
        /* out1 — the second fuel UTXO (tagged, no FT). */
        {
            lockingBytecode: programLocking,
            valueSatoshis: toBigInt(fuelSats),
            token: { category: categoryBytes, amount: 0n, nft: { capability: 'mutable', commitment: tag } },
        },
        /* out2/out3 — the walk-data UTXOs at the DEPLOYED P2SH32 walk lockings
           (v3.1: the on-chain form; the raw scripts ride the action's
           unlockings as the redeem push). */
        { lockingBytecode: walkA, valueSatoshis: toBigInt(walkSats) },
        { lockingBytecode: walkB, valueSatoshis: toBigInt(walkSats) },
        /* BCH change (filled after the fee is measured). */
        { lockingBytecode: changeLocking, valueSatoshis: 0n },
    ]
    const ftChange = supplyAmount - deposit
    if (ftChange > 0n) {
        outputs.push({ lockingBytecode: changeLocking, valueSatoshis: 1000n, token: { category: categoryBytes, amount: ftChange } })
    }

    const transaction = { version: 2, locktime: 0, inputs, outputs }
    const sources = [
        ...fundingUtxos.map((utxo) => ({ lockingBytecode: changeLocking, valueSatoshis: toBigInt(utxo.sats ?? utxo.value) })),
        ...[blanks[0], blanks[1]].map((utxo) => ({
            lockingBytecode: changeLocking,
            valueSatoshis: toBigInt(utxo.sats ?? utxo.value),
            token: { category: categoryBytes, amount: 0n, nft: { capability: 'mutable', commitment: new Uint8Array(0) } },
        })),
        ...(supplyUtxo ? [{
            lockingBytecode: changeLocking,
            valueSatoshis: toBigInt(supplyUtxo.sats ?? supplyUtxo.value),
            token: { category: categoryBytes, amount: supplyAmount },
        }] : []),
    ]

    const probe = {
        ...transaction,
        inputs: transaction.inputs.map((input) => ({ ...input, unlockingBytecode: new Uint8Array(ROLE2_LOCK_PLACEHOLDER_BYTES) })),
    }
    const probeFee = BigInt(encodeTransactionBCH(probe).length) * 2n
    const fixed = 2n * toBigInt(fuelSats) + 2n * toBigInt(walkSats) + (ftChange > 0n ? 1000n : 0n)
    const inSats = sources.reduce((sum, source) => sum + source.valueSatoshis, 0n)
    const change = inSats - fixed - probeFee
    if (change < 0n) throw new Error(`role2-lock: funding cannot cover the v3 lock (short ${-change} sats)`)
    transaction.outputs[4].valueSatoshis = change

    for (let i = 0; i < transaction.inputs.length; i += 1) {
        const serialization = generateSigningSerializationBCH(
            { inputIndex: i, sourceOutputs: sources, transaction },
            { coveredBytecode: changeLocking, signingSerializationType: Uint8Array.of(SigningSerializationTypeBCH.allOutputs) },
            sha256,
        )
        const digest = hash256(serialization, sha256)
        const signature = secp.signMessageHashSchnorr(privateKey, digest)
        if (typeof signature === 'string') throw new Error('role2-lock: Schnorr signing failed: ' + signature)
        transaction.inputs[i].unlockingBytecode = Uint8Array.from([
            ...encodeDataPush(Uint8Array.from([...signature, SigningSerializationTypeBCH.allOutputs])),
            ...encodeDataPush(pub),
        ])
    }

    const hex = binToHex(encodeTransactionBCH(transaction))
    const decoded = decodeTransaction(hexToBin(hex))
    if (typeof decoded === 'string') throw new Error('role2-lock: the v3 lock does not decode: ' + decoded)
    const txid = binToHex(new Uint8Array(hash256(encodeTransactionBCH(transaction), sha256)).reverse())

    return {
        transaction,
        hex,
        txid,
        fee: probeFee,
        fuelSats: toBigInt(fuelSats),
        walkSats: toBigInt(walkSats),
        deposit,
        tag: binToHex(tag),
        fuelOutpoints: [
            { txid, vout: 0, sats: Number(fuelSats), ftAmount: deposit.toString(), tag: binToHex(tag) },
            { txid, vout: 1, sats: Number(fuelSats), tag: binToHex(tag) },
        ],
        walkOutpoints: [
            { txid, vout: 2, sats: Number(walkSats), walk: 'A' },
            { txid, vout: 3, sats: Number(walkSats), walk: 'B' },
        ],
        carrierBytes: ROLE2_CARRIER_BYTES_3OUT,
    }
}
