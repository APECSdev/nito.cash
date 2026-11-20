/* Unit tests for src/lib/passkey.js (WebAuthn PRF -> HKDF -> AES-256-GCM).
 *
 * jsdom has no SubtleCrypto and no WebAuthn, so both are provided here:
 *   - crypto is swapped for Node's WebCrypto (real AES-GCM / HKDF),
 *   - navigator.credentials.create/get are mocks that emulate a PRF-capable
 *     authenticator (and a PRF-LESS one, to prove we refuse to downgrade).
 */
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* Swap in the real WebCrypto BEFORE the module is imported (jsdom's
   window.crypto has getRandomValues but NO SubtleCrypto). */
Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true })

/* jsdom exposes no WebAuthn API at all — provide the marker the capability
   check looks for (the credential methods are installed per test). */
window.PublicKeyCredential = function PublicKeyCredential() {}

import {
    STORAGE_KEY,
    createPasskeyBackup,
    forgetPasskeyBackup,
    getPasskeyRecord,
    hasPasskeyBackup,
    passkeySupported,
    unlockWithPasskey,
} from '@/lib/passkey.js'

/* Deterministic 32-byte PRF output. */
const PRF_OUTPUT = new Uint8Array(32).fill(7)

/* Build a fake credential / assertion with the given extension results. */
const fakeCredential = (extensions, id = new Uint8Array(32).fill(3)) => ({
    rawId: id.buffer.slice(id.byteOffset, id.byteOffset + id.byteLength),
    getClientExtensionResults: () => extensions,
})

/* Install a PRF-capable (or PRF-less) authenticator. */
const installAuthenticator = ({ prf = true, resultsAtCreation = true, fail = null } = {}) => {
    navigator.credentials = {
        create: vi.fn(async () => {
            if (fail) throw fail

            const extensions = prf
                ? (resultsAtCreation
                    ? { prf: { enabled: true, results: { first: PRF_OUTPUT } } }
                    : { prf: { enabled: true } })
                : { prf: { enabled: false } }

            return fakeCredential(extensions)
        }),
        get: vi.fn(async () => {
            if (fail) throw fail

            return fakeCredential({ prf: { enabled: true, results: { first: PRF_OUTPUT } } })
        }),
    }
}

beforeEach(() => {
    window.localStorage.clear()
    installAuthenticator()
})

afterEach(() => {
    delete navigator.credentials
    vi.restoreAllMocks()
})

describe('lib/passkey', () => {
    it('reports support based on the WebAuthn + WebCrypto APIs', () => {
        expect(passkeySupported()).toBe(true)

        const saved = navigator.credentials
        delete navigator.credentials
        expect(passkeySupported()).toBe(false)
        navigator.credentials = saved
    })

    it('has no record initially', () => {
        expect(getPasskeyRecord()).toBeNull()
        expect(hasPasskeyBackup()).toBe(false)
    })

    it('encrypts the phrase with the PRF-derived key and stores ONLY ciphertext', async () => {
        const phrase = 'abandon ability able about above absent absorb abstract absurd abuse access accident'

        const record = await createPasskeyBackup(phrase)

        expect(record.v).toBe(1)
        expect(record.credentialId).toBeTruthy()
        expect(record.iv).toBeTruthy()
        expect(record.ct).toBeTruthy()
        expect(record.rpId).toBe(window.location.hostname)

        /* The stored blob must NOT contain the plaintext phrase. */
        const raw = window.localStorage.getItem(STORAGE_KEY)
        expect(raw).toBeTruthy()
        expect(raw).not.toContain('abandon')
        expect(raw).not.toContain('accident')
        expect(hasPasskeyBackup()).toBe(true)
    })

    it('round-trips the phrase (decrypt) after creation', async () => {
        const phrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

        await createPasskeyBackup(phrase)

        await expect(unlockWithPasskey()).resolves.toBe(phrase)
    })

    it('falls back to an assertion when the authenticator only ENABLES prf at creation', async () => {
        installAuthenticator({ resultsAtCreation: false })

        const phrase = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'
        await createPasskeyBackup(phrase)

        expect(navigator.credentials.get).toHaveBeenCalled()

        await expect(unlockWithPasskey()).resolves.toBe(phrase)
    })

    it('REFUSES (and stores nothing) when the authenticator has no PRF support', async () => {
        installAuthenticator({ prf: false })

        await expect(createPasskeyBackup('abandon ability able about above absent')).rejects
            .toThrow(/does not support the PRF extension/i)

        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    })

    it('rejects a cancelled passkey prompt', async () => {
        const err = new Error('The operation either timed out or was not allowed.')
        err.name = 'NotAllowedError'
        installAuthenticator({ fail: err })

        await expect(createPasskeyBackup('abandon ability able')).rejects.toThrow(/timed out|not allowed/i)
    })

    it('rejects an empty phrase', async () => {
        await expect(createPasskeyBackup('')).rejects.toThrow(/No recovery phrase/i)
    })

    it('rejects unlock when no backup exists', async () => {
        await expect(unlockWithPasskey()).rejects.toThrow(/No passkey backup/i)
    })

    it('fails authentication when the ciphertext is tampered with', async () => {
        await createPasskeyBackup('abandon ability able about above absent absorb abstract absurd abuse access accident')

        /* Flip the last byte of the ciphertext. */
        const record = getPasskeyRecord()
        const bytes = Buffer.from(record.ct.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
        bytes[bytes.length - 1] ^= 0xff
        record.ct = bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))

        await expect(unlockWithPasskey()).rejects.toThrow(/Could not decrypt/i)
    })

    it('ignores a corrupt stored record', () => {
        window.localStorage.setItem(STORAGE_KEY, '{not json')
        expect(getPasskeyRecord()).toBeNull()

        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, ct: 'x' }))
        expect(getPasskeyRecord()).toBeNull()
    })

    it('forgets the stored record', async () => {
        await createPasskeyBackup('abandon ability able about above absent')
        expect(hasPasskeyBackup()).toBe(true)

        forgetPasskeyBackup()

        expect(hasPasskeyBackup()).toBe(false)
        expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    })
})
