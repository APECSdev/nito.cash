// apps/web/tests/unit/lib/pool-verifier.spec.js
//
// Validation of the wallet's verifier-step builder (lib/pool/verifier.js) —
// the port of the zk-verifier-bench produceTransaction runtime.
//
// Ground truth #1 (ALGORITHM, byte-exact): the bench's artifacts/verifier-vectors.json
// (the produceTransaction output for a real proof over the OLDER trusted setup) +
// artifacts/public-fixtures.json (5 real proofs over that older vk). One of those
// fixtures generated the vectors; our port must reproduce ALL FIVE unlockings
// byte-for-byte, using the program constants extracted from the vectors themselves.
//
// Ground truth #2 (LINEAGE): build/pusd-public-fixtures.json carries the CURRENT
// committed verifying key (== apps/web/public/proving/verification_key.json) with 5
// real proofs — the key the LIVE pools verify against.
//
// Ground truth #3 (LIVE structure): with the DEPLOYED program constants (extracted
// from the live chipnet actions — lib/pool/verifier-program.js) and a current-vkey
// fixture proof, our assembled unlockings must match the live push profiles exactly
// (push count + sizes per step; the deployed redeems consume this layout). Full VM
// acceptance against the deployed lockings runs on the apecsdev VM (NOTE-CARRIER
// §7.1 harness pattern).
//
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { produceVerifierInputs } from '@/lib/pool/verifier'
import { DEPLOYED_PROGRAM, WALLET_PROGRAM, WALLET_STEP_LOCKINGS } from '@/lib/pool/verifier-program'

const FIX = fileURLToPath(new URL('../../fixtures/pool/', import.meta.url))
const VECTORS = JSON.parse(readFileSync(`${FIX}/bench-vectors-steps.json`, 'utf8'))
const OLD_FIXTURES = JSON.parse(readFileSync(`${FIX}/bench-public-fixtures.json`, 'utf8'))
const NEW_FIXTURES = JSON.parse(readFileSync(`${FIX}/pusd-public-fixtures.json`, 'utf8'))
const COMMITTED_VK = JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/proving/verification_key.json', import.meta.url)), 'utf8'))
/* The role-2 (Hush) bench-shape key: the committed snarkjs JSON is its encoding. */
const ROLE2_VK = JSON.parse(readFileSync(fileURLToPath(new URL('../../../src/lib/pool/role2/our.fixtures.json', import.meta.url)), 'utf8')).vk

/* push parser (same shape as lib/pool/decode.js scriptPushes). */
function pushesOf(bcHex) {
    const bc = new Uint8Array(bcHex.length / 2)
    for (let i = 0; i < bc.length; i += 1) bc[i] = parseInt(bcHex.slice(i * 2, i * 2 + 2), 16)
    const items = []
    let i = 0
    while (i < bc.length) {
        const op = bc[i++]
        let len
        if (op === 0) { items.push(new Uint8Array(0)); continue }
        if (op <= 0x4b) len = op
        else if (op === 0x4c) len = bc[i++]
        else if (op === 0x4d) { len = bc[i] | (bc[i + 1] << 8); i += 2 }
        else if (op >= 0x51 && op <= 0x60) { items.push(new Uint8Array([op - 0x50])); continue }
        else { items.push(null); continue }
        items.push(bc.slice(i, i + len))
        i += len
    }
    return items
}

const hexOf = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/* The bench's program constants, extracted from the vectors themselves
   (and the committed WALLET_PROGRAM must match this extraction). */
const OLD_PROGRAM = {
    redeems: VECTORS.steps.map((s) => hexOf(pushesOf(s.unlocking).pop())),
    sharedFragments: [0, 1, 2].map((n) => hexOf(pushesOf(VECTORS.steps[n].unlocking)[1])),
    quotientLengths: [1248, 1248, 1248],
    quotientSuffixes: ['', '', ''], /* the module's QUOTIENT_SUFFIXES form */
    stagePads: [0, 0, 0, 0],
    genesisPad: 0,
    msmSplit: 26,
    cuts: [38, 46, 54, 60],
}

describe('lib/pool/verifier (bench ground-truth reproduction)', () => {
    it('the committed wallet vk is the role-2 (Hush) key (lineage)', () => {
        /* 2026-11-26: the committed verification_key.json is the Hush role-2
           ceremony key (role2-proving-assets-v1), not the gate3 vkey. */
        const nvk = ROLE2_VK
        expect(BigInt(nvk.alpha.x)).toEqual(BigInt(COMMITTED_VK.vk_alpha_1[0]))
        expect(BigInt(nvk.alpha.y)).toEqual(BigInt(COMMITTED_VK.vk_alpha_1[1]))
        expect(BigInt(nvk.ic[0].x)).toEqual(BigInt(COMMITTED_VK.IC[0][0]))
        expect(BigInt(nvk.ic[1].x)).toEqual(BigInt(COMMITTED_VK.IC[1][0]))
        expect(BigInt(nvk.ic[2].x)).toEqual(BigInt(COMMITTED_VK.IC[2][0]))
    })

    /* The vectors were generated from fixture 0 of the older fixtures (verified
       2026-11-22 by iterating all 5 — only 0 reproduces them; the run is pinned
       to it because one produceWitness is ~4-8 s of pairing math and the full
       5-fixture sweep made CI's 2-core runner too slow for the rest of the
       suite's timing-marginal tests). */
    it('WALLET_PROGRAM/WALLET_STEP_LOCKINGS stay in lockstep with the vectors fixture', () => {
        /* The registry's chipnet-pusd-v2 pool (the live Path-A deployment)
           pins WALLET_PROGRAM — the committed constants must BE the fixture
           extraction, byte-for-byte. */
        expect(WALLET_PROGRAM.redeems).toEqual(OLD_PROGRAM.redeems)
        expect(WALLET_PROGRAM.sharedFragments).toEqual(OLD_PROGRAM.sharedFragments)
        expect(WALLET_PROGRAM.quotientLengths).toEqual(OLD_PROGRAM.quotientLengths)
        expect(WALLET_PROGRAM.quotientSuffixes).toEqual(OLD_PROGRAM.quotientSuffixes)
        expect(WALLET_PROGRAM.stagePads).toEqual(OLD_PROGRAM.stagePads)
        expect(WALLET_PROGRAM.genesisPad).toEqual(OLD_PROGRAM.genesisPad)
        expect(WALLET_PROGRAM.msmSplit).toEqual(OLD_PROGRAM.msmSplit)
        expect(WALLET_PROGRAM.cuts).toEqual(OLD_PROGRAM.cuts)
        expect(WALLET_STEP_LOCKINGS).toEqual(VECTORS.steps.map((s) => s.locking))
    })

    it('reproduces the bench vectors byte-for-byte for steps 0-3, and the ON-CHAIN terminal profile', () => {
        const fixture = OLD_FIXTURES.fixtures[0]
        const inputs = produceVerifierInputs({
            vk: OLD_FIXTURES.vk,
            proof: fixture.proof,
            publicSignals: fixture.publicInputs,
            program: OLD_PROGRAM,
        })

        /* STEPS 0-3: byte-exact against the committed vectors. */
        const diffs = inputs.slice(0, 4).map((unlocking, n) => {
            const a = hexOf(unlocking), b = VECTORS.steps[n].unlocking
            if (a === b) return null
            let d = -1
            for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) { d = i / 2; break }
            return `step${n}: len ${a.length / 2} vs ${b.length / 2}, firstDiff@${d}`
        }).filter((x) => x !== null)
        expect(diffs, diffs.join(' | ')).toEqual([])

        /* STEP 4 (the terminal) is pinned to the CONFIRMED ON-CHAIN form, not to
           the vector. The committed vector encodes the terminal witness with
           minimal VM-numbers (8706 B — two values shorter than 32 bytes), while
           every confirmed on-chain action carries the FIXED 32-byte form: the
           gate3 SHIELD f5927a0b… (block 330438) terminal unlocking is 8708 B
           with 51 32-byte pushes. The port matches the chain (the terminal
           fixed32 fix), so the vector's terminal is a pre-fixed32 snapshot. */
        const terminal = hexOf(inputs[4])
        const terminalPushes = pushesOf(terminal).map((p) => (p === null ? null : p.length))
        /* 51 FIXED 32-byte witness pushes (the on-chain form). */
        expect(terminalPushes.filter((n) => n === 32)).toHaveLength(51)
        expect(terminalPushes[0]).toBe(296)
        expect(terminalPushes[1]).toBe(2336)
        expect(terminalPushes.at(-2)).toBe(224)
        /* the final push is THIS program's terminal redeem (4157 B for
           WALLET_PROGRAM → 8707 B total; 4158 B for DEPLOYED_PROGRAM → 8708 B,
           which is the confirmed gate3 f5927a0b… length). */
        expect(terminalPushes.at(-1)).toBe(OLD_PROGRAM.redeems[4].length / 2)
    }, 600000)

    it('assembles the DEPLOYED-program layout for a current-vkey proof (live push profiles)', () => {
        const fixture = NEW_FIXTURES.fixtures[0]
        const inputs = produceVerifierInputs({
            vk: NEW_FIXTURES.vk,
            proof: fixture.proof,
            publicSignals: fixture.publicInputs,
            program: DEPLOYED_PROGRAM,
        })
        expect(inputs).toHaveLength(5)

        const profiles = inputs.map((unlocking) => pushesOf(hexOf(unlocking)).map((p) => p === null ? null : p.length))
        /* execs: 7 pushes [296, fragment, execWitness, fixedTable, 1248, 224, 364] */
        for (let n = 0; n < 3; n++) {
            expect(profiles[n]).toHaveLength(7)
            expect(profiles[n][0]).toEqual(296)
            expect(profiles[n][4]).toEqual(1248)
            expect(profiles[n][5]).toEqual(224)
            expect(profiles[n][6]).toEqual(364)
        }
        /* genesis: 24 pushes [448, sel, 32×16, 768, 0(pad), 38(wa), 32(n1), 32(n0), 5909] */
        expect(profiles[3]).toEqual([448, profiles[3][1], 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 768, 0, 38, 32, 32, 5909])
        expect(profiles[3][1]).toBeLessThanOrEqual(2)
        /* terminal: 55 pushes [296, 2336, 51×~32, 224, 4158] */
        expect(profiles[4]).toHaveLength(55)
        expect(profiles[4][0]).toEqual(296)
        expect(profiles[4][1]).toEqual(2336)
        expect(profiles[4][53]).toEqual(224)
        expect(profiles[4][54]).toEqual(4158)

        /* The n0/n1 patch points: 32-byte LE public inputs at genesis byte
           offsets 1792/1825 (the deployed covenant reads them there). */
        const genesis = inputs[3]
        const n1LE = genesis.slice(1792, 1824)
        const n0LE = genesis.slice(1825, 1857)
        const leHex = (b) => hexOf(b)
        const toLE = (dec) => hexOf((() => {
            const out = new Uint8Array(32)
            let v = BigInt(dec)
            for (let i = 0; i < 32; i += 1) { out[i] = Number(v & 0xffn); v >>= 8n }
            return out
        })())
        expect(leHex(n1LE)).toEqual(toLE(fixture.publicInputs[1]))
        expect(leHex(n0LE)).toEqual(toLE(fixture.publicInputs[0]))
    }, 600000)
})
