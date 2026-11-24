// apps/web/src/lib/cashaccount/cashcode.js
//
// CashCode (BCH Reusable Payment Addresses) wallet integration.
//
// The on-chain CashAccount's P2S script carries the CashCode SPEND key and
// the Identity NFT commitment carries the SCAN key (CashAccountV2.md:50).
// This module turns those keys into a `cashcode:`/`cashcodetest:` payment
// code and discovers payments through Fulcrum's RPA index.
//
// Key derivation follows the Selene convention (bch-rpa/src/hd.ts):
//   scan  = account/3/0'   (m/44'/145'/0'/3/0')
//   spend = account/3/1'   (m/44'/145'/0'/3/1')
//
// Fulcrum v1.10+ RPA methods (bch-rpa/docs/INTEGRATION.md:127-141):
//   blockchain.rpa.get_history(prefix, from_height, to_height)
//   blockchain.rpa.get_mempool(prefix)
// The server advertises `server.features.rpa` (prefix_bits_min,
// history_block_limit, starting_height).
//
// The cryptography (paycode encoding, ECDH, CKDpub, trial decryption,
// spending-key derivation, prefix grinding) lives in `bch-rpa`; this module
// owns the wallet wiring: HD derivation, Fulcrum paging, raw-tx parsing and
// match records.

import {
    decodePaycode,
    deriveRpaKeys,
    deriveSpendingKey,
    encodePaycode,
    generatePaycode,
    getScanPrefix,
    grindPrefix,
    isGrindingAvailable,
    parseRawTransaction,
    prepareSend,
    tryTransaction,
} from 'bch-rpa'
import { binToHex, secp256k1 } from '@bitauth/libauth'
import { hdNodeFromEntropy } from '../bch/crypto.js'
import { ElectrumMethods } from '../bch/provider.js'

export const RPA_CHAIN_INDEX = 3
export const RPA_SCAN_INDEX = 0
export const RPA_SPEND_INDEX = 1
export const DEFAULT_PREFIX_SIZE = 8
export const DEFAULT_BLOCK_LIMIT = 60

/**
 * Derive the CashCode scan/spend keys from the wallet entropy.
 *
 * The Selene standard is account/3/0' (scan) and account/3/1' (spend).
 *
 * @param {object} params
 * @param {string} params.entropyHex - the wallet's 32-byte BIP39 entropy
 * @param {number} [params.accountIndex=0] - BIP44 account index
 * @returns {{ scanPrivateKey: Uint8Array, scanPubkey: Uint8Array, spendPrivateKey: Uint8Array, spendPubkey: Uint8Array, scanPath: string, spendPath: string }}
 */
export function deriveCashCodeKeys({ entropyHex, accountIndex = 0 }) {
    if (!Number.isInteger(accountIndex) || accountIndex < 0) {
        throw new Error('cashcode: accountIndex must be a non-negative integer')
    }

    const accountPath = `m/44'/145'/${accountIndex}'`
    const masterNode = hdNodeFromEntropy(entropyHex)
    const scanPath = `${accountPath}/${RPA_CHAIN_INDEX}/${RPA_SCAN_INDEX}'`
    const spendPath = `${accountPath}/${RPA_CHAIN_INDEX}/${RPA_SPEND_INDEX}'`
    const scanNode = masterNode.derive(scanPath)
    const spendNode = masterNode.derive(spendPath)

    return {
        scanPrivateKey: scanNode.privateKey,
        scanPubkey: scanNode.publicKey,
        spendPrivateKey: spendNode.privateKey,
        spendPubkey: spendNode.publicKey,
        scanPath,
        spendPath,
    }
}

/**
 * Build a CashCode from the account's scan/spend keys.
 *
 * @param {object} params
 * @param {object} params.keys - deriveCashCodeKeys() output
 * @param {number} [params.prefixSize=8] - 0, 4, 8, 12, or 16 bits
 * @param {number} [params.expiry=0] - Unix seconds; 0 = none
 * @param {string} [params.network='mainnet'] - 'mainnet' | 'chipnet'
 * @returns {{ paycode: object, encoded: string, scanPrefix: string }}
 */
export function createCashCode({ keys, prefixSize = DEFAULT_PREFIX_SIZE, expiry = 0, network = 'mainnet' }) {
    const testnet = network !== 'mainnet'
    const paycode = generatePaycode(keys.scanPubkey, keys.spendPubkey, { prefixSize, expiry, testnet })

    return {
        paycode,
        encoded: encodePaycode(paycode),
        scanPrefix: getScanPrefix(paycode),
    }
}

/**
 * Decode a `cashcode:`/`cashcodetest:` string.
 *
 * @param {string} encoded
 * @returns {object} the Paycode
 */
export function decodeCashCode(encoded) {
    return decodePaycode(encoded)
}

/**
 * Derive the one-time payment destination(s) for a CashCode.
 *
 * The designated input's private key supplies the ECDH material; the input
 * must remain among the transaction's first 30 inputs (bch-rpa/README).
 *
 * @param {object} params
 * @param {object} params.paycode
 * @param {{ privkey: Uint8Array, outpointTxid: string, outpointIndex: number }} params.input
 * @param {number} [params.outputCount=1]
 * @returns {Array<object>} RpaPaymentAddress records
 */
export function prepareCashCodePayment({ paycode, input, outputCount = 1 }) {
    return prepareSend(paycode, input, outputCount)
}

/**
 * Grind a designated input's signature until the serialized input's
 * double-SHA256 matches the paycode's scan prefix.
 *
 * The callback must DER-encode the 64-byte compact signature (r || s) and
 * append the sighash byte before serializing the input; the returned
 * signature is the matching compact form.
 *
 * @param {object} params
 * @param {object} params.paycode
 * @param {Uint8Array} params.inputPrivateKey
 * @param {Uint8Array} params.sigHash - 32-byte BCH sighash
 * @param {(signature: Uint8Array) => Uint8Array} params.serializeInput
 * @param {number} [params.maxIterations=1000000]
 * @returns {Promise<{ signature: Uint8Array, iterations: number }|null>}
 */
export function grindCashCodeSignature({ paycode, inputPrivateKey, sigHash, serializeInput, maxIterations = 1000000 }) {
    return grindPrefix(paycode, inputPrivateKey, sigHash, serializeInput, maxIterations)
}

/**
 * Whether prefix grinding is available (the @noble/secp256k1 peer).
 *
 * @returns {Promise<boolean>}
 */
export function isCashCodeGrindingAvailable() {
    return isGrindingAvailable()
}

/**
 * Fetch the current chain tip height from Fulcrum.
 *
 * @param {object} cluster - FulcrumCluster
 * @returns {Promise<number>}
 */
async function getTipHeight(cluster) {
    const header = await cluster.request(ElectrumMethods.subscribeHeaders)

    if (!header || !Number.isInteger(Number(header.height))) {
        throw new Error('cashcode: Fulcrum did not return a block height')
    }

    return Number(header.height)
}

/**
 * Discover CashCode payments through Fulcrum's RPA index.
 *
 * Confirmed history is paged in `blockLimit` chunks (the server's
 * `history_block_limit`; default 60), then the mempool is queried. Each
 * candidate raw transaction is parsed and trial-decrypted with the account's
 * scan key; every matching output yields its spending key.
 *
 * @param {object} params
 * @param {object} params.cluster - FulcrumCluster
 * @param {object} params.keys - deriveCashCodeKeys() output
 * @param {object} params.paycode - createCashCode().paycode / decodeCashCode()
 * @param {number} [params.fromHeight=0] - wallet creation height
 * @param {number} [params.toHeight=-1] - -1 = chain tip
 * @param {number} [params.blockLimit=60] - Fulcrum history_block_limit
 * @param {(progress: object) => void} [params.onProgress]
 * @returns {Promise<{ prefix: string, fromHeight: number, toHeight: number, transactions: number, matches: Array<object> }>}
 */
export async function scanCashCode({ cluster, keys, paycode, fromHeight = 0, toHeight = -1, blockLimit = DEFAULT_BLOCK_LIMIT, onProgress = null }) {
    if (!cluster || typeof cluster.rpaGetHistory !== 'function' || typeof cluster.rpaGetMempool !== 'function') {
        throw new Error('cashcode: cluster must expose the Fulcrum RPA methods')
    }

    const prefix = getScanPrefix(paycode)
    const testnet = paycode.version === 5
    const tip = toHeight < 0 ? await getTipHeight(cluster) : toHeight
    const candidates = new Map()

    for (let start = fromHeight; start <= tip; start += blockLimit) {
        const end = Math.min(start + blockLimit - 1, tip)
        const page = await cluster.rpaGetHistory(prefix, start, end)

        for (const item of page || []) {
            candidates.set(item.tx_hash, item.height)
        }
    }

    for (const item of (await cluster.rpaGetMempool(prefix)) || []) {
        if (!candidates.has(item.tx_hash)) {
            candidates.set(item.tx_hash, 0)
        }
    }

    const matches = []
    let index = 0

    for (const [txid, height] of candidates) {
        index += 1

        const raw = await cluster.getTransaction(txid)
        const tx = parseRawTransaction(raw, testnet)
        const txMatches = tryTransaction(tx, keys.scanPrivateKey, keys.spendPubkey, testnet)

        for (const match of txMatches) {
            for (let i = 0; i < match.outputIndices.length; i++) {
                const outputIndex = match.outputIndices[i]
                const childIndex = match.childIndices[i]
                const output = tx.outputs[outputIndex]
                const spendingKey = deriveSpendingKey(keys.spendPrivateKey, match.sharedSecret, childIndex)
                const spendingPubkey = secp256k1.derivePublicKeyCompressed(spendingKey)

                matches.push({
                    txid,
                    height,
                    inputIndex: match.inputIndex,
                    outputIndex,
                    childIndex,
                    address: output ? output.address : '',
                    valueSatoshis: output ? output.value : 0n,
                    spendingKeyHex: binToHex(spendingKey),
                    spendingPubkeyHex: typeof spendingPubkey === 'string' ? '' : binToHex(spendingPubkey),
                })
            }
        }

        if (onProgress) {
            onProgress({ txid, index, total: candidates.size, matches: matches.length })
        }
    }

    return {
        prefix,
        fromHeight,
        toHeight: tip,
        transactions: candidates.size,
        matches,
    }
}
