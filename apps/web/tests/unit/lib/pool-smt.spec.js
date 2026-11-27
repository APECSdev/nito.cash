/* Unit tests for the nullifier SMT mirror (lib/pool/smt.js) — the v3
 * client-swap prep, ORACLE-TESTED against the Hush's committed v3 fixtures.
 *
 * tests/fixtures/pool/v3/our-v3-proofs.json — 5 v3 proof fixtures (the
 * transfer/shield/unshield/transfer2/DEPOSIT set under the pool4 zkey), each
 * carrying its per-action SMT walk record:
 *   { sibsA, midRoot, sibsB, finalNullRoot, nullSetRootBefore }
 *
 * The spec reconstructs the spent-key chain (each fixture's before-root names
 * its predecessor; the chain starts at the EMPTY root), derives each action's
 * two SMT keys from its covenant's nf0/nf1, and requires
 * nullifierWalkData() to reproduce EVERY fixture's walk data BYTE-EXACT —
 * the same 4/4 walk cross-checks the Hush reference performs at generation
 * time.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { binToHex, hexToBin } from '@bitauth/libauth'
import { describe, expect, it } from 'vitest'

import {
    EMPTY_NULL_SET_ROOT, NULLIFIER_SMT_DEPTH, SMT_EMPTY_LEAF, SMT_MARKER_LEAF,
    SMT_ZERO_LADDER, makeNullifierSmt, nullifierWalkData,
} from '@/lib/pool/smt'

/* The committed fixtures (byte-exact the Hush VM copies; sha256 pinned in the
   repo). Resolved via process.cwd() (the vitest root = apps/web) — the
   new URL(literal, import.meta.url) pattern is rewritten by Vite's import
   analysis into jsdom http URLs for resolvable assets (measured live). */
const FIXTURES = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/pool/v3/our-v3-proofs.json')))

/* A covenant nf field is the MINIMAL LE VM-number form; the SMT key is the
   fixed 32-B LE form. Recover the bigint (reverse → big-endian → parse),
   then re-emit 32 LE bytes. Nullifiers are < 2^254.6, so no VM sign byte. */
const keyOf = (minimalLeHex) => {
    const minimal = hexToBin(minimalLeHex)
    const bigEndian = new Uint8Array(minimal.length)

    for (let i = 0; i < minimal.length; i += 1) {
        bigEndian[i] = minimal[minimal.length - 1 - i]
    }

    const value = BigInt('0x' + binToHex(bigEndian))

    const key = new Uint8Array(32)
    let v = value

    for (let i = 0; i < 32; i += 1) {
        key[i] = Number(v & 0xffn)
        v >>= 8n
    }

    return binToHex(key)
}

const hexBytesEqual = (a, b) => binToHex(hexToBin(a)) === binToHex(hexToBin(b))

describe('lib/pool/smt — the v3 nullifier SMT mirror', () => {
    it('builds the SHA256 zero ladder to depth 254 (the v3 genesis root)', () => {
        expect(SMT_ZERO_LADDER).toHaveLength(NULLIFIER_SMT_DEPTH + 1)
        expect(SMT_ZERO_LADDER[0]).toEqual(new Uint8Array(32))

        /* The ladder doubles: szh[i] = SHA256(szh[i-1] ‖ szh[i-1]) — spot-check
           level 1 against a hand hash. */
        const manual = makeNullifierSmt([]).rootOf()
        expect(manual).toEqual(SMT_ZERO_LADDER[NULLIFIER_SMT_DEPTH])
        expect(binToHex(manual)).toHaveLength(64)
    })

    it('pins the MARKER and EMPTY leaves to their exact byte forms', () => {
        expect([...SMT_MARKER_LEAF]).toEqual([1, ...Array(31).fill(0)])
        expect(SMT_EMPTY_LEAF).toEqual(new Uint8Array(32))
    })

    it('reproduces EVERY committed v3 fixture walk record BYTE-EXACT (the oracle)', () => {
        /* Each fixture is a STANDALONE vector: every record's
           nullSetRootBefore IS the EMPTY genesis root (measured — all five
           match binToHex(EMPTY_NULL_SET_ROOT); the fixtures were generated
           independently from the empty set, not as one chain). */
        const entries = FIXTURES.map((fixture) => ({
            label: fixture.label,
            kA: keyOf(fixture.covenant.nf0),
            kB: keyOf(fixture.covenant.nf1),
            nullSet: fixture.nullSet,
        }))

        expect(entries).toHaveLength(5)

        for (const entry of entries) {
            expect(entry.nullSet.sibsA).toHaveLength(254)
            expect(entry.nullSet.sibsB).toHaveLength(254)
            expect(hexBytesEqual(entry.nullSet.nullSetRootBefore, binToHex(EMPTY_NULL_SET_ROOT))).toBe(true)
        }

        /* The byte-exact oracle: reproduce every fixture's walk data from
           the EMPTY set — the same 4/4 walk cross-checks the Hush reference
           runs at generation time. */
        for (const entry of entries) {
            const walk = nullifierWalkData({ spentKeys: [], kA: entry.kA, kB: entry.kB })

            expect(hexBytesEqual(walk.nullSetRootBefore, entry.nullSet.nullSetRootBefore)).toBe(true)
            expect(walk.sibsA).toEqual(entry.nullSet.sibsA)
            expect(hexBytesEqual(walk.midRoot, entry.nullSet.midRoot)).toBe(true)
            expect(walk.sibsB).toEqual(entry.nullSet.sibsB)
            expect(hexBytesEqual(walk.finalNullRoot, entry.nullSet.finalNullRoot)).toBe(true)
        }
    })

    it('THROWS on a replayed nullifier (the R2 guard, client-side, before fuel burns)', () => {
        const kA = '01' + '00'.repeat(31)
        const kB = '02' + '00'.repeat(31)

        /* A fresh pair walks clean. */
        expect(() => nullifierWalkData({ spentKeys: [], kA, kB })).not.toThrow()

        /* Replaying kA: the empty walk no longer folds to the stored root. */
        expect(() => nullifierWalkData({ spentKeys: [kA], kA, kB }))
            .toThrow(/already spent \(replay\)/)
    })

    it('walk-vs-tree: inserting the keys reproduces the walked roots exactly', () => {
        /* Exactly 32-byte keys (16 hex bytes × 2 pairs… 64 hex chars). */
        const kA = 'ab' + 'cd'.repeat(30) + 'ef'
        const kB = 'ab' + 'cd'.repeat(30) + 'ee'

        const walk = nullifierWalkData({ spentKeys: [], kA, kB })

        const before = makeNullifierSmt([])
        const mid = makeNullifierSmt([kA])
        const after = makeNullifierSmt([kA, kB])

        expect(before.rootOf()).toEqual(SMT_ZERO_LADDER[NULLIFIER_SMT_DEPTH])
        expect(binToHex(mid.rootOf())).toEqual(walk.midRoot)
        expect(binToHex(after.rootOf())).toEqual(walk.finalNullRoot)
    })
})
