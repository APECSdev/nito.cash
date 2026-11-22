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
import { DEPLOYED_PROGRAM } from '@/lib/pool/verifier-program'

const FIX = fileURLToPath(new URL('../../fixtures/pool/', import.meta.url))
const VECTORS = JSON.parse(readFileSync(`${FIX}/bench-vectors-steps.json`, 'utf8'))
const OLD_FIXTURES = JSON.parse(readFileSync(`${FIX}/bench-public-fixtures.json`, 'utf8'))
const NEW_FIXTURES = JSON.parse(readFileSync(`${FIX}/pusd-public-fixtures.json`, 'utf8'))
const COMMITTED_VK = JSON.parse(readFileSync(fileURLToPath(new URL('../../../public/proving/verification_key.json', import.meta.url)), 'utf8'))

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

/* The bench's program constants, extracted from the vectors themselves. */
const OLD_PROGRAM = {
    redeems: VECTORS.steps.map((s) => hexOf(pushesOf(s.unlocking).pop())),
    sharedFragments: [0, 1, 2].map((n) => hexOf(pushesOf(VECTORS.steps[n].unlocking)[1])),
    quotientLengths: [1248, 1248, 1248],
    quotientSuffixes: [[], [], []],
    stagePads: [0, 0, 0, 0],
    genesisPad: 0,
    msmSplit: 26,
    cuts: [38, 46, 54, 60],
}

describe('lib/pool/verifier (bench ground-truth reproduction)', () => {
    it('the current fixture vk is the committed wallet vk (lineage)', () => {
        const nvk = NEW_FIXTURES.vk
        expect(nvk.alpha.x).toEqual(COMMITTED_VK.vk_alpha_1[0])
        expect(nvk.alpha.y).toEqual(COMMITTED_VK.vk_alpha_1[1])
        expect(nvk.ic[0].x).toEqual(COMMITTED_VK.IC[0][0])
        expect(nvk.ic[1].x).toEqual(COMMITTED_VK.IC[1][0])
        expect(nvk.ic[2].x).toEqual(COMMITTED_VK.IC[2][0])
    })

    /* The vectors were generated from ONE of the 5 older fixtures — the byte-exact
       run must find it and reproduce all five unlockings with zero diff. */
    it('reproduces the bench vectors byte-for-byte for the generating fixture', () => {
        let matched = -1
        for (const fixture of OLD_FIXTURES.fixtures) {
            const inputs = produceVerifierInputs({
                vk: OLD_FIXTURES.vk,
                proof: fixture.proof,
                publicSignals: fixture.publicInputs,
                program: OLD_PROGRAM,
            })
            const allEqual = inputs.every((unlocking, n) => hexOf(unlocking) === VECTORS.steps[n].unlocking)
            if (allEqual) { matched = fixture.fixture; break }
            /* Diagnose the closest mismatch for the report. */
            const diffs = inputs.map((unlocking, n) => {
                const a = hexOf(unlocking), b = VECTORS.steps[n].unlocking
                if (a === b) return `step${n}:OK`
                let d = -1
                for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) { d = i / 2; break }
                return `step${n}:len ${a.length / 2} vs ${b.length / 2} firstDiff@${d}`
            })
            console.log(`fixture ${fixture.fixture}: ${diffs.join(' | ')}`)
        }
        expect(matched).toBeGreaterThanOrEqual(0)
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
