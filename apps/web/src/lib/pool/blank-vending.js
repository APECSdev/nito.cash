// src/lib/pool/blank-vending.js
//
// The BLANK-VENDING COVENANT — the wallet-side vendor of the Hush
// `wip-role2-hook/blank-vending.mjs` (the permissionless, on-chain,
// first-come-first-served acquisition of tag blanks; G5). The deployer loads
// blanks into the covenant with plain wallet sends; from then on ANYONE can
// take one by paying the pinned price — no signature, no permission, no
// operator involvement. The script IS the authorization.
//
//   inputs:  [0] the vending UTXO — a BLANK (category + MUTABLE NFT + EMPTY
//               commitment + 0 FT) locked to this covenant
//            [1] the buyer's funding input (ANY locking, must be TOKENLESS —
//               this is the input that pays, and the blank is delivered to
//               ITS locking)
//   outputs: [0] the blank, RECREATED at the BUYER's own locking (the blank
//               follows the money), float preserved
//            [1] EXACTLY priceSats, tokenless, to the operator's P2PKH
//            [2] tokenless change, anywhere the buyer directs it
//
// The elegant rule is OUTBYTECODE(0) == UTXOBYTECODE(1): whoever pays
// receives. An attacker cannot underpay, overpay, redirect the payment or
// the blank, extract the float, receive a minting-capability or pre-tagged
// NFT, or dispense a foreign token parked at the vending locking.
//
// Vendored 2026-11-28 from the deployed machines (the Hush
// VENDING-NITO-RESPONSE-2026-11-28.md handover): the chipnet v3 machine
// `aa207bd0…c987` (load ead5d000… h 350676) and the mainnet v4h machine
// `aa2073ad…5087` (load 5bd64412… h 979287). The redeem is reproduced
// BYTE-EXACTLY from this module against both pinned machine lockings
// (tests/unit/lib/pool-blank-vending.spec.js) — the deployed-program
// reproduction discipline.
//
// LANDMINE DISCIPLINE (upstream): every byte sequence entering the VM is a
// FRESH plain Uint8Array. Browser-safe: no node Buffer.

import { encodeDataPush, encodeTransactionBCH, hash256, instantiateSha256 } from '@bitauth/libauth'
import { hexToBytes, signP2pkhInput } from '../bch/crypto.js'

/* The introspection opcodes (verified from libauth source, bch-2023
   inherited by the BCH-2026 VM) + the two verify ops. */
const OP = { NUMEQUALVERIFY: 0x9d, EQUALVERIFY: 0x88 }
const IX = {
    INPUTINDEX: 0xc0,
    TXINPUTCOUNT: 0xc3,
    TXOUTPUTCOUNT: 0xc4,
    UTXOVALUE: 0xc6,
    UTXOBYTECODE: 0xc7,
    UTXOTOKCAT: 0xce,
    UTXOTOKCOMMIT: 0xcf,
    UTXOTOKAMT: 0xd0,
    OUTBYTECODE: 0xcd,
    OUTTOKCAT: 0xd1,
    OUTTOKCOMMIT: 0xd2,
    OUTTOKAMT: 0xd3,
    OUTPUTVALUE: 0xcc,
}

/* VM numbers: 0 is the empty push OP_0 (0x00), 1..16 have dedicated opcodes,
   anything else is a minimal little-endian push with a 0x00 sign pad when
   the high bit is set. (OP_RESERVED 0x50 is NOT zero.) */
const vmIntBytes = (n) => {
    let x = BigInt(n)
    const b = []
    while (x > 0n) {
        b.push(Number(x & 0xffn))
        x >>= 8n
    }
    if (b[b.length - 1] >= 0x80) b.push(0x00)
    return [...encodeDataPush(Uint8Array.from(b))]
}

const pushNum = (n) => (n === 0 ? [0x00] : n <= 16 ? [0x50 + n] : vmIntBytes(n))
const pushBytes = (b) => [...encodeDataPush(Uint8Array.from(b))]

/**
 * The vending redeem script (157 B for the deployed params).
 *
 * @param {object} params — { categoryDisplayHex (natural order), priceSats
 *   (BigInt|number, exact, positive), operatorLockingHex (the operator's
 *   P2PKH locking bytes, hex — the price destination, baked in) }.
 * @returns {Uint8Array} the redeem script bytes.
 */
export function vendingRedeem({ categoryDisplayHex, priceSats, operatorLockingHex }) {
    if (!(BigInt(priceSats) > 0n)) throw new Error('priceSats must be positive')

    const catRev = [...hexToBytes(categoryDisplayHex)].reverse() /* on-chain order */
    const catMutable = new Uint8Array([...catRev, 0x01]) /* mutable suffix */
    const out = []
    const op = (...bs) => bs.forEach((b) => out.push(...b))

    /* self-orientation: we are input 0 of exactly 2, with exactly 3 outputs */
    op([IX.INPUTINDEX], pushNum(0), [OP.NUMEQUALVERIFY])
    op([IX.TXINPUTCOUNT], pushNum(2), [OP.NUMEQUALVERIFY])
    op([IX.TXOUTPUTCOUNT], pushNum(3), [OP.NUMEQUALVERIFY])

    /* the ACTIVE input must BE a blank (category + mutable + EMPTY commitment
       + 0 FT) — an attacker cannot dispense a foreign or minting-capability
       token parked at the vending locking. Commitments/empties compare by
       DIRECT byte equality against OP_0 (OP_SIZE is non-popping on this VM
       and leaks its operand). */
    op(pushNum(0), [IX.UTXOTOKCAT], pushBytes(catMutable), [OP.EQUALVERIFY])
    op(pushNum(0), [IX.UTXOTOKCOMMIT], pushNum(0), [OP.EQUALVERIFY])
    op(pushNum(0), [IX.UTXOTOKAMT], pushNum(0), [OP.NUMEQUALVERIFY])

    /* the funding input must be TOKENLESS — the buyer pays in plain sats only */
    op(pushNum(1), [IX.UTXOTOKCAT], pushNum(0), [OP.EQUALVERIFY])

    /* out0: the blank, delivered to WHOEVER PAID (the funding input's own
       locking) — the blank follows the money. Shape pinned: same category,
       mutable, EMPTY commitment, 0 FT, float preserved byte-for-value. */
    op(pushNum(0), [IX.OUTBYTECODE], pushNum(1), [IX.UTXOBYTECODE], [OP.EQUALVERIFY])
    op(pushNum(0), [IX.OUTTOKCAT], pushBytes(catMutable), [OP.EQUALVERIFY])
    op(pushNum(0), [IX.OUTTOKCOMMIT], pushNum(0), [OP.EQUALVERIFY])
    op(pushNum(0), [IX.OUTTOKAMT], pushNum(0), [OP.NUMEQUALVERIFY])
    op(pushNum(0), [IX.OUTPUTVALUE], pushNum(0), [IX.UTXOVALUE], [OP.NUMEQUALVERIFY])

    /* out1: the PRICE — EXACTLY priceSats, tokenless, to the operator's
       P2PKH. No underpay, no overpay, no redirect, no token smuggled inside
       the payment. */
    op(pushNum(1), [IX.OUTPUTVALUE], vmIntBytes(priceSats), [OP.NUMEQUALVERIFY])
    op(pushNum(1), [IX.OUTBYTECODE], pushBytes(hexToBytes(operatorLockingHex)), [OP.EQUALVERIFY])
    op(pushNum(1), [IX.OUTTOKCAT], pushNum(0), [OP.EQUALVERIFY])

    /* out2: tokenless change to anywhere the buyer directs it (their money,
       their choice of address). Not one fungible unit can ride any output of
       this machine. */
    op(pushNum(2), [IX.OUTTOKCAT], pushNum(0), [OP.EQUALVERIFY])

    /* Every check above is a *VERIFY (pushes nothing on success), so a
       fully-passing execution would end with an EMPTY stack — but P2SH
       requires the final stack to be exactly [truthy]. This signature-free
       script pushes its own success bit once every VERIFY has passed. */
    op([0x51]) /* OP_1 */

    return Uint8Array.from(out)
}

/**
 * The covenant's P2SH32 locking — this system's canonical 35-byte form
 * (every pool/machine locking ends in 0x87):
 * `OP_HASH256 (0xaa) OP_PUSH32? — the 0x20 length prefix — <32-byte
 * hash256(redeem)> OP_EQUAL (0x87)`. The final OP_EQUAL is LOAD-BEARING:
 * the recorded machine lockings are 35 bytes, not 34 (measured against
 * the state-file + handover strings).
 */
export function vendingLockingOf(redeem) {
    return new Uint8Array([0xaa, 0x20, ...hash256(redeem), 0x87])
}

/* The machine locking as hex (the registry pins + the spec compares). */
export function vendingLockingHex(redeem) {
    return [...vendingLockingOf(redeem)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ── the BUY transaction (the stranger-buy: one blank per tx) ──────────────── */

/**
 * Build + sign ONE blank purchase from the vending machine.
 *
 *   inputs:  [0] the machine's blank UTXO — unlocking = the redeem push (the
 *               covenant itself; NO signature)
 *            [1] the buyer's tokenless funding UTXO (P2PKH, Schnorr-signed)
 *   outputs: [0] the blank at the BUYER's own locking (the blank follows the
 *               money — the funding input's own locking), float preserved
 *            [1] EXACTLY priceSats to the operator's P2PKH
 *            [2] the tokenless change to the buyer
 *
 * @param {object} params — { machineUtxo ({txid, vout, sats}), fundingUtxo
 *   ({txid, vout, sats}), vending (the registry entry: priceSats,
 *   operatorLockingHex), categoryDisplayHex (the pool category),
 *   buyerLockingHex (the buyer's P2PKH locking bytes), privateKey,
 *   publicKey (the buyer's HD key for the funding input) }.
 * @returns {Promise<{transaction: object, hex: string, fee: BigInt}>}
 */
export async function buildBuyBlankTx({ machineUtxo, fundingUtxo, vending, categoryDisplayHex, buyerLockingHex, privateKey, publicKey }) {
    if (!machineUtxo || !fundingUtxo) throw new Error('buy: a machine blank UTXO and a funding UTXO are required')
    if (!vending?.operatorLockingHex) throw new Error('buy: the vending entry (price + operator) is required')

    const price = BigInt(vending.priceSats)
    const float = BigInt(machineUtxo.sats)
    const categoryBytes = hexToBytes(categoryDisplayHex)
    const operatorLocking = hexToBytes(vending.operatorLockingHex)
    const buyerLocking = hexToBytes(buyerLockingHex)
    const redeem = vendingRedeem({ categoryDisplayHex, priceSats: price, operatorLockingHex: vending.operatorLockingHex })
    const machineLocking = vendingLockingOf(redeem)

    /* The covenant's own shape pins: 2 inputs, 3 outputs, the blank's float
       out, the exact price out, the change tokenless. */
    const transaction = {
        version: 2,
        locktime: 0,
        inputs: [
            { outpointTransactionHash: hexToBytes(machineUtxo.txid), outpointIndex: machineUtxo.vout, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array(0) },
            { outpointTransactionHash: hexToBytes(fundingUtxo.txid), outpointIndex: fundingUtxo.vout, sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array(0) },
        ],
        outputs: [
            /* out0 — the blank, recreated at the buyer's locking, float preserved. */
            {
                lockingBytecode: buyerLocking,
                valueSatoshis: float,
                token: { category: categoryBytes, amount: 0n, nft: { capability: 'mutable', commitment: new Uint8Array(0) } },
            },
            /* out1 — EXACTLY the price, tokenless, to the operator. */
            { lockingBytecode: operatorLocking, valueSatoshis: price },
            /* out2 — the tokenless change (filled after the fee is measured). */
            { lockingBytecode: buyerLocking, valueSatoshis: 0n },
        ],
    }

    /* The sources: the machine blank (token-prefixed — the covenant reads
       its category/commitment/amount from THIS) + the tokenless funding. */
    const sourceOutputs = [
        {
            lockingBytecode: machineLocking,
            valueSatoshis: float,
            token: { category: categoryBytes, amount: 0n, nft: { capability: 'mutable', commitment: new Uint8Array(0) } },
        },
        { lockingBytecode: buyerLocking, valueSatoshis: BigInt(fundingUtxo.sats) },
    ]

    /* Measure the fee with placeholder unlockings (the role2-lock probe
       pattern): ~159 B for the redeem push + ~66 B for the P2PKH signature. */
    const probe = {
        ...transaction,
        inputs: transaction.inputs.map((input) => ({
            ...input,
            unlockingBytecode: new Uint8Array(160),
        })),
    }
    const fee = BigInt(encodeTransactionBCH(probe).length) * 1n /* 1 sat/B */

    const change = BigInt(fundingUtxo.sats) - price - fee
    if (change < 546n) {
        throw new Error(`buy: the funding UTXO (${fundingUtxo.sats} sats) cannot cover the price + fee + a dust change (short ${546n - change} sats)`)
    }
    transaction.outputs[2].valueSatoshis = change

    /* Sign the funding input (P2PKH, Schnorr + SIGHASH_ALL|FORKID) — the
       wallet's standard signing path, over the hand-rolled bundle. */
    const bundle = {
        transaction,
        sourceOutputs,
        coveredBytecodes: [machineLocking, buyerLocking],
    }
    await signP2pkhInput(bundle, 1, privateKey, publicKey)

    /* The machine input: the redeem push IS the unlocking (no signature). */
    transaction.inputs[0].unlockingBytecode = encodeDataPush(redeem)

    const hex = [...encodeTransactionBCH(transaction)].map((b) => b.toString(16).padStart(2, '0')).join('')

    return { transaction, hex, fee }
}

/**
 * The machine's Electrum scripthash (the standard: sha256(locking) reversed).
 */
export async function vendingScripthash(machineLocking) {
    /* Electrum's scripthash = SINGLE sha256 of the locking, byte-reversed
       (libauth's sha256 is an async-factory instance — crypto.js's
       convention). */
    const sha256 = await instantiateSha256()
    const hash = sha256.hash(machineLocking)
    return [...hash].reverse().map((b) => b.toString(16).padStart(2, '0')).join('')
}
