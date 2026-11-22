/* Unit tests for the smaller lib/store helpers:
 *   - src/lib/bch/discovery.js   (gap scan, both branches)
 *   - src/store/modules/utils/getters/getFormattedValue.js
 *   - src/lib/solana.js          (SLIP-0010 derivation + RPC balance)
 *   - src/store/modules/concierge/getters/getParsedInfo.js
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { scanBranch, DISCOVERY_BATCH, DISCOVERY_MAX_BATCHES } from '@/lib/bch/discovery.js'
import getFormattedValue from '@/store/modules/utils/getters/getFormattedValue'
import { solanaAccountFromEntropy, fetchSolBalance, SOLANA_RPC } from '@/lib/solana.js'
import getParsedInfo from '@/store/modules/concierge/getters/getParsedInfo'
import { derivePath, hdNodeFromEntropy, toCashAddress } from '@/lib/bch/crypto.js'

const ENTROPY = 'ab'.repeat(32)
const hdNode = hdNodeFromEntropy(ENTROPY)
const PATH_BASE = "m/44'/145'/0'"

/* A cluster whose getHistory reports the given addresses as USED. */
const fakeCluster = (used) => ({
    getHistory: vi.fn(async (address) => (used.includes(address) ? [{ tx_hash: 'aa' }] : [])),
})

const addr = (branch, index) => toCashAddress(derivePath(hdNode, `${PATH_BASE}/${branch}/${index}`), 'mainnet')

describe('lib/bch/discovery', () => {
    it('returns -1 for a completely unused chain', async () => {
        const cluster = fakeCluster([])

        const last = await scanBranch({ hdNode, pathBase: PATH_BASE, branch: 0, network: 'mainnet', cluster })

        expect(last).toBe(-1)
        expect(cluster.getHistory).toHaveBeenCalledTimes(DISCOVERY_BATCH)
    })

    it('finds the highest used index on branch 0', async () => {
        const cluster = fakeCluster([addr(0, 0), addr(0, 3)])

        const last = await scanBranch({ hdNode, pathBase: PATH_BASE, branch: 0, network: 'mainnet', cluster })

        expect(last).toBe(3)
    })

    it('finds used indexes on the BIP44 change branch (branch 1)', async () => {
        const cluster = fakeCluster([addr(1, 2)])

        const last = await scanBranch({ hdNode, pathBase: PATH_BASE, branch: 1, network: 'mainnet', cluster })

        expect(last).toBe(2)
    })

    it('applies the gap limit: a used index beyond a fully-empty batch is NOT found', async () => {
        /* Index 12 is used, but 0-9 are all empty -> the scan stops there
           (BIP44 gap limit — this is the documented bound, not a bug). */
        const cluster = fakeCluster([addr(0, 12)])

        const last = await scanBranch({ hdNode, pathBase: PATH_BASE, branch: 0, network: 'mainnet', cluster })

        expect(last).toBe(-1)
        expect(cluster.getHistory).toHaveBeenCalledTimes(DISCOVERY_BATCH)
    })

    it('continues into the next batch when the current one has usage', async () => {
        /* 0-9 has index 9 used -> batch 2 (10-19) is scanned and finds 15. */
        const cluster = fakeCluster([addr(0, 9), addr(0, 15)])

        const last = await scanBranch({ hdNode, pathBase: PATH_BASE, branch: 0, network: 'mainnet', cluster })

        expect(last).toBe(15)
        /* Batch 1 used, batch 2 used, batch 3 empty. */
        expect(cluster.getHistory).toHaveBeenCalledTimes(DISCOVERY_BATCH * 3)
    })

    it('treats a FAILED probe as unused (a flaky server cannot abort the scan)', async () => {
        const cluster = {
            getHistory: vi.fn(async (address) => {
                if (address === addr(0, 0)) throw new Error('quorum failed')

                return address === addr(0, 1) ? [{ tx_hash: 'aa' }] : []
            }),
        }

        const last = await scanBranch({ hdNode, pathBase: PATH_BASE, branch: 0, network: 'mainnet', cluster })

        expect(last).toBe(1)
    })

    it('is bounded by DISCOVERY_MAX_BATCHES', async () => {
        /* Every address "used" -> the scan must still stop at the bound. */
        const cluster = { getHistory: vi.fn(async () => [{ tx_hash: 'aa' }]) }

        const last = await scanBranch({ hdNode, pathBase: PATH_BASE, branch: 0, network: 'mainnet', cluster })

        expect(cluster.getHistory).toHaveBeenCalledTimes(DISCOVERY_BATCH * DISCOVERY_MAX_BATCHES)
        expect(last).toBe(DISCOVERY_BATCH * DISCOVERY_MAX_BATCHES - 1)
    /* 200 real HD derivations: ~7.3 s alone, >20 s under parallel load (the
       VM flake from the 2026-11-22 session) — 60 s headroom, zero logic change. */
    }, 60000)
})


describe('utils/getFormattedValue', () => {
    const format = (sats, price, currency) => getFormattedValue()(sats, price, currency)

    it('keeps satoshis below 100 in sats', () => {
        const out = format(42, null, 'USD')

        expect(out.unit).toBe('sats')
        expect(out.value).toBe(42)
        expect(out.satoshis).toBe(42)
    })

    it('scales to bits / mBCH / BCH', () => {
        expect(format(100000, null, 'USD').unit).toBe('mBCH')
        expect(format(1000, null, 'USD').unit).toBe('bits')
        expect(format(1000, null, 'USD').value).toBe(10)
        expect(format(100000000, null, 'USD').unit).toBe('BCH')
        expect(format(100000000, null, 'USD').value).toBe(1)
    })

    it('shows at least 4 decimals, up to 8 (trailing zeros trimmed to 4)', () => {
        /* 1234 sats = 12.34 bits -> "12.3400" */
        expect(format(1234, null, 'USD').rounded).toBe('12.3400')

        /* 1 BCH -> "1.0000" */
        expect(format(100000000, null, 'USD').rounded).toBe('1.0000')

        /* Exact 8-decimal precision is preserved when present. */
        expect(format(123456789, null, 'USD').rounded).toBe('1.23456789')
    })

    it('converts to fiat when a market price is available', () => {
        const out = format(100000000, 50000, 'USD')

        expect(out.fiat).toBe('$500.00 USD')
    })

    it('returns a null fiat (never $0.00) without a market price', () => {
        expect(format(100000000, null, 'USD').fiat).toBeNull()
        expect(format(100000000, 0, 'USD').fiat).toBeNull()
    })

    it('honours the requested currency code', () => {
        expect(format(100000000, 50000, 'EUR').fiat).toContain('EUR')
    })
})

describe('lib/solana', () => {
    it('derives a deterministic Ed25519 account from the wallet entropy', () => {
        const one = solanaAccountFromEntropy(ENTROPY)
        const two = solanaAccountFromEntropy(ENTROPY)

        expect(one.address).toBe(two.address)
        expect(one.address.length).toBeGreaterThan(30)
        expect(one.publicKey.length).toBe(32)
        expect(one.privateKey.length).toBe(32)
    })

    it('derives a DIFFERENT account for a different account index', () => {
        expect(solanaAccountFromEntropy(ENTROPY, 1).address)
            .not.toBe(solanaAccountFromEntropy(ENTROPY, 0).address)
    })

    it('reads the lamport balance from the RPC', async () => {
        const fetchMock = vi.fn(async () => ({
            json: async () => ({ result: { value: 2500000000 } }),
        }))
        vi.stubGlobal('fetch', fetchMock)

        await expect(fetchSolBalance('addr')).resolves.toBe(2.5)
        expect(fetchMock).toHaveBeenCalledWith(SOLANA_RPC, expect.objectContaining({ method: 'POST' }))

        vi.unstubAllGlobals()
    })

    it('returns 0 when the RPC fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

        await expect(fetchSolBalance('addr')).resolves.toBe(0)

        vi.unstubAllGlobals()
    })

    it('returns 0 when the response has no numeric value', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) })))

        await expect(fetchSolBalance('addr')).resolves.toBe(0)

        vi.unstubAllGlobals()
    })
})

describe('concierge/getParsedInfo', () => {
    it('decodes a base64 JSON payload', () => {
        const payload = { outputs: [{ value: 1000, address: 'bitcoincash:qqq' }], data: 'x', donation: 1, expires: 2 }
        const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')

        const info = getParsedInfo()(b64)

        expect(info).toEqual(payload)
    })

    it('decodes a null-padded payload (trailing zero bytes)', () => {
        const payload = { outputs: [{ value: 5, address: 'a' }], data: 'd', donation: 0, expires: 0 }
        const raw = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.alloc(8)])
        const b64 = raw.toString('base64')

        const info = getParsedInfo()(b64)

        expect(info.outputs[0].value).toBe(5)
    })

    it('returns null for undecodable input', () => {
        expect(getParsedInfo()('bm90LWpzb24=')).toBeNull()
    })
})
