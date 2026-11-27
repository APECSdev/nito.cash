// tests/unit/lib/pool-verifier-role2-v3.spec.js
//
// The v3 (pool4) program + walk-script reproduction gate: the client must build
// the DEPLOYED chipnet v3 program byte-exactly (the state file's build record —
// role2-pool4-state.json, deployed 2026-11-27T05:38Z) and the deployed walk
// scripts/wraps/pins, AND the 3-out program must be UNCHANGED by the vendored
// v3-graph-pin patch (stock builds byte-identical — the patch is env-gated).
//
// Sources: hushyourmoney docs/POOL-V3-INTEGRATION-HANDOFF-2026-11-27.md (the M4
// contract), pusd-shielded-pool wip-role2-hook/{pool-build-v3,pool-tx-v3,
// walk-scripts}.mjs + v3-graph-pin.patch (vendored), the deployed state file.

import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'

import { role2ProgramV3, v3WalkScripts, ROLE2_V3_CHIPNET_CATEGORY_DISPLAY, ROLE2_V3_CHIPNET_CODE_SHA256, ROLE2_V3_CHIPNET_LOCKING, ROLE2_V3_CHIPNET_WALK_A_HASH, ROLE2_V3_CHIPNET_WALK_B_HASH } from '@/lib/pool/verifier-role2-v3'
import { getPools } from '@/lib/pool/registry'
import { EMPTY_NULL_SET_ROOT } from '@/lib/pool/smt'

import { role2Program3out, ROLE2_3OUT_CATEGORY_ONCHAIN } from '@/lib/pool/verifier-role2-3out'

const bytesOf = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)))
const sha256Of = (bytes) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
/* p2sh32 = aa20 ‖ sha256(sha256(redeem)) ‖ 87 (vm.mjs's hash256 — DOUBLE sha) */
const hash256Of = (bytes) => sha256Of(new Uint8Array(Buffer.from(sha256Of(bytes), 'hex')))
const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/* The MAINNET candidate (the user-confirmed category 2469acc5… — the Hush review §2
   record): the v3.1 build (P2SH32 walk pins), code sha256 40a95991…, walk lockings
   aa2035fb…87 / aa20bf54…87, pins 781c6ff7… / ee03a03e… — modulo the post-MPC VK
   cascade (the fixtures swap only). */
const MAINNET_DISPLAY = '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544'
const MAINNET_ONCHAIN = hexOf(new Uint8Array(MAINNET_DISPLAY.match(/.{2}/g).map((h) => parseInt(h, 16))).reverse())
const MAINNET_CODE_SHA256 = '40a9599141686539edd5590ba03fe012701ea0cc2ec4aae6a9fb7749416db012'
const MAINNET_WALK_A_LOCKING = 'aa2035fb34211578f35ec23120b5f9156956790c560a9d66d5d2243d78c62cc67c4087'

/* The deployed chipnet v3 pool, on-chain category byte order (display reversed). */
const CATEGORY_DISPLAY = ROLE2_V3_CHIPNET_CATEGORY_DISPLAY
const CATEGORY_ONCHAIN = hexOf(new Uint8Array(CATEGORY_DISPLAY.match(/.{2}/g).map((h) => parseInt(h, 16))).reverse())

/* The deployed state file's exact record (role2-pool4-state.json). */
const DEPLOYED = {
    codeSha256: '27b904a2ddec9e6b4ad5a261084be6ed18e59420e5e41e9400f72586bda88510',
    codeLength: 7998,
    pieces: [4111, 3887],
    locking: 'aa206dc915cef6f1343b7d170caaf79346072222d66fd3285fcb4d506f184069e8cb87',
    walkAHash: '9f0a1a9827c5c9889a888a71d8ac8ebc35e8819f8f097fb72a69cd64dab507f8',
    walkBHash: '338f4d86798584041cb87801f3b15ccdd656a1be8313bdd29c3d5b69e26ffd6f',
    walkALocking: 'aa20f823d16d3cab573069ba562afb2bfb9a5bcb72bdae85218132e1e12e6bfeaded87',
    walkBLocking: 'aa206ae3e5fb435b33afd6e907c9beae8e139a3ea85c90d57f026e99fc4bdbb31a0687',
    walkASize: 278,
    walkBSize: 291,
}

describe('lib/pool/verifier-role2-v3 — the v3 program + walk reproduction gate', () => {
    it('derives the walk scripts + P2SH32 wraps exactly (278/291 B; the v3.1 pin form)', () => {
        const w = v3WalkScripts(CATEGORY_ONCHAIN)
        expect(w.sizes.walkA).toBe(DEPLOYED.walkASize)
        expect(w.sizes.walkB).toBe(DEPLOYED.walkBSize)
        /* the wrap = the on-chain locking (aa20 <sha256(script)> 87) */
        expect(hexOf(w.walkLockings[0])).toBe(DEPLOYED.walkALocking)
        expect(hexOf(w.walkLockings[1])).toBe(DEPLOYED.walkBLocking)
        /* the pins hash the WRAPS (v3.1 — SHA256(UTXOBYTECODE(3/4)), not the raw scripts) */
        expect(w.walkAHash).toBe(sha256Of(hexOf(w.walkLockings[0]).match(/.{2}/g).map((h) => parseInt(h, 16))))
        expect(w.walkBHash).toBe(sha256Of(hexOf(w.walkLockings[1]).match(/.{2}/g).map((h) => parseInt(h, 16))))
        expect(w.walkAHash).toBe(DEPLOYED.walkAHash)
        expect(w.walkBHash).toBe(DEPLOYED.walkBHash)
        /* the exported constants agree with the deployed record */
        expect(ROLE2_V3_CHIPNET_WALK_A_HASH).toBe(DEPLOYED.walkAHash)
        expect(ROLE2_V3_CHIPNET_WALK_B_HASH).toBe(DEPLOYED.walkBHash)
    })

    it('builds the DEPLOYED v3 program byte-exactly (7,998 B / 27b904a2… / pieces 4111+3887)', () => {
        const program = role2ProgramV3(CATEGORY_ONCHAIN, ROLE2_V3_CHIPNET_WALK_A_HASH, ROLE2_V3_CHIPNET_WALK_B_HASH)
        expect(program.code.length).toBe(DEPLOYED.codeLength)
        expect(sha256Of(program.code)).toBe(DEPLOYED.codeSha256)
        expect(program.pieces.map((p) => p.length)).toEqual(DEPLOYED.pieces)
        /* the program locking: aa20 <hash256(R)> 87 (the vendored p2sh32 form) */
        const locking = 'aa20' + hash256Of(program.R) + '87'
        expect(locking).toBe(DEPLOYED.locking)
        expect(locking).toBe(ROLE2_V3_CHIPNET_LOCKING)
        expect(DEPLOYED.locking).toBe(ROLE2_V3_CHIPNET_LOCKING)
    }, 180000)

    it('caches per (category, pins) and restores the stock env (the graph pin is inert without it)', () => {
        expect(process.env.POOL_NULLDATA_HASHES).toBeUndefined()
        const a = role2ProgramV3(CATEGORY_ONCHAIN, ROLE2_V3_CHIPNET_WALK_A_HASH, ROLE2_V3_CHIPNET_WALK_B_HASH)
        const b = role2ProgramV3(CATEGORY_ONCHAIN, ROLE2_V3_CHIPNET_WALK_A_HASH, ROLE2_V3_CHIPNET_WALK_B_HASH)
        expect(a).toBe(b) /* the cache returns the SAME program object */
        expect(process.env.POOL_NULLDATA_HASHES).toBeUndefined() /* restored */
    })

    it('builds the MAINNET v3.1 candidate BYTE-EXACTLY (40a95991… — the review §2 record)', () => {
        const w = v3WalkScripts(MAINNET_ONCHAIN)
        expect(hexOf(w.walkLockings[0])).toBe(MAINNET_WALK_A_LOCKING)
        const program = role2ProgramV3(MAINNET_ONCHAIN, w.walkAHash, w.walkBHash)
        expect(program.code.length).toBe(7998)
        expect(sha256Of(program.code)).toBe(MAINNET_CODE_SHA256)
        expect(process.env.POOL_NULLDATA_HASHES).toBeUndefined()
        /* the chipnet default restored after the mainnet build (the cache is per-key) */
    }, 180000)

    it('the REGISTRY entry is internally consistent (the genesis commitment = rootLE ‖ EMPTY_NULL_ROOT; the pins = sha256 of the wraps)', () => {
        const entry = getPools('chipnet').find((pool) => pool.variant === 'v3')
        expect(entry).toBeDefined()
        expect(entry.id).toBe('chipnet-role2-pool4-v3')
        /* the EMPTY genesis: the deployment's 64-B state commitment */
        expect(entry.genesisStateCommitment).toBe(entry.genesisRootLE + hexOf(EMPTY_NULL_SET_ROOT))
        expect(entry.genesisLeaves).toEqual([])
        expect(entry.bootstrapNotes).toEqual([])
        /* the walk pins = sha256 of the P2SH32 wrap lockings (v3.1) */
        expect(sha256Of(bytesOf(entry.program.walkLockings[0]))).toBe(entry.program.walkPins[0])
        expect(sha256Of(bytesOf(entry.program.walkLockings[1]))).toBe(entry.program.walkPins[1])
        expect(entry.program.walkPins[0]).toBe(DEPLOYED.walkAHash)
        /* the program record matches the deployed build */
        expect(entry.program.codePin).toBe(DEPLOYED.codeSha256)
        expect(entry.program.lockingBytecode).toBe(DEPLOYED.locking)
        /* the on-chain category byte order */
        expect(entry.categoryOnChain).toBe(hexOf(new Uint8Array(entry.assetCategory.match(/.{2}/g).map((h) => parseInt(h, 16))).reverse()))
    })

    it('keeps the 3-OUT program byte-identical after the v3-graph-pin patch (the stock-build regression)', () => {
        const program = role2Program3out(ROLE2_3OUT_CATEGORY_ONCHAIN)
        /* the deployed 3-out program's record: 7,848 B / 73cb0ccb… (verifier-program-role2.js codePin) */
        expect(program.code.length).toBe(7848)
        expect(sha256Of(program.code)).toBe('73cb0ccb01791d37bea2289fc809211296685896ed8ca16ea260a666ede67971')
        const locking = 'aa20' + hash256Of(program.R) + '87'
        expect(locking).toBe('aa204a6ce339fb62b7b2ebb502c9bf642d3221620e6f5ded619ce8a39110e35182ea87')
        expect(process.env.POOL_NULLDATA_HASHES).toBeUndefined()
    }, 180000)
})
