// apps/web/tests/unit/lib/pool-seal.spec.js
//
// Round-trip and failure-mode tests for the note-store at-rest encryption
// (src/lib/pool/seal.js). Vitest runs in jsdom, whose crypto exposes only
// getRandomValues, so seal.js falls back to Node's webcrypto — both paths
// are real AES-256-GCM.

import { describe, expect, it } from 'vitest'

import { deriveSealKey, sealJSON, unsealJSON } from '@/lib/pool/seal.js'

/* A 32-byte entropy hex string, as profile.ms holds it. */
const ENTROPY = 'ab'.repeat(32)

/* A note-shaped payload (field elements as decimal strings, as the pool
   store keeps them). */
function sampleNotes() {
    return [
        {
            value: '1000',
            ownerPub: '1234',
            rho: '18821383157269793795438455681495246036402687001665670618754263018637548127333',
            r: '42',
            nk: '7',
            cm: '999',
            nf: '888',
            leafIndex: 0,
            spent: false,
        },
    ]
}

describe('pool seal', () => {
    it('round-trips a note list through seal/unseal', async () => {
        const key = await deriveSealKey(ENTROPY)
        const notes = sampleNotes()

        const sealed = await sealJSON(notes, key)

        expect(typeof sealed.iv).toBe('string')
        expect(typeof sealed.ct).toBe('string')
        expect(JSON.stringify(sealed)).not.toContain('18821383')

        expect(await unsealJSON(sealed, key)).toEqual(notes)
    })

    it('derives the same key deterministically from the same entropy', async () => {
        const keyA = await deriveSealKey(ENTROPY)
        const keyB = await deriveSealKey(ENTROPY)

        const sealed = await sealJSON(sampleNotes(), keyA)

        expect(await unsealJSON(sealed, keyB)).toEqual(sampleNotes())
    })

    it('uses a fresh IV per seal (ciphertexts differ for identical input)', async () => {
        const key = await deriveSealKey(ENTROPY)

        const a = await sealJSON(sampleNotes(), key)
        const b = await sealJSON(sampleNotes(), key)

        expect(a.iv).not.toBe(b.iv)
        expect(a.ct).not.toBe(b.ct)
        expect(await unsealJSON(b, key)).toEqual(sampleNotes())
    })

    it('rejects a key derived from different entropy', async () => {
        const key = await deriveSealKey(ENTROPY)
        const wrongKey = await deriveSealKey('cd'.repeat(32))

        const sealed = await sealJSON(sampleNotes(), key)

        await expect(unsealJSON(sealed, wrongKey)).rejects.toThrow()
    })

    it('rejects a key derived for a different account', async () => {
        const key = await deriveSealKey(ENTROPY, 0)
        const wrongKey = await deriveSealKey(ENTROPY, 1)

        const sealed = await sealJSON(sampleNotes(), key)

        await expect(unsealJSON(sealed, wrongKey)).rejects.toThrow()
    })

    it('rejects a tampered ciphertext (GCM authentication)', async () => {
        const key = await deriveSealKey(ENTROPY)

        const sealed = await sealJSON(sampleNotes(), key)
        const bin = atob(sealed.ct)
        const flipped = btoa(
            String.fromCharCode(bin.charCodeAt(0) ^ 1) + bin.slice(1),
        )

        await expect(unsealJSON({ ...sealed, ct: flipped }, key)).rejects.toThrow()
    })
})
