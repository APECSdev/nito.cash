// tests/unit/lib/pool-verifier-role2-v4h.spec.js
//
// The v4h (the C architecture — the MAINNET Preview v0 pool) program + walk +
// H-covenant reproduction gate: the client must build the DEPLOYED mainnet
// program byte-exactly (the state file role2-pool4-state.mainnet-v4h.json —
// deployed 2026-11-27T16:56Z, confirmed h 979,219) under the POST-MPC
// three-contribution fixtures, AND the stock 3-out + v3 programs must stay
// byte-identical after the vendored v4h updates (the check-10 merge
// discipline: the non-v3 emission order is load-bearing).
//
// Sources: hushyourmoney docs/V4H-PIVOT-NITO-REVIEW-RESPONSE-2026-11-27.md
// (§4 the definitive port list), pusd-shielded-pool wip-role2-hook/{pool-hook,
// walk-scripts,holdings-covenant,pool-tx-v3}.mjs + v4h-graph-pin.patch
// (vendored into role2-3out/), the deployed state file.

import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
    role2ProgramV4h, v4hWalkScripts, v4hHoldingsCovenant,
    ROLE2_V4H_MAINNET_CATEGORY_DISPLAY, ROLE2_V4H_MAINNET_ASSET_DISPLAY,
    ROLE2_V4H_MAINNET_CODE_SHA256, ROLE2_V4H_MAINNET_LOCKING,
    ROLE2_V4H_MAINNET_WALK_A_HASH, ROLE2_V4H_MAINNET_WALK_B_HASH, ROLE2_V4H_MAINNET_H_LOCKING,
} from '@/lib/pool/verifier-role2-v4h'
import { VK_FIXTURES_V4H } from '@/lib/pool/role2-3out/sound-si-gls/math.mjs'
import { role2ProgramV3, ROLE2_V3_CHIPNET_WALK_A_HASH, ROLE2_V3_CHIPNET_WALK_B_HASH, ROLE2_V3_CHIPNET_CATEGORY_DISPLAY } from '@/lib/pool/verifier-role2-v3'
import { role2Program3out, ROLE2_3OUT_CATEGORY_ONCHAIN } from '@/lib/pool/verifier-role2-3out'

const bytesOf = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)))
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const sha256Of = (bytes) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
/* p2sh32 = aa20 ‖ sha256(sha256(redeem)) ‖ 87 (the vendored p2sh32 — DOUBLE sha) */
const hash256Of = (bytes) => sha256Of(new Uint8Array(Buffer.from(sha256Of(bytes), 'hex')))

/* The deployed mainnet state file's exact record. */
const DEPLOYED = {
    codeSha256: '4f096247c5b56ab682119cb4446289598b48d374bb30d10e9ad43ee23dab4493',
    codeLength: 8078,
    pieces: [4151, 3927],
    locking: 'aa2006d764d4a149900fe8cbe2a0b01753643b21bda74b0fc76018172bfc098dc3c987',
    progLockingHashHex: '90f104a34677e1abf90a2e1ad6eddaeece258f6d647b41c94ee563fa0e4946cb',
    walkAHash: '1255489f8168c4110094b0701617278133aa31f43ae4cb341f2f7bdb0f21a002',
    walkBHash: 'b476695026823fb3466d543ec61bf468fbe434a9c1c861233f3ca2ff09ad8312',
    walkALocking: 'aa20cf645a0a3d532c3ea8c485a349e2550bde67725dc8cc3ef3cbbb9a67bec3fc6587',
    walkBLocking: 'aa2045a64214753dac303d84bb9e55cff327d1d9b2bc1d1e820822ca02fac955b09687',
    walkASize: 282,
    walkBSize: 295,
    hLocking: 'aa2006fa0f9ebadd88eaac1b8801c69329c6c3e6d9209bced65ed01340a6e4e19b2087',
    hScriptBytes: 211,
}

/* The pool category + the ASSET, on-chain byte order (display reversed). */
const CATEGORY_ONCHAIN = hexOf(Array.from(bytesOf(ROLE2_V4H_MAINNET_CATEGORY_DISPLAY)).reverse())
const ASSET_ONCHAIN = hexOf(Array.from(bytesOf(ROLE2_V4H_MAINNET_ASSET_DISPLAY)).reverse())

describe('lib/pool/verifier-role2-v4h — the v4h (C architecture) reproduction gate', () => {
    it('builds the DEPLOYED mainnet program byte-exactly (8,078 B / 4f096247… / pieces 4151+3927 / locking aa2006d764…)', () => {
        const program = role2ProgramV4h(CATEGORY_ONCHAIN, ASSET_ONCHAIN, DEPLOYED.walkAHash, DEPLOYED.walkBHash)
        expect(program.code.length).toBe(DEPLOYED.codeLength)
        expect(sha256Of(program.code)).toBe(DEPLOYED.codeSha256)
        expect(program.pieces.map((p) => p.length)).toEqual(DEPLOYED.pieces)
        /* the program locking: aa20 <hash256(R)> 87 */
        const locking = 'aa20' + hash256Of(program.R) + '87'
        expect(locking).toBe(DEPLOYED.locking)
        expect(locking).toBe(ROLE2_V4H_MAINNET_LOCKING)
        /* the program locking's hash — the H covenant embeds it */
        expect(sha256Of(bytesOf(DEPLOYED.locking))).toBe(DEPLOYED.progLockingHashHex)
    }, 420000)

    it('derives the commit96 walk scripts + wraps + pins exactly (282/295 B)', () => {
        const w = v4hWalkScripts(CATEGORY_ONCHAIN)
        expect(w.sizes.walkA).toBe(DEPLOYED.walkASize)
        expect(w.sizes.walkB).toBe(DEPLOYED.walkBSize)
        expect(hexOf(w.walkLockings[0])).toBe(DEPLOYED.walkALocking)
        expect(hexOf(w.walkLockings[1])).toBe(DEPLOYED.walkBLocking)
        /* the pins hash the WRAPS (v3.1 — SHA256(UTXOBYTECODE(3/4))) */
        expect(w.walkAHash).toBe(DEPLOYED.walkAHash)
        expect(w.walkBHash).toBe(DEPLOYED.walkBHash)
        expect(w.walkAHash).toBe(ROLE2_V4H_MAINNET_WALK_A_HASH)
        expect(w.walkBHash).toBe(ROLE2_V4H_MAINNET_WALK_B_HASH)
    })

    it('rebuilds the H covenant exactly (211 B; the theft-guard shape pin)', () => {
        const h = v4hHoldingsCovenant({
            progLockingHashHex: DEPLOYED.progLockingHashHex,
            walkAHashHex: DEPLOYED.walkAHash,
            walkBHashHex: DEPLOYED.walkBHash,
        })
        expect(h.redeemBytes).toBe(DEPLOYED.hScriptBytes)
        expect(h.lockingHex).toBe(DEPLOYED.hLocking)
        expect(h.lockingHex).toBe(ROLE2_V4H_MAINNET_H_LOCKING)
    })

    it('carries the POST-MPC three-contribution fixtures (the mainnet VK chain)', () => {
        /* the fixtures file of record: our-v3-user3.fixtures.json, sha256
           e74555dd… (the Hush M2 record) — hash the VENDORED FILE BYTES
           (import.meta.url — never an absolute path), not a re-serialization. */
        const fixturesBytes = readFileSync(join(process.cwd(), 'src/lib/pool/role2-3out/our-v3-user3.fixtures.json'))
        expect(sha256Of(fixturesBytes)).toBe('e74555dd84811e84c9c18c9a5f71bba0d2742957803d9f2a6e6878f1fb45c9a6')
        expect(VK_FIXTURES_V4H.vk).toBeTruthy()
        expect(VK_FIXTURES_V4H.artifactSha256).toBe('pool4-v3-07638f10')
        expect((VK_FIXTURES_V4H.fixtures || []).length).toBe(5)
    })

    it('keeps the 3-OUT + v3 programs byte-identical after the vendored v4h updates (the check-10 merge discipline)', () => {
        /* the non-v3 emission order is load-bearing — the Hush's unified
           OUTTOKCOMMIT emission builds 7,847 B / 8626ea4e… instead of the
           deployed 7,848 B / 73cb0ccb…; the merge restores the deployed
           order (this exact gate caught the regression on the first vendor). */
        const p3 = role2Program3out(ROLE2_3OUT_CATEGORY_ONCHAIN)
        expect(p3.code.length).toBe(7848)
        expect(sha256Of(p3.code)).toBe('73cb0ccb01791d37bea2289fc809211296685896ed8ca16ea260a666ede67971')

        const catOnV3 = hexOf(Array.from(bytesOf(ROLE2_V3_CHIPNET_CATEGORY_DISPLAY)).reverse())
        const p4 = role2ProgramV3(catOnV3, ROLE2_V3_CHIPNET_WALK_A_HASH, ROLE2_V3_CHIPNET_WALK_B_HASH)
        expect(p4.code.length).toBe(7998)
        expect(sha256Of(p4.code)).toBe('27b904a2ddec9e6b4ad5a261084be6ed18e59420e5e41e9400f72586bda88510')
    }, 420000)
})
