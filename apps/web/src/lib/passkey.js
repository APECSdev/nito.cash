/*
 * Passkey (WebAuthn) backup of the wallet's BIP39 recovery phrase.
 *
 * MODEL (user-confirmed: "i've been using PRF extension with my other
 * implementation"): the WebAuthn PRF extension. The authenticator holds a
 * per-credential secret that never leaves the device; we feed it a fixed
 * domain salt and receive a 32-byte pseudo-random output. That output is
 * run through HKDF-SHA256 and used as an AES-256-GCM key which encrypts the
 * recovery phrase. The ciphertext lives in localStorage; the KEY DOES NOT
 * EXIST ANYWHERE except inside the authenticator (re-derived on every
 * assertion, after user verification). Consequently:
 *
 *   - An attacker with full read access to browser storage gets a
 *     ciphertext they cannot decrypt.
 *   - Restoring requires the passkey (synced passkeys carry the credential
 *     to the user's other devices, per their provider).
 *   - NOTHING is ever sent to a server.
 *
 * There is deliberately NO silent fallback: if the authenticator does not
 * report PRF support we REFUSE rather than store something that only looks
 * protected (passkey-gated obfuscation is not encryption).
 *
 * Feature support must be detected at RUNTIME (see createPasskeyBackup):
 * `getClientExtensionResults().prf.enabled` tells us whether the
 * authenticator processed the extension, and some authenticators return
 * `prf.results.first` at creation while others only enable it and require a
 * follow-up assertion — both paths are handled below.
 */

/* localStorage key holding the encrypted backup record. */
export const STORAGE_KEY = 'nito.passkey.v1'

/* Fixed PRF evaluation salt (domain-separated, stable across sessions —
   changing it makes existing backups undecryptable). */
export const PRF_SALT = new TextEncoder().encode('nito-cash/passkey/v1/prf')

/* HKDF info string (separates the AES key from any other use of the output). */
const HKDF_INFO = new TextEncoder().encode('nito-cash/passkey/v1/aes-gcm')

/* ---- base64url helpers (credential ids are ArrayBuffers) ---- */

const bytesToB64u = (_bytes) => {
    let binary = ''
    const bytes = new Uint8Array(_bytes)
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const b64uToBytes = (_string) => {
    const padded = _string.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '==='.slice((padded.length + 3) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }

    return bytes
}

/* ---- capability + stored-record helpers ---- */

/* TRUE when this browser exposes the WebAuthn credential API at all. */
export function passkeySupported() {
    return !!(typeof window !== 'undefined' &&
        window.PublicKeyCredential &&
        navigator.credentials &&
        typeof navigator.credentials.create === 'function' &&
        typeof navigator.credentials.get === 'function' &&
        window.crypto && window.crypto.subtle)
}

/* The stored (encrypted) backup record, or null. */
export function getPasskeyRecord() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) {
            return null
        }

        const record = JSON.parse(raw)

        /* Minimal shape validation (a corrupt record is treated as absent). */
        if (!record || record.v !== 1 || !record.credentialId || !record.iv || !record.ct) {
            return null
        }

        return record
    } catch (err) {
        console.error('PASSKEY: unreadable record', err) // eslint-disable-line no-console

        return null
    }
}

/* TRUE when a backup is stored in this browser. */
export function hasPasskeyBackup() {
    return !!getPasskeyRecord()
}

/* Remove the stored backup record (the passkey itself is NOT deleted). */
export function forgetPasskeyBackup() {
    window.localStorage.removeItem(STORAGE_KEY)
}

/* ---- key derivation ---- */

/*
 * Turn a PRF output (32 bytes) into a non-extractable AES-256-GCM key.
 * HKDF keeps the AES key domain-separated from the raw PRF output.
 */
async function aesKeyFromPrfOutput(_first) {
    const base = await window.crypto.subtle.importKey(
        'raw',
        new Uint8Array(_first),
        'HKDF',
        false,
        ['deriveKey'],
    )

    return window.crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: HKDF_INFO },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    )
}

/* ---- WebAuthn ---- */

/* Relying-party id: the current host (nito.cash / www.nito.cash / localhost). */
const rpId = () => window.location.hostname

/* Ask the (already registered) credential for a PRF evaluation. */
async function evaluatePrf(_credentialId, _salt) {
    const assertion = await navigator.credentials.get({
        publicKey: {
            challenge: window.crypto.getRandomValues(new Uint8Array(32)),
            rpId: rpId(),
            allowCredentials: [{ type: 'public-key', id: b64uToBytes(_credentialId) }],
            userVerification: 'required',
            timeout: 60000,
            extensions: { prf: { eval: { first: new Uint8Array(_salt) } } },
        },
    })

    const results = assertion && assertion.getClientExtensionResults()
    const prf = results && results.prf
    const first = prf && prf.results && prf.results.first

    if (!first) {
        throw new Error('This passkey did not return a PRF result (extension unsupported by the authenticator).')
    }

    return first
}

/**
 * Create a passkey and store the phrase encrypted under its PRF output.
 *
 * @param {String} _phrase - BIP39 recovery phrase (12/15/18/21/24 words).
 * @returns {Object} the stored record (ciphertext only — never the phrase).
 */
export async function createPasskeyBackup(_phrase) {
    if (!passkeySupported()) {
        throw new Error('This browser does not support passkeys.')
    }

    if (!_phrase || typeof _phrase !== 'string') {
        throw new Error('No recovery phrase available to save.')
    }

    /* Create the credential (platform authenticator, user verification
       REQUIRED — the passkey must be unlocked by the user each time). */
    const credential = await navigator.credentials.create({
        publicKey: {
            challenge: window.crypto.getRandomValues(new Uint8Array(32)),
            rp: { id: rpId(), name: 'Nito Cash' },
            user: {
                id: window.crypto.getRandomValues(new Uint8Array(16)),
                name: 'Nito Cash wallet',
                displayName: 'Nito Cash wallet',
            },
            pubKeyCredParams: [
                { type: 'public-key', alg: -7 },   // ES256
                { type: 'public-key', alg: -257 }, // RS256
            ],
            authenticatorSelection: {
                userVerification: 'required',
                residentKey: 'preferred',
            },
            timeout: 60000,
            attestation: 'none',
            extensions: { prf: { eval: { first: PRF_SALT } } },
        },
    })

    if (!credential) {
        throw new Error('Passkey creation was cancelled.')
    }

    const credentialId = bytesToB64u(credential.rawId)
    const extensions = credential.getClientExtensionResults()
    const prf = extensions && extensions.prf

    /* No `enabled` flag means the authenticator ignored the extension —
       REFUSE rather than store a phrase we cannot actually protect. */
    if (!prf || !prf.enabled) {
        throw new Error('This authenticator does not support the PRF extension, so the phrase cannot be encrypted to it.')
    }

    /* Some authenticators return the PRF output at creation; others only
       enable it and require an assertion. */
    const first = (prf.results && prf.results.first)
        ? prf.results.first
        : await evaluatePrf(credentialId, PRF_SALT)

    /* Encrypt the phrase. */
    const key = await aesKeyFromPrfOutput(first)
    const iv = window.crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(_phrase)
    const ciphertext = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)

    /* Persist the record (ciphertext + credential id + salt). */
    const record = {
        v: 1,
        credentialId,
        salt: bytesToB64u(PRF_SALT),
        iv: bytesToB64u(iv),
        ct: bytesToB64u(ciphertext),
        createdAt: new Date().toISOString(),
        rpId: rpId(),
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))

    return record
}

/**
 * Unlock the stored backup with the passkey and return the recovery phrase.
 * Throws when no backup exists, the passkey is rejected, or decryption
 * fails (wrong credential / tampered ciphertext).
 *
 * @returns {String} the BIP39 recovery phrase.
 */
export async function unlockWithPasskey() {
    const record = getPasskeyRecord()

    if (!record) {
        throw new Error('No passkey backup found in this browser.')
    }

    const salt = record.salt ? b64uToBytes(record.salt) : PRF_SALT
    const first = await evaluatePrf(record.credentialId, salt)

    const key = await aesKeyFromPrfOutput(first)

    let plaintext
    try {
        plaintext = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: b64uToBytes(record.iv) },
            key,
            b64uToBytes(record.ct),
        )
    } catch (err) {
        /* AES-GCM authenticates: a wrong key / altered ciphertext throws. */
        throw new Error('Could not decrypt the passkey backup (wrong passkey or tampered data).')
    }

    return new TextDecoder().decode(plaintext)
}
