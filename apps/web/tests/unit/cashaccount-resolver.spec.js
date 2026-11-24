/* Unit tests for the CashAccounts resolver (lib/cashaccount/resolver.js).
 *
 * ChainGraph is mocked at the module boundary; the transaction fixture is
 * the REAL mainnet registration 8267bff0… ("Kallisti"). The tests pin the
 * genesis invariant, category resolution, identifier matching and the
 * dispatch helper.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cashaccount/chaingraph.js', () => ({
    getTransaction: vi.fn(),
    getCategoryOutputs: vi.fn(),
    loadAllRegistrations: vi.fn(),
}))

import {
    getCategoryOutputs,
    getTransaction,
    loadAllRegistrations,
} from '@/lib/cashaccount/chaingraph.js'
import {
    accountFromRegistration,
    loadRegistrationAccounts,
    resolveAccount,
    resolveByCategory,
    resolveByIdentifier,
    resolveByTxid,
    shortCategory,
} from '@/lib/cashaccount/resolver.js'
import { KALLISTI_CATEGORY, KALLISTI_TX } from '../fixtures/cashaccount-kallisti.js'

beforeEach(() => {
    vi.clearAllMocks()
    getTransaction.mockResolvedValue(KALLISTI_TX)
    getCategoryOutputs.mockResolvedValue([{
        outputIndex: 0,
        nftCapability: 'mutable',
        transaction: KALLISTI_TX,
    }])
    loadAllRegistrations.mockResolvedValue([KALLISTI_TX])
})

describe('cashaccount/resolver — by txid / category', () => {
    it('resolves the live registration by txid', async () => {
        const account = await resolveByTxid(KALLISTI_TX.hash)

        expect(account.identifier).toBe('Kallisti#7B9A')
        expect(account.category).toBe(KALLISTI_CATEGORY)
    })

    it('throws when the txid is unknown', async () => {
        getTransaction.mockResolvedValueOnce(null)
        await expect(resolveByTxid('00'.repeat(32))).rejects.toThrow(/not found/)
    })

    it('resolves the genesis output by category and skips non-genesis candidates', async () => {
        const broken = {
            ...KALLISTI_TX,
            inputs: [{ ...KALLISTI_TX.inputs[0], outpointTransactionHash: '11'.repeat(32) }],
        }
        getCategoryOutputs.mockResolvedValueOnce([
            { outputIndex: 0, nftCapability: 'mutable', transaction: broken },
            { outputIndex: 0, nftCapability: 'mutable', transaction: KALLISTI_TX },
        ])

        const account = await resolveByCategory(KALLISTI_CATEGORY)

        expect(account.category).toBe(KALLISTI_CATEGORY)
    })

    it('throws when no candidate is the genesis', async () => {
        getCategoryOutputs.mockResolvedValueOnce([{ outputIndex: 0, nftCapability: 'mutable', transaction: { ...KALLISTI_TX, outputs: [] } }])
        await expect(resolveByCategory(KALLISTI_CATEGORY)).rejects.toThrow(/no registration/)
    })
})

describe('cashaccount/resolver — identifier lookup', () => {
    it('loads every registration and assigns identifiers', async () => {
        const accounts = await loadRegistrationAccounts()

        expect(accounts).toHaveLength(1)
        expect(accounts[0].identifier).toBe('Kallisti#7B9A')
        expect(accounts[0].minimal).toBe(true)
    })

    it('skips malformed registrations in the prefix scan', async () => {
        loadAllRegistrations.mockResolvedValueOnce([{ ...KALLISTI_TX, outputs: [] }, KALLISTI_TX])
        const accounts = await loadRegistrationAccounts()

        expect(accounts).toHaveLength(1)
    })

    it('resolves a Minimal Identifier', async () => {
        const account = await resolveByIdentifier('Kallisti#7B9A')
        expect(account.category).toBe(KALLISTI_CATEGORY)
    })

    it('rejects an unknown identifier and a malformed one', async () => {
        await expect(resolveByIdentifier('Kallisti#FFFF')).rejects.toThrow(/no registration/)
        await expect(resolveByIdentifier('not an identifier')).rejects.toThrow(/not a CashAccount/)
    })
})

describe('cashaccount/resolver — resolveAccount dispatch', () => {
    it('routes identifiers, txids, and categories', async () => {
        expect((await resolveAccount({ identifier: 'Kallisti#7B9A' })).category).toBe(KALLISTI_CATEGORY)
        expect((await resolveAccount({ identifier: KALLISTI_TX.hash })).category).toBe(KALLISTI_CATEGORY)
        expect((await resolveAccount({ txid: KALLISTI_TX.hash })).category).toBe(KALLISTI_CATEGORY)
        expect((await resolveAccount({ category: KALLISTI_CATEGORY })).category).toBe(KALLISTI_CATEGORY)
    })

    it('falls back from a non-registration txid to the category', async () => {
        const funding = { ...KALLISTI_TX, outputs: [{ ...KALLISTI_TX.outputs[1] }] }
        getTransaction.mockResolvedValueOnce(funding)

        const account = await resolveAccount({ identifier: KALLISTI_CATEGORY })

        expect(account.category).toBe(KALLISTI_CATEGORY)
    })

    it('rejects an empty or invalid request', async () => {
        await expect(resolveAccount({})).rejects.toThrow(/provide/)
        await expect(resolveAccount({ identifier: 'nope' })).rejects.toThrow(/not an identifier/)
    })

    it('shortens a category for display', () => {
        expect(shortCategory(KALLISTI_CATEGORY)).toBe('46e55678…53564111')
    })
})

describe('cashaccount/resolver — accountFromRegistration guards', () => {
    it('rejects a non-mutable NFT and a non-registration output 1', () => {
        const immutable = {
            ...KALLISTI_TX,
            outputs: [{ ...KALLISTI_TX.outputs[0], nftCapability: 'none' }, KALLISTI_TX.outputs[1]],
        }
        expect(() => accountFromRegistration(immutable)).toThrow(/mutable/)

        const noProfile = {
            ...KALLISTI_TX,
            outputs: [KALLISTI_TX.outputs[0], { ...KALLISTI_TX.outputs[1], lockingBytecodeHex: '6a' }],
        }
        expect(() => accountFromRegistration(noProfile)).toThrow(/not a CashAccounts/)
    })
})
