import { describe, expect, it } from 'vitest'

import {
    BLANKS_PER_LOCK,
    BLANK_VENDING_MACHINE,
    BLANK_VENDING_PRICE_SATS,
    actionsRemaining,
    blankSummary,
    countBlanks,
    getBlanks,
    isBlankUtxo,
    isBuyableVendingUtxo,
    isVendingUtxo,
    selectBlanks,
    vendingAddress,
} from '@/lib/pool/blanks'
import { getPools, getProverPool } from '@/lib/pool/registry'
import { ROLE2_GUARD, ROLE2_PROGRAM, ROLE2_VENDING } from '@/lib/pool/verifier-program-role2'

const CATEGORY = '480e30ff1d3f5f0b6fe9dd2dbe363b1776f61566f29a395628d0b50abd01b9d0'

const blank = (overrides = {}) => ({
    token_data: {
        category: CATEGORY,
        amount: '0',
        nft: { capability: 'mutable', commitment: '' },
    },
    ...overrides,
})

const withToken = (token_data) => ({ token_data })

describe('lib/pool/blanks — the role-2 blank shape', () => {
    it('recognizes the exact blank shape', () => {
        expect(isBlankUtxo(blank(), CATEGORY)).toBe(true)
        expect(isBlankUtxo(blank({ token: blank().token_data }), CATEGORY)).toBe(true)
        expect(isBlankUtxo(blank({ token_data: { ...blank().token_data, nft: { capability: 'mutable', commitment: '0x' } } }), CATEGORY)).toBe(true)
    })

    it('rejects a foreign category', () => {
        expect(isBlankUtxo(blank({ token_data: { ...blank().token_data, category: '0d31da75' } }), CATEGORY)).toBe(false)
    })

    it('rejects a non-mutable NFT or a non-empty commitment', () => {
        expect(isBlankUtxo(blank({ token_data: { ...blank().token_data, nft: { capability: 'none', commitment: '' } } }), CATEGORY)).toBe(false)
        expect(isBlankUtxo(blank({ token_data: { ...blank().token_data, nft: { capability: 'minting', commitment: '' } } }), CATEGORY)).toBe(false)
        expect(isBlankUtxo(blank({ token_data: { ...blank().token_data, nft: { capability: 'mutable', commitment: 'aa' } } }), CATEGORY)).toBe(false)
    })

    it('rejects a non-zero FT amount or no token', () => {
        expect(isBlankUtxo(blank({ token_data: { ...blank().token_data, amount: '1' } }), CATEGORY)).toBe(false)
        expect(isBlankUtxo({}, CATEGORY)).toBe(false)
        expect(isBlankUtxo(blank(), null)).toBe(false)
    })

    it('counts held blanks and whole actions (2 per lock)', () => {
        const utxos = [blank(), blank(), blank(), { token_data: { category: 'other', amount: '0' } }]
        expect(countBlanks(utxos, CATEGORY)).toBe(3)
        expect(actionsRemaining(utxos, CATEGORY)).toBe(1)
        expect(BLANKS_PER_LOCK).toBe(2)
    })

    it('selects exactly two blanks, or null when short', () => {
        const utxos = [blank(), blank(), blank()]
        expect(selectBlanks(utxos, CATEGORY)).toHaveLength(2)
        expect(selectBlanks(utxos.slice(0, 1), CATEGORY)).toBeNull()
    })

    it('recognizes the vending machine and its price', () => {
        expect(isVendingUtxo({ lockingBytecode: BLANK_VENDING_MACHINE })).toBe(true)
        expect(isVendingUtxo({ lockingBytecode: 'aa20' })).toBe(false)
        expect(BLANK_VENDING_PRICE_SATS).toBe(1000)
        expect(vendingAddress()).toBe(BLANK_VENDING_MACHINE)
        expect(vendingAddress().startsWith('aa20')).toBe(true)
    })

    it('treats a vending UTXO carrying the category as buyable', () => {
        const utxo = { ...blank(), lockingBytecode: BLANK_VENDING_MACHINE }
        expect(isBuyableVendingUtxo(utxo, CATEGORY)).toBe(true)
        expect(isBuyableVendingUtxo({ ...utxo, token_data: { ...utxo.token_data, category: 'other' } }, CATEGORY)).toBe(false)
    })

    it('summarizes blanks + vending inventory', () => {
        const utxos = [blank(), blank(), { ...blank(), lockingBytecode: BLANK_VENDING_MACHINE }]
        const summary = blankSummary(utxos, CATEGORY)
        expect(summary.blanks).toBe(3)
        expect(summary.actions).toBe(1)
        expect(summary.vending).toBe(1)
        expect(summary.buyable).toBe(1)
        expect(summary.vendingPriceSats).toBe(1000)
        expect(summary.blanksPerLock).toBe(2)
        expect(getBlanks(utxos, CATEGORY)).toHaveLength(3)
    })
})

describe('lib/pool/registry — the role-2 tagged pool', () => {
    const pools = getPools('chipnet')
    const role2 = pools[0]

    it('is the first chipnet pool and carries the handoff facts', () => {
        expect(role2.id).toBe('chipnet-pusd-role2')
        expect(role2.assetCategory).toBe(CATEGORY)
        expect(role2.lockingBytecode).toBe(ROLE2_PROGRAM.lockingBytecode)
        expect(role2.program).toBe(ROLE2_PROGRAM)
        expect(role2.guard).toBe(ROLE2_GUARD)
        expect(role2.vending).toBe(ROLE2_VENDING)
        expect(role2.shape).toBe('role2-tagged')
        expect(role2.txInputCount).toBe(3)
        expect(role2.carrierBytes).toBe(169)
        expect(role2.fuelSats).toBe(15000)
        expect(role2.blanksPerLock).toBe(2)
        expect(role2.genesisRootLE).toBe('551108f63731bcc628dda2697d70219d103a8c1bf203f2d4aaec6bbea5b4510f')
        expect(role2.genesisLeaves).toHaveLength(2)
        expect(role2.bootstrapNotes).toHaveLength(2)
    })

    it('is LIVE after the Hush proving assets + the web-platform acceptance', () => {
        /* The browser SHIELD -> TRANSFER -> UNSHIELD passed on chipnet
           (1ca58773... -> 50644d00... -> f52008f4...) — the flag flips. */
        expect(role2.walletProverCompatible).toBe(true)
        expect(role2.status).toBe('live')
        expect(getProverPool('chipnet')).toBe(role2)
        expect(getProverPool('mainnet')).toBeNull()
    })

    it('retires the old v4/v3 pools and their notes', () => {
        const old = pools.filter((pool) => pool.id === 'chipnet-pusd-v4' || pool.id === 'chipnet-pusd-v3')
        expect(old).toHaveLength(2)
        for (const pool of old) {
            expect(pool.walletProverCompatible).toBe(false)
            expect(pool.deprecated).toBe(true)
        }
    })
})
