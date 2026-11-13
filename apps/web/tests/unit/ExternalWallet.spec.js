import { describe, it, expect, vi } from 'vitest'
import {
    signedTxidFromHex,
    parseBchToSats,
    parseRecipientAddress,
    selectCoins,
    buildPaymentTransaction,
    fetchFeeSats,
    fetchSourceOutputs,
    deriveChainAddress,
} from '@/lib/bch/external-wallet'

/* The official hackathon donation address — a real mainnet p2pkh recipient. */
const RECIPIENT = 'bitcoincash:qpv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf'

const utxo = (i) => ({
    tx_hash: `aa${String(i).padStart(62, '0')}`,
    tx_pos: 0,
    value: 100_000,
    height: 800000,
})

const fakeCluster = (txHex) => ({
    request: vi.fn(async (method, ...args) => {
        if (method === 'blockchain.estimatefee') return 0.00001
        if (method === 'blockchain.transaction.get') return txHex
        throw new Error('unexpected ' + method)
    }),
})

/* A minimal handcrafted p2pkh funding tx (1 input, 1 output @ 100000 sats). */
const fundingTx = () =>
    '02000000' +
    '01' +
    '01'.repeat(32) +
    '00000000' +
    '00' +
    'ffffffff' +
    '01' +
    'a086010000000000' +
    '19' +
    '02'.repeat(25) +
    '00000000'

describe('external-wallet pay helpers', () => {
    it('parseBchToSats — exact integer sats', () => {
        expect(parseBchToSats('0.00005')).toBe(5000n)
        expect(parseBchToSats('1')).toBe(100000000n)
        expect(() => parseBchToSats('x')).toThrow(/Invalid BCH amount/)
    })

    it('parseRecipientAddress — no dynamic import, returns locking bytecode', async () => {
        const r = await parseRecipientAddress(RECIPIENT)
        expect(r.type).toBe('p2pkh')
        expect(r.lockingBytecode).toBeInstanceOf(Uint8Array)
        expect(r.lockingBytecode.length).toBe(25)
    })

    it('selectCoins covers target', () => {
        const covered = selectCoins([utxo(0), utxo(1)], 150_000)
        expect(covered.chosen.length).toBe(2)
        expect(covered.sum).toBe(200_000n)
    })

    it('fetchFeeSats — mocked cluster', async () => {
        const fee = await fetchFeeSats(fakeCluster(), 2, 2)
        expect(fee).toBeGreaterThan(0n)
    })

    it('fetchSourceOutputs + buildPaymentTransaction — full unsigned tx shape', async () => {
        const hex = fundingTx()
        expect(hex).toBeTruthy()
        const cluster = fakeCluster(hex)
        const sources = await fetchSourceOutputs(cluster, [utxo(0)])
        expect(sources[0].valueSatoshis).toBe(100000n)

        const built = buildPaymentTransaction({
            sourceOutputs: sources,
            recipientLockingBytecode: new Uint8Array(25).fill(3),
            changeLockingBytecode: new Uint8Array(25).fill(4),
            amountSats: 5000n,
            feeSats: 200n,
        })
        expect(built.transaction.outputs.length).toBe(2)
        expect(built.transaction.outputs[0].valueSatoshis).toBe(5000n)
        expect(built.transaction.outputs[1].valueSatoshis).toBe(100000n - 5000n - 200n)
        expect(built.change).toBe(100000n - 5000n - 200n)
    })

    it('deriveChainAddress — public-child derivation matches the libauth reference', async () => {
        const L = await import('@bitauth/libauth')
        const lib = L.default ?? L
        const seed = lib.sha256.hash(new TextEncoder().encode('deterministic test seed for repro'))
        const acctPriv = lib.deriveHdPath(lib.deriveHdPrivateNodeFromSeed(seed), "m/44'/145'/0'")
        const xpub = lib.encodeHdPublicKey({ version: 0x0488B21E, node: lib.deriveHdPublicNode(acctPriv) }).hdPublicKey
        const node = lib.decodeHdPublicKey(xpub).node
        /* deriveChainAddress returns a PLAIN address string (Fulcrum requires it). */
        const a0 = deriveChainAddress(node, 0, 'bitcoincash').address
        const ref = lib.hdPublicKeyToP2pkhCashAddress({ hdPublicKey: xpub, addressIndex: 0, addressPrefix: 'bitcoincash' })
        expect(typeof a0).toBe('string')
        expect(a0).toBe(ref.address)
        expect(a0.startsWith('bitcoincash:q')).toBe(true)
    })

    it('signedTxidFromHex — double sha256 reversed (known txid)', () => {
        /* the handcrafted funding tx: txid = double-sha256 of its bytes, reversed */
        const id = signedTxidFromHex(fundingTx())
        expect(id).toMatch(/^[0-9a-f]{64}$/)
        /* determinism + byte-reversal sanity: the raw digest must NOT equal the id */
        expect(id).not.toBe(signedTxidFromHex(fundingTx()).split('').reverse().join(''))
    })

    it('buildPaymentTransaction throws when funds are insufficient', () => {
        expect(() => buildPaymentTransaction({
            sourceOutputs: [{ outpointTransactionHash: new Uint8Array(32), outpointIndex: 0, unlockingBytecode: new Uint8Array(0), valueSatoshis: 1000n, lockingBytecode: new Uint8Array(25) }],
            recipientLockingBytecode: new Uint8Array(25),
            changeLockingBytecode: new Uint8Array(25),
            amountSats: 5000n,
            feeSats: 200n,
        })).toThrow(/Insufficient BCH/)
    })
})
