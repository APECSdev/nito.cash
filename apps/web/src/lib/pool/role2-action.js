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
