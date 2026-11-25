import { describe, expect, it } from 'vitest'
import * as secp256k1 from '@noble/secp256k1'
import { bytesToHex } from '@noble/hashes/utils.js'

import { decrypt, encrypt, NIP44_VERSION } from '@/lib/nostr/nip44'

const alice = secp256k1.utils.randomPrivateKey()
const bob = secp256k1.utils.randomPrivateKey()
const alicePub = secp256k1.getPublicKey(alice, true)
const bobPub = secp256k1.getPublicKey(bob, true)

describe('lib/nostr/nip44', () => {
    it('round-trips a message both ways', () => {
        const payload = encrypt('hello cashshuffle', alice, bobPub)
        expect(decrypt(payload, bob, alicePub)).toBe('hello cashshuffle')
        const reply = encrypt('round accepted', bob, alicePub)
        expect(decrypt(reply, alice, bobPub)).toBe('round accepted')
    })

    it('is versioned and random per message', () => {
        const a = encrypt('same', alice, bobPub)
        const b = encrypt('same', alice, bobPub)
        expect(a).not.toBe(b)
        expect(NIP44_VERSION).toBe(2)
    })

    it('rejects a tampered payload', () => {
        const payload = encrypt('tamper me', alice, bobPub)
        const raw = Buffer.from(payload, 'base64')
        raw[raw.length - 1] ^= 0x01
        expect(() => decrypt(raw.toString('base64'), bob, alicePub)).toThrow('invalid MAC')
    })

    it('rejects a wrong key', () => {
        const payload = encrypt('secret', alice, bobPub)
        const eve = secp256k1.utils.randomPrivateKey()
        expect(() => decrypt(payload, eve, alicePub)).toThrow('invalid MAC')
    })

    it('handles long messages (padding)', () => {
        const text = 'x'.repeat(1000)
        const payload = encrypt(text, alice, bobPub)
        expect(decrypt(payload, bob, alicePub)).toBe(text)
    })

    it('derives the same conversation key on both sides', () => {
        const a = secp256k1.getSharedSecret(alice, bobPub).slice(1, 33)
        const b = secp256k1.getSharedSecret(bob, alicePub).slice(1, 33)
        expect(bytesToHex(a)).toBe(bytesToHex(b))
    })
})
