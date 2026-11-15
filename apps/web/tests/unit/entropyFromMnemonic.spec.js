import { describe, expect, it } from 'vitest'

/* Import crypto helpers under test. */
import { entropyFromMnemonic, mnemonicFromEntropy, randomHex } from '@/lib/bch/crypto.js'

/* Canonical BIP39 test vectors (all-zero entropies, trezor vectors). */
const V12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const V24 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'

describe('entropyFromMnemonic (seed-phrase restore)', () => {
    it('decodes the canonical 12-word zero vector', () => {
        expect(entropyFromMnemonic(V12)).toBe('00000000000000000000000000000000')
    })

    it('decodes the canonical 24-word zero vector', () => {
        expect(entropyFromMnemonic(V24))
            .toBe('0000000000000000000000000000000000000000000000000000000000000000')
    })

    it('round-trips with mnemonicFromEntropy (32-byte entropy)', () => {
        const entropy = randomHex(32)
        expect(entropyFromMnemonic(mnemonicFromEntropy(entropy))).toBe(entropy)
    })

    it('normalizes case and whitespace', () => {
        expect(entropyFromMnemonic(V12.toUpperCase().split(' ').join('  ')))
            .toBe('00000000000000000000000000000000')
    })

    it('rejects wrong word counts', () => {
        expect(() => entropyFromMnemonic('abandon abandon about')).toThrow(/12, 15, 18, 21 or 24 words/)
    })

    it('rejects an invalid checksum', () => {
        /* 12 identical words -> valid count, invalid BIP39 checksum. */
        expect(() => entropyFromMnemonic('abandon '.repeat(12).trim())).toThrow()
    })

    it('rejects an empty phrase', () => {
        expect(() => entropyFromMnemonic('')).toThrow()
    })
})
