/* Unit tests for the CashCode wallet integration (lib/cashaccount/cashcode.js).
 *
 * Real bch-rpa cryptography (key derivation, paycode encoding, ECDH, trial
 * decryption, spending-key derivation, prefix grinding) with a mocked
 * Fulcrum RPA index. The key derivation is cross-checked against libauth's
 * BIP32 implementation (the one bch-rpa itself uses).
 */
import { describe, expect, it, vi } from 'vitest'
import {
    binToHex,
    cashAddressToLockingBytecode,
    deriveHdPath,
    deriveHdPrivateNodeFromSeed,
    encodeDataPush,
    encodeTransaction,
    hexToBin,
    publicKeyToP2pkhCashAddress,
    secp256k1,
    sha256,
} from '@bitauth/libauth'
import { deriveRpaKeys } from 'bch-rpa'

import {
    createCashCode,
    decodeCashCode,
    deriveCashCodeKeys,
    grindCashCodeSignature,
    isCashCodeGrindingAvailable,
    prepareCashCodePayment,
    scanCashCode,
} from '@/lib/cashaccount/cashcode.js'
import { mnemonicFromEntropy, seedFromMnemonic } from '@/lib/bch/crypto.js'

/* bch-rpa's public interop fixtures (test/fixtures.ts). */
const SCAN_PRIVKEY = hexToBin('0000000000000000000000000000000000000000000000000000000000000007')
const SPEND_PRIVKEY = hexToBin('000000000000000000000000000000000000000000000000000000000000000d')
const SENDER_PRIVKEY = hexToBin('0000000000000000000000000000000000000000000000000000000000000025')
const SENDER_PUBKEY = secp256k1.derivePublicKeyCompressed(SENDER_PRIVKEY)
const OUTPOINT_TXID = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
const CHANGE_ADDRESS = 'bitcoincash:qr7fzmep8g7h7ymfxy74lgc0v950j3r2959lhtxxsl'
const ENTROPY_HEX = '0f'.repeat(32)

const buildRawPaymentTx = (payment) => {
    const transaction = {
        version: 1,
        inputs: [{
            outpointTransactionHash: hexToBin(OUTPOINT_TXID),
            outpointIndex: 0,
            sequenceNumber: 0xffffffff,
            unlockingBytecode: new Uint8Array([
                ...encodeDataPush(new Uint8Array(64)),
                ...encodeDataPush(SENDER_PUBKEY),
            ]),
        }],
        outputs: [{
            lockingBytecode: cashAddressToLockingBytecode(payment.address).bytecode,
            valueSatoshis: 100000n,
        }, {
            lockingBytecode: cashAddressToLockingBytecode(CHANGE_ADDRESS).bytecode,
            valueSatoshis: 50000n,
        }],
        locktime: 0,
    }

    return binToHex(encodeTransaction(transaction))
}

describe('cashaccount/cashcode — HD derivation', () => {
    it('matches libauth BIP32 at m/44\'/145\'/0\'/3/0\' and /3/1\'', () => {
        const keys = deriveCashCodeKeys({ entropyHex: ENTROPY_HEX })
        const seed = seedFromMnemonic(mnemonicFromEntropy(ENTROPY_HEX))
        const root = deriveHdPrivateNodeFromSeed(seed)
        const account = deriveHdPath(root, "m/44'/145'/0'")

        expect(typeof root).not.toBe('string')
        expect(typeof account).not.toBe('string')

        const reference = deriveRpaKeys(account)

        expect(binToHex(keys.scanPubkey)).toBe(binToHex(reference.scanPubkey))
        expect(binToHex(keys.spendPubkey)).toBe(binToHex(reference.spendPubkey))
        expect(binToHex(keys.scanPrivateKey)).toBe(binToHex(reference.scanPrivkey))
        expect(binToHex(keys.spendPrivateKey)).toBe(binToHex(reference.spendPrivkey))
        expect(keys.scanPath).toBe("m/44'/145'/0'/3/0'")
        expect(keys.spendPath).toBe("m/44'/145'/0'/3/1'")
    })

    it('is deterministic and honours the account index', () => {
        const first = deriveCashCodeKeys({ entropyHex: ENTROPY_HEX })
        const second = deriveCashCodeKeys({ entropyHex: ENTROPY_HEX })
        const other = deriveCashCodeKeys({ entropyHex: ENTROPY_HEX, accountIndex: 1 })

        expect(binToHex(first.scanPubkey)).toBe(binToHex(second.scanPubkey))
        expect(binToHex(first.scanPubkey)).not.toBe(binToHex(other.scanPubkey))
        expect(other.scanPath).toBe("m/44'/145'/1'/3/0'")
    })
})

describe('cashaccount/cashcode — paycode encoding', () => {
    const keys = deriveCashCodeKeys({ entropyHex: ENTROPY_HEX })

    it('creates and decodes a mainnet CashCode', () => {
        const { paycode, encoded, scanPrefix } = createCashCode({ keys, prefixSize: 8 })

        expect(encoded.startsWith('cashcode:')).toBe(true)
        expect(scanPrefix).toHaveLength(2)
        expect(paycode.version).toBe(1)

        const decoded = decodeCashCode(encoded)
        expect(decoded.prefixSize).toBe(8)
        expect(binToHex(decoded.scanPubkey)).toBe(binToHex(keys.scanPubkey))
        expect(binToHex(decoded.spendPubkey)).toBe(binToHex(keys.spendPubkey))
    })

    it('creates a testnet CashCode with the cashcodetest prefix', () => {
        const { paycode, encoded } = createCashCode({ keys, network: 'chipnet' })

        expect(encoded.startsWith('cashcodetest:')).toBe(true)
        expect(paycode.version).toBe(5)
    })
})

describe('cashaccount/cashcode — sending', () => {
    const keys = deriveCashCodeKeys({ entropyHex: ENTROPY_HEX })
    const paycode = createCashCode({ keys }).paycode
    const input = {
        privkey: SENDER_PRIVKEY,
        outpointTxid: OUTPOINT_TXID,
        outpointIndex: 0,
    }

    it('derives a deterministic one-time address', () => {
        const first = prepareCashCodePayment({ paycode, input })
        const second = prepareCashCodePayment({ paycode, input })

        expect(first).toHaveLength(1)
        expect(first[0].address).toBe(second[0].address)
        expect(first[0].address.startsWith('bitcoincash:q')).toBe(true)
        expect(first[0].childIndex).toBe(0)
        expect(first[0].sharedSecret).toHaveLength(32)
    })

    it('derives multiple child addresses and changes with the outpoint', () => {
        const multiple = prepareCashCodePayment({ paycode, input, outputCount: 3 })
        const other = prepareCashCodePayment({
            paycode,
            input: { ...input, outpointIndex: 1 },
        })

        expect(multiple).toHaveLength(3)
        expect(new Set(multiple.map((payment) => payment.address)).size).toBe(3)
        expect(multiple[0].address).not.toBe(other[0].address)
    })
})

describe('cashaccount/cashcode — Fulcrum RPA scanning', () => {
    const keys = deriveCashCodeKeys({ entropyHex: ENTROPY_HEX })
    const paycode = createCashCode({ keys }).paycode
    const payment = prepareCashCodePayment({
        paycode,
        input: {
            privkey: SENDER_PRIVKEY,
            outpointTxid: OUTPOINT_TXID,
            outpointIndex: 0,
        },
    })[0]
    const rawTx = buildRawPaymentTx(payment)

    it('pages confirmed history, queries the mempool and derives the spending key', async () => {
        const cluster = {
            rpaGetHistory: vi.fn(async () => [{ tx_hash: 'aa'.repeat(32), height: 100 }]),
            rpaGetMempool: vi.fn(async () => []),
            getTransaction: vi.fn(async () => rawTx),
        }

        const onProgress = vi.fn()

        const result = await scanCashCode({
            cluster,
            keys,
            paycode,
            fromHeight: 0,
            toHeight: 200,
            blockLimit: 60,
            onProgress,
        })

        expect(cluster.rpaGetHistory).toHaveBeenCalledTimes(4)
        expect(cluster.rpaGetHistory).toHaveBeenNthCalledWith(1, result.prefix, 0, 59)
        expect(cluster.rpaGetHistory).toHaveBeenNthCalledWith(2, result.prefix, 60, 119)
        expect(cluster.rpaGetHistory).toHaveBeenNthCalledWith(3, result.prefix, 120, 179)
        expect(cluster.rpaGetHistory).toHaveBeenNthCalledWith(4, result.prefix, 180, 200)
        expect(cluster.rpaGetMempool).toHaveBeenCalledWith(result.prefix)
        expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ index: 1, total: 1 }))

        expect(result.transactions).toBe(1)
        expect(result.matches).toHaveLength(1)

        const [match] = result.matches
        expect(match.txid).toBe('aa'.repeat(32))
        expect(match.height).toBe(100)
        expect(match.outputIndex).toBe(0)
        expect(match.address).toBe(payment.address)
        expect(match.valueSatoshis).toBe(100000n)
        expect(match.spendingKeyHex).toHaveLength(64)

        const derivedAddress = publicKeyToP2pkhCashAddress({
            publicKey: hexToBin(match.spendingPubkeyHex),
            prefix: 'bitcoincash',
        }).address

        expect(derivedAddress).toBe(payment.address)
    })

    it('deduplicates a transaction returned by both history and mempool', async () => {
        const cluster = {
            rpaGetHistory: vi.fn(async () => [{ tx_hash: 'bb'.repeat(32), height: 50 }]),
            rpaGetMempool: vi.fn(async () => [{ tx_hash: 'bb'.repeat(32), height: 0 }]),
            getTransaction: vi.fn(async () => rawTx),
        }

        const result = await scanCashCode({
            cluster,
            keys,
            paycode,
            fromHeight: 50,
            toHeight: 50,
            blockLimit: 60,
        })

        expect(cluster.getTransaction).toHaveBeenCalledTimes(1)
        expect(result.matches[0].height).toBe(50)
    })

    it('reads the tip from the headers subscription when toHeight is -1', async () => {
        const cluster = {
            request: vi.fn(async () => ({ height: 50 })),
            rpaGetHistory: vi.fn(async () => []),
            rpaGetMempool: vi.fn(async () => []),
            getTransaction: vi.fn(),
        }

        const result = await scanCashCode({
            cluster,
            keys,
            paycode,
            fromHeight: 50,
            blockLimit: 60,
        })

        expect(cluster.request).toHaveBeenCalledWith('blockchain.headers.subscribe')
        expect(cluster.rpaGetHistory).toHaveBeenCalledWith(result.prefix, 50, 50)
        expect(result.toHeight).toBe(50)
        expect(result.transactions).toBe(0)
    })

    it('rejects a cluster without the RPA methods', async () => {
        await expect(scanCashCode({ cluster: {}, keys, paycode })).rejects.toThrow(/RPA methods/)
    })
})

describe('cashaccount/cashcode — prefix grinding', () => {
    const keys = deriveCashCodeKeys({ entropyHex: ENTROPY_HEX })

    it('reports the @noble/secp256k1 peer as available', async () => {
        expect(await isCashCodeGrindingAvailable()).toBe(true)
    })

    it('grinds a 4-bit prefix and returns a matching compact signature', async () => {
        const { paycode, scanPrefix } = createCashCode({ keys, prefixSize: 4 })
        const sigHash = sha256.hash(new Uint8Array(32))

        const result = await grindCashCodeSignature({
            paycode,
            inputPrivateKey: SENDER_PRIVKEY,
            sigHash,
            serializeInput: (signature) => signature,
        })

        expect(result).not.toBeNull()
        expect(result.iterations).toBeGreaterThan(0)
        expect(result.signature).toHaveLength(64)

        const hash = sha256.hash(sha256.hash(result.signature))
        expect(binToHex(hash).slice(0, scanPrefix.length)).toBe(scanPrefix)
    })
})

describe('cashaccount/cashcode — fixture key sanity', () => {
    it('uses the bch-rpa interop keys', () => {
        expect(binToHex(secp256k1.derivePublicKeyCompressed(SCAN_PRIVKEY))).toHaveLength(66)
        expect(binToHex(secp256k1.derivePublicKeyCompressed(SPEND_PRIVKEY))).toHaveLength(66)
    })
})
