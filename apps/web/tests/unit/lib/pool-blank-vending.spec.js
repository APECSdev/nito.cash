// apps/web/tests/unit/lib/pool-blank-vending.spec.js
//
// The G5 BLANK-VENDING COVENANT (src/lib/pool/blank-vending.js — the wallet
// vendor of the Hush blank-vending.mjs): the deployed-program REPRODUCTION
// discipline. The vendored `vendingRedeem` must reproduce the deployed
// machines' P2SH32 lockings BYTE-EXACTLY from the registry's pinned params
// (category + price + operator locking) — both the CHIPNET v3 machine
// (`aa207bd0…c987`, load ead5d000… h 350676) and the MAINNET v4h machine
// (`aa2073ad…5087`, load 5bd64412… h 979287).

import { describe, expect, it } from 'vitest'

import { vendingLockingHex, vendingRedeem } from '@/lib/pool/blank-vending'
import { getPools } from '@/lib/pool/registry'

const CHIPNET = getPools('chipnet').find((p) => p.id === 'chipnet-role2-pool4-v3')
const MAINNET = getPools('mainnet').find((p) => p.id === 'mainnet-role2-pool4-v4h')

describe('lib/pool/blank-vending (the deployed-machine reproduction)', () => {
    it('reproduces the CHIPNET v3 machine locking BYTE-EXACTLY from the registry params', () => {
        const redeem = vendingRedeem({
            categoryDisplayHex: CHIPNET.assetCategory,
            priceSats: BigInt(CHIPNET.vending.priceSats),
            operatorLockingHex: CHIPNET.vending.operatorLockingHex,
        })

        /* The handover's 157 B redeem size. */
        expect(redeem.length).toBe(157)

        const locking = vendingLockingHex(redeem)

        expect(locking).toBe(CHIPNET.vending.lockingBytecode)
        expect(locking).toBe('aa207bd03b1c57afff2715d61031e82a25dff54a6819b1bc16e545ddcfcd026a8bc987')
    })

    it('reproduces the MAINNET v4h machine locking BYTE-EXACTLY from the registry params', () => {
        const redeem = vendingRedeem({
            categoryDisplayHex: MAINNET.assetCategory,
            priceSats: BigInt(MAINNET.vending.priceSats),
            operatorLockingHex: MAINNET.vending.operatorLockingHex,
        })

        expect(redeem.length).toBe(157)

        const locking = vendingLockingHex(redeem)

        expect(locking).toBe(MAINNET.vending.lockingBytecode)
        expect(locking).toBe('aa2073ad0a1e681fa123d80754164fd34bdcb0f6ea3c26784b36f6d8778a8b0a945087')
    })

    it('the covenant pins the deployed SHAPE (2-in/3-out, input-0 self, the category suffix)', () => {
        const redeem = vendingRedeem({
            categoryDisplayHex: CHIPNET.assetCategory,
            priceSats: 1000n,
            operatorLockingHex: CHIPNET.vending.operatorLockingHex,
        })

        /* OP_INPUTINDEX(0xc0) 0x00 OP_NUMEQUALVERIFY — the input-0 pin. */
        expect(redeem[0]).toBe(0xc0)
        expect(redeem[1]).toBe(0x00)
        expect(redeem[2]).toBe(0x9d)

        /* The category's on-chain (BYTE-reversed) form + the 0x01 mutable
           suffix appear as a push (the blank-shape pin). */
        const catRevHex = CHIPNET.assetCategory.match(/../g).reverse().join('')
        const redeemHex = [...redeem].map((b) => b.toString(16).padStart(2, '0')).join('')

        expect(redeemHex).toContain(catRevHex.slice(0, 60))
        expect(redeemHex).toContain('01')

        /* The final OP_1 success push (the signature-free covenant supplies
           its own truthy). */
        expect(redeem[redeem.length - 1]).toBe(0x51)
    })

    it('rejects a non-positive price (the exact-price pin is load-bearing)', () => {
        expect(() => vendingRedeem({ categoryDisplayHex: CHIPNET.assetCategory, priceSats: 0n, operatorLockingHex: CHIPNET.vending.operatorLockingHex }))
            .toThrow('priceSats must be positive')
    })
})
