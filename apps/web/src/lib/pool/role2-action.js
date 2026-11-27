// src/lib/pool/role2-action.js
//
// The role-2 tagged-pool ACTION tx (handoff §3).
//
//   3 inputs, all spending the one program P2SH32 — signature-free:
//     in0  fuel/deposit UTXO  (program; tagged NFT; FT deposit on a SHIELD)
//     in1  fuel UTXO          (program; tagged NFT)
//     in2  state NFT          (program; category+mutable NFT, commitment =
//                              storedRoot(32 LE) ‖ nullifierSetHash(32); FT = balance)
//   outputs:
//     out0 OP_RETURN <169-B carrier>   nf0 ‖ nf1 ‖ cm0 ‖ cm1 ‖ newRoot ‖ pv(8 LE) ‖ sign(1)
//     out1 new state NFT      (program; 10,000-sat float; commitment = newRoot ‖ newNull; FT = newBalance)
//     out2 (unshield only)    public payout: bare category, pv FT, any address
//
// Fees ride the fuel: fee = in0.sats + in1.sats (+ in2 float − out1 float = 0).
// The unlockings are the role-2 program witness (produced by the proving
// pipeline; this builder takes them as inputs so it is independent of the
// proving assets). TXINPUTCOUNT == 3 and TXOUTPUTCOUNT == 2 + sign.

import { cashAddressToLockingBytecode, decodeTransaction, encodeTransactionBCH, hash256, hexToBin, instantiateSha256 } from '@bitauth/libauth'
import { binToHex } from '@bitauth/libauth'

import { ROLE2_CARRIER_BYTES, ROLE2_CARRIER_BYTES_3OUT, role2CarrierOutput } from './role2-carrier.js'

export const ROLE2_STATE_FLOAT = 10000n

function toBigInt(value) {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number') return BigInt(value)
    return BigInt(value ?? 0)
}

function outpointOf(utxo) {
    return {
        outpointTransactionHash: typeof utxo.txid === 'string' ? hexToBin(utxo.txid) : utxo.outpointTransactionHash,
        outpointIndex: utxo.vout ?? utxo.outpointIndex,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: new Uint8Array(0),
    }
}

function tokenOf(utxo) {
    return utxo?.token || utxo?.token_data || null
}

/*
 * buildRole2Action — assemble the 3-input action tx.
 *
 * @param {object}     opts
 * @param {object}     opts.pool            registry pool (program.lockingBytecode, assetCategory)
 * @param {Uint8Array} opts.carrier         the 169-B carrier payload
 * @param {Uint8Array} opts.newRoot         32-B LE new merkle root
 * @param {Uint8Array} opts.newNull         32-B new nullifier-set hash
 * @param {bigint}     opts.newBalance      the new pool balance
 * @param {object}     opts.stateUtxo       the current state UTXO
 * @param {object[]}   opts.fuelUtxos       exactly TWO fuel UTXOs (in0 = deposit, in1)
 * @param {Uint8Array[]} opts.unlockings    the 3 program witnesses
 * @param {string}     [opts.payoutAddress] the unshield payout address
 * @param {Uint8Array} [opts.payoutLocking] the payout locking (when no address)
 */
export async function buildRole2Action({
    pool,
    carrier,
    newRoot,
    newNull,
    newBalance,
    stateUtxo,
    fuelUtxos,
    unlockings,
    payoutAddress,
    payoutLocking,
}) {
    if (!pool?.program?.lockingBytecode) throw new Error('role2-action: pool program locking missing')
    if (!carrier || (carrier.length !== ROLE2_CARRIER_BYTES && carrier.length !== ROLE2_CARRIER_BYTES_3OUT)) throw new Error(`role2-action: carrier must be ${ROLE2_CARRIER_BYTES} or ${ROLE2_CARRIER_BYTES_3OUT} bytes`)
    if (!Array.isArray(fuelUtxos) || fuelUtxos.length !== 2) throw new Error('role2-action: exactly TWO fuel UTXOs are required')
    if (!stateUtxo) throw new Error('role2-action: the state UTXO is required')
    if (!Array.isArray(unlockings) || unlockings.length !== 3) throw new Error('role2-action: exactly THREE unlockings are required')

    const sha256 = await instantiateSha256()
    const programLocking = hexToBin(pool.program.lockingBytecode)
    const categoryBytes = hexToBin(pool.assetCategory)
    const sign = carrier[carrier.length - 1] === 1 ? 1n : 0n
    /* pv is stored LE immediately before the sign byte; decode explicitly. */
    let pv = 0n
    const pvOffset = carrier.length - 9
    for (let i = 7; i >= 0; i -= 1) pv = (pv << 8n) | BigInt(carrier[pvOffset + i])
    const pvValue = pv

    const inputs = [outpointOf(fuelUtxos[0]), outpointOf(fuelUtxos[1]), outpointOf(stateUtxo)]
    inputs.forEach((input, index) => { input.unlockingBytecode = unlockings[index] })

    const outputs = [
        { lockingBytecode: role2CarrierOutput(carrier), valueSatoshis: 0n },
        {
            lockingBytecode: programLocking,
            valueSatoshis: ROLE2_STATE_FLOAT,
            token: {
                category: categoryBytes,
                amount: toBigInt(newBalance),
                nft: { capability: 'mutable', commitment: new Uint8Array([...newRoot, ...newNull]) },
            },
        },
    ]
    if (sign === 1n) {
        const locking = payoutLocking || (payoutAddress ? cashAddressToLockingBytecode(payoutAddress).bytecode : null)
        if (!locking) throw new Error('role2-action: an unshield needs a payout address')
        /* The token output needs the TOKEN dust minimum — 546 sats is still
           rejected ("dust", code 64: the token prefix raises the threshold);
           the live Hush unshield uses 1,000. The sats ride the fuel. */
        outputs.push({ lockingBytecode: locking, valueSatoshis: 1000n, token: { category: categoryBytes, amount: pvValue } })
    }

    /* Fee rides the fuel: in0 + in1 + in2.float − out1.float (the state float is conserved). */
    const inSats = [fuelUtxos[0], fuelUtxos[1], stateUtxo].reduce((sum, utxo) => sum + toBigInt(utxo.sats ?? utxo.value), 0n)
    const outSats = outputs.reduce((sum, output) => sum + toBigInt(output.valueSatoshis), 0n)
    const fee = inSats - outSats
    if (fee < 0n) throw new Error(`role2-action: outputs exceed the inputs by ${-fee} sats`)

    const transaction = { version: 2, locktime: 0, inputs, outputs }
    const hex = binToHex(encodeTransactionBCH(transaction))
    const decoded = decodeTransaction(hexToBin(hex))
    if (typeof decoded === 'string') throw new Error('role2-action: the action does not decode: ' + decoded)
    const txid = binToHex(new Uint8Array(hash256(encodeTransactionBCH(transaction), sha256)).reverse())

    return {
        transaction,
        hex,
        txid,
        fee,
        sign,
        publicValue: pvValue,
        carrierBytes: carrier.length,
        txInputCount: inputs.length,
        txOutputCount: outputs.length,
        newStateCommitment: binToHex(new Uint8Array([...newRoot, ...newNull])),
    }
}

/*
 * buildRole2ActionV3 — the v3 (pool4) FIVE-input action (the M4 contract +
 * the v3.1 field correction, both measured on the live chipnet lifecycle):
 *
 *   in0  fuel/deposit UTXO  (program; tagged NFT; FT deposit on sign=0)
 *   in1  fuel UTXO          (program; tagged NFT)
 *   in2  state NFT          (program; 64-B commitment = LE32(noteRoot) ‖ nullSetRoot)
 *   in3  walkA data UTXO    (the P2SH32 walkA wrap; unlocking = midRoot ‖ sibBlobA ‖ walkA-script redeem)
 *   in4  walkB data UTXO    (the P2SH32 walkB wrap; unlocking = sibBlobB ‖ walkB-script redeem)
 *
 *   out0 OP_RETURN <201-B carrier>   nf0 ‖ nf1 ‖ cm0 ‖ cm1 ‖ cm2 ‖ newRoot ‖ pv ‖ sign
 *   out1 new state NFT      (program; commitment = LE32(newRoot) ‖ finalNullRoot —
 *                            role 2 pins the first half, walkB the second)
 *   out2 (unshield only)    the public payout: pv FT @ 1,000 sats
 *
 * The graph pins TXINPUTCOUNT == 5 (NROLES+2) — fees ride the locked UTXOs'
 * own sats: fee = Σin.sats − Σout.sats, asserted ≥ 1 sat/B (the Hush's own
 * op-builder assert). The walk UTXOs are the lock's v3.1 P2SH32 outputs.
 */
export async function buildRole2ActionV3({
    pool,
    carrier,
    newRoot,
    finalNullRoot,
    newBalance,
    stateUtxo,
    fuelUtxos,
    walkUtxos,
    unlockings,
    walkUnlockings,
    payoutAddress,
    payoutLocking,
}) {
    if (!pool?.program?.lockingBytecode) throw new Error('role2-action: pool program locking missing')
    /* The walk wraps are pinned INSIDE the deployed program — the descriptor
       is the source of truth; a top-level pool entry override also works. */
    const walkLockings = pool.walkLockings ?? pool.program.walkLockings
    if (!Array.isArray(walkLockings) || walkLockings.length !== 2) throw new Error('role2-action: the v3 pool needs exactly TWO walk lockings (the P2SH32 wraps)')
    if (!carrier || carrier.length !== ROLE2_CARRIER_BYTES_3OUT) throw new Error(`role2-action: the v3 carrier must be ${ROLE2_CARRIER_BYTES_3OUT} bytes`)
    if (!Array.isArray(fuelUtxos) || fuelUtxos.length !== 2) throw new Error('role2-action: exactly TWO fuel UTXOs are required')
    if (!Array.isArray(walkUtxos) || walkUtxos.length !== 2) throw new Error('role2-action: exactly TWO walk-data UTXOs are required')
    if (!stateUtxo) throw new Error('role2-action: the state UTXO is required')
    if (!Array.isArray(unlockings) || unlockings.length !== 3) throw new Error('role2-action: exactly THREE program unlockings are required')
    if (!Array.isArray(walkUnlockings) || walkUnlockings.length !== 2) throw new Error('role2-action: exactly TWO walk unlockings are required')
    if (!finalNullRoot || finalNullRoot.length !== 32) throw new Error('role2-action: a 32-byte finalNullRoot is required')

    const sha256 = await instantiateSha256()
    const programLocking = hexToBin(pool.program.lockingBytecode)
    const categoryBytes = hexToBin(pool.assetCategory)
    const sign = carrier[carrier.length - 1] === 1 ? 1n : 0n
    let pv = 0n
    const pvOffset = carrier.length - 9
    for (let i = 7; i >= 0; i -= 1) pv = (pv << 8n) | BigInt(carrier[pvOffset + i])
    const pvValue = pv

    const inputs = [
        outpointOf(fuelUtxos[0]),
        outpointOf(fuelUtxos[1]),
        outpointOf(stateUtxo),
        outpointOf(walkUtxos[0]),
        outpointOf(walkUtxos[1]),
    ]
    const allUnlockings = [...unlockings, ...walkUnlockings]
    inputs.forEach((input, index) => { input.unlockingBytecode = allUnlockings[index] })

    const outputs = [
        { lockingBytecode: role2CarrierOutput(carrier), valueSatoshis: 0n },
        {
            lockingBytecode: programLocking,
            valueSatoshis: ROLE2_STATE_FLOAT,
            token: {
                category: categoryBytes,
                amount: toBigInt(newBalance),
                nft: { capability: 'mutable', commitment: new Uint8Array([...newRoot, ...finalNullRoot]) },
            },
        },
    ]
    if (sign === 1n) {
        const locking = payoutLocking || (payoutAddress ? cashAddressToLockingBytecode(payoutAddress).bytecode : null)
        if (!locking) throw new Error('role2-action: an unshield needs a payout address')
        outputs.push({ lockingBytecode: locking, valueSatoshis: 1000n, token: { category: categoryBytes, amount: pvValue } })
    }

    /* Fees ride the FIVE locked inputs (the graph pins TXINPUTCOUNT == 5 — no
     * fee input exists); the walk UTXOs are P2SH32 (v3.1), sources 3/4. */
    const inSats = [fuelUtxos[0], fuelUtxos[1], stateUtxo, walkUtxos[0], walkUtxos[1]]
        .reduce((sum, utxo) => sum + toBigInt(utxo.sats ?? utxo.value), 0n)
    const outSats = outputs.reduce((sum, output) => sum + toBigInt(output.valueSatoshis), 0n)
    const fee = inSats - outSats
    if (fee < 0n) throw new Error(`role2-action: outputs exceed the inputs by ${-fee} sats`)

    const transaction = { version: 2, locktime: 0, inputs, outputs }
    const hex = binToHex(encodeTransactionBCH(transaction))
    const decoded = decodeTransaction(hexToBin(hex))
    if (typeof decoded === 'string') throw new Error('role2-action: the v3 action does not decode: ' + decoded)
    if (fee < BigInt(hex.length / 2)) throw new Error(`role2-action: fee below 1 sat/B — underfunded lock: need ${hex.length / 2}, have ${fee}`)
    const txid = binToHex(new Uint8Array(hash256(encodeTransactionBCH(transaction), sha256)).reverse())

    return {
        transaction,
        hex,
        txid,
        fee,
        sign,
        publicValue: pvValue,
        carrierBytes: carrier.length,
        txInputCount: inputs.length,
        txOutputCount: outputs.length,
        newStateCommitment: binToHex(new Uint8Array([...newRoot, ...finalNullRoot])),
    }
}

/*
 * buildRole2ActionV4h — the C-architecture (holdings) action tx.
 *
 * THE SEVEN-INPUT SHAPE (the H pair carries no witness — the redeem push is the
 * whole unlocking; the program runs only at inputs 0/1/2, the walks at 3/4,
 * H at 5/6):
 *   inputs  0/1 — program-locking TAGGED fuel UTXOs (hook 4c/4g; NFT-ONLY —
 *                 the deposit FT never rides the fuel in v4h, it rides in6);
 *   input   2   — the pool state NFT (the 96-B commitment's third field is
 *                 the authenticated balance);
 *   inputs  3/4 — the walk-data UTXOs (commit96 walks, P2SH32);
 *   input   5   — the holdings line: the prior action's out2 (steady), or the
 *                 genesis lock-funded tokenless slot (the first action);
 *   input   6   — the deposit slot: the ASSET FT == pv on a deposit,
 *                 tokenless otherwise.
 *   outputs — out0 the 201-B carrier · out1 the new state (NFT-only, the 96-B
 *             commitment = LE32(newRoot) ‖ finalNullRoot ‖ LE32(newBalance)) ·
 *             out2 the new holdings (the ASSET FT == newBalance, at the H
 *             locking) · out3 the unshield payout (the ASSET FT == pv).
 *
 * NO SIGNATURES anywhere (the fees ride the locked sats). The conservation is
 * asserted off-chain here; the consensus token rules + the hook's check 5 +
 * check 9h make the holdings line unforgeable on-chain.
 *
 * @param {object} params — the v3 shape + holdingsUtxo (in5), depositSlotUtxo
 *   (in6), hUnlocking (the bare H redeem push), heldCategoryOnChain (the ASSET
 *   category, on-chain byte order), stateSats/holdingsSats/payoutSats overrides
 * @returns {Promise<object>} { transaction, hex, txid, fee, sign, publicValue,
 *   carrierBytes, txInputCount, txOutputCount, newStateCommitment, newHoldings }
 */
export const ROLE2_V4H_HOLDINGS_SATS = 1000n
export const ROLE2_V4H_PAYOUT_SATS = 1000n

export async function buildRole2ActionV4h({
    pool,
    carrier,
    newRoot,
    finalNullRoot,
    newBalance,
    stateUtxo,
    fuelUtxos,
    walkUtxos,
    holdingsUtxo,
    depositSlotUtxo,
    unlockings,
    walkUnlockings,
    hUnlocking,
    payoutAddress,
    payoutLocking,
}) {
    if (!pool?.program?.lockingBytecode) throw new Error('role2-action: pool program locking missing')
    if (!pool?.program?.hLockingHex) throw new Error('role2-action: the v4h pool needs the H covenant locking (program.hLockingHex)')
    const walkLockings = pool.walkLockings ?? pool.program.walkLockings
    if (!Array.isArray(walkLockings) || walkLockings.length !== 2) throw new Error('role2-action: the v3 pool needs exactly TWO walk lockings (the P2SH32 wraps)')
    if (!carrier || carrier.length !== ROLE2_CARRIER_BYTES_3OUT) throw new Error(`role2-action: the v3 carrier must be ${ROLE2_CARRIER_BYTES_3OUT} bytes`)
    if (!Array.isArray(fuelUtxos) || fuelUtxos.length !== 2) throw new Error('role2-action: exactly TWO fuel UTXOs are required')
    if (!Array.isArray(walkUtxos) || walkUtxos.length !== 2) throw new Error('role2-action: exactly TWO walk-data UTXOs are required')
    if (!holdingsUtxo) throw new Error('role2-action: the v4h action needs the holdings UTXO (in5 — the prior out2 or the genesis slot)')
    if (!depositSlotUtxo) throw new Error('role2-action: the v4h action needs the deposit-slot UTXO (in6 — the lock funds it every action)')
    if (!stateUtxo) throw new Error('role2-action: the state UTXO is required')
    if (!Array.isArray(unlockings) || unlockings.length !== 3) throw new Error('role2-action: exactly THREE program unlockings are required')
    if (!Array.isArray(walkUnlockings) || walkUnlockings.length !== 2) throw new Error('role2-action: exactly TWO walk unlockings are required')
    if (!hUnlocking || hUnlocking.length < 2) throw new Error('role2-action: the v4h action needs the H redeem push (hUnlocking)')
    if (!finalNullRoot || finalNullRoot.length !== 32) throw new Error('role2-action: a 32-byte finalNullRoot is required')
    if (!newRoot || newRoot.length !== 32) throw new Error('role2-action: a 32-byte newRoot is required')

    const sha256 = await instantiateSha256()
    const programLocking = hexToBin(pool.program.lockingBytecode)
    const hLocking = hexToBin(pool.program.hLockingHex)
    /* The CATEGORIES split in v4h: the state + fuel carry the POOL's own
     * category; the holdings + the payout carry the HELD asset (the real
     * PUSD — a category we do not own and can never mint). */
    const poolCategoryBytes = hexToBin(pool.assetCategory)
    const assetCategoryBytes = hexToBin(pool.heldCategoryOnChain ?? pool.assetCategoryOnChain)
    if (!assetCategoryBytes || assetCategoryBytes.length !== 32) throw new Error('role2-action: the v4h pool needs the HELD asset category (heldCategoryOnChain)')

    const sign = carrier[carrier.length - 1] === 1 ? 1n : 0n
    let pv = 0n
    const pvOffset = carrier.length - 9
    for (let i = 7; i >= 0; i -= 1) pv = (pv << 8n) | BigInt(carrier[pvOffset + i])
    const pvValue = pv

    const inputs = [
        outpointOf(fuelUtxos[0]),
        outpointOf(fuelUtxos[1]),
        outpointOf(stateUtxo),
        outpointOf(walkUtxos[0]),
        outpointOf(walkUtxos[1]),
        outpointOf(holdingsUtxo),
        outpointOf(depositSlotUtxo),
    ]
    const allUnlockings = [...unlockings, ...walkUnlockings, hUnlocking, hUnlocking]
    inputs.forEach((input, index) => { input.unlockingBytecode = allUnlockings[index] })

    /* The 96-B state commitment: LE32(newRoot) ‖ finalNullRoot ‖ LE32(newBalance). */
    const bal32 = new Uint8Array(32)
    let balValue = toBigInt(newBalance)
    for (let i = 0; i < 32; i += 1) { bal32[i] = Number(balValue & 0xffn); balValue >>= 8n }
    const commitment96 = new Uint8Array([...newRoot, ...finalNullRoot, ...bal32])

    const outputs = [
        { lockingBytecode: role2CarrierOutput(carrier), valueSatoshis: 0n },
        {
            lockingBytecode: programLocking,
            valueSatoshis: ROLE2_STATE_FLOAT,
            token: {
                category: poolCategoryBytes,
                amount: 0n,
                nft: { capability: 'mutable', commitment: commitment96 },
            },
        },
        /* out2 — the new holdings line: the ASSET FT == newBalance at H. */
        {
            lockingBytecode: hLocking,
            valueSatoshis: ROLE2_V4H_HOLDINGS_SATS,
            token: { category: assetCategoryBytes, amount: toBigInt(newBalance) },
        },
    ]
    if (sign === 1n) {
        const locking = payoutLocking || (payoutAddress ? cashAddressToLockingBytecode(payoutAddress).bytecode : null)
        if (!locking) throw new Error('role2-action: an unshield needs a payout address')
        outputs.push({ lockingBytecode: locking, valueSatoshis: ROLE2_V4H_PAYOUT_SATS, token: { category: assetCategoryBytes, amount: pvValue } })
    }

    /* Fees ride the SEVEN locked inputs (the graph pins TXINPUTCOUNT == 7). */
    const inSats = [fuelUtxos[0], fuelUtxos[1], stateUtxo, walkUtxos[0], walkUtxos[1], holdingsUtxo, depositSlotUtxo]
        .reduce((sum, utxo) => sum + toBigInt(utxo.sats ?? utxo.value), 0n)
    const outSats = outputs.reduce((sum, output) => sum + toBigInt(output.valueSatoshis), 0n)
    const fee = inSats - outSats
    if (fee < 0n) throw new Error(`role2-action: outputs exceed the inputs by ${-fee} sats`)

    const transaction = { version: 2, locktime: 0, inputs, outputs }
    const hex = binToHex(encodeTransactionBCH(transaction))
    const decoded = decodeTransaction(hexToBin(hex))
    if (typeof decoded === 'string') throw new Error('role2-action: the v4h action does not decode: ' + decoded)
    if (fee < BigInt(hex.length / 2)) throw new Error(`role2-action: fee below 1 sat/B — underfunded action: need ${hex.length / 2}, have ${fee}`)
    const txid = binToHex(new Uint8Array(hash256(encodeTransactionBCH(transaction), sha256)).reverse())

    return {
        transaction,
        hex,
        txid,
        fee,
        sign,
        publicValue: pvValue,
        carrierBytes: carrier.length,
        txInputCount: inputs.length,
        txOutputCount: outputs.length,
        newStateCommitment: binToHex(commitment96),
        newHoldings: { sats: Number(ROLE2_V4H_HOLDINGS_SATS), amount: toBigInt(newBalance).toString() },
    }
}
