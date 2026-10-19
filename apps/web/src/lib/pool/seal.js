// src/lib/pool/seal.js
//
// At-rest encryption for the shielded-pool note store (Chipnet PoC).
//
// The pool store keeps decrypted notes in a runtime-only mirror
// (`pool.notes`, excluded from persistence) and persists only an
// AES-256-GCM ciphertext of that list (`pool.sealed`) through the root
// persistedstate plugin. The key is derived deterministically from the
// wallet entropy, so notes are recoverable from the wallet seed alone:
//   key = sha256('nito-pool/v1/seal' || accountLE32 || entropyBytes)
//         -> AES-256-GCM (random 96-bit IV per seal)
//
// HONEST SCOPE NOTE: the profile store persists the master seed in the same
// storage, so against an attacker who can read that storage this is
// defense-in-depth (separate derived key, secrets never at rest in
// plaintext), not a hard boundary. A passphrase-gated key remains a mainnet
// prerequisite (see private-payments/roadmap).

import { webcrypto } from 'node:crypto'

import { sha256 } from '@bitauth/libauth'

import { hexToBytes } from '@/lib/bch/crypto.js'

/* WebCrypto subtle: browsers expose it on globalThis.crypto; jsdom (Vitest)
   exposes only getRandomValues, so fall back to Node's webcrypto there. The
   node:crypto import is covered by vite-plugin-node-polyfills in the browser
   bundle (unused there). */
function getSubtle() {
    if (globalThis.crypto && globalThis.crypto.subtle) {
        return globalThis.crypto.subtle
    }

    return webcrypto.subtle
}

function getRandomValues(bytes) {
    if (globalThis.crypto && globalThis.crypto.getRandomValues) {
        return globalThis.crypto.getRandomValues(bytes)
    }

    return webcrypto.getRandomValues(bytes)
}

/* base64 helpers that survive arbitrary binary bytes. */
function b64encode(bytes) {
    let bin = ''

    for (const b of bytes) {
        bin += String.fromCharCode(b)
    }

    return btoa(bin)
}

function b64decode(b64) {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)

    for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i)
    }

    return bytes
}

/*
 * Derive the note-store seal key from the wallet entropy (hex string).
 * Domain-separated and deterministic, mirroring deriveSpendKey in
 * src/lib/pool/notes.js, so notes are recoverable from the wallet seed alone.
 */
export async function deriveSealKey(entropyHex, account = 0) {
    const domain = new TextEncoder().encode('nito-pool/v1/seal')

    const accountLE = new Uint8Array(4)
    new DataView(accountLE.buffer).setUint32(0, account, true)

    const entropy = hexToBytes(entropyHex)

    const preimage = new Uint8Array(domain.length + 4 + entropy.length)
    preimage.set(domain, 0)
    preimage.set(accountLE, domain.length)
    preimage.set(entropy, domain.length + 4)

    const material = sha256.hash(preimage)

    return getSubtle().importKey(
        'raw',
        material,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt'],
    )
}

/* Encrypt a JSON-serializable value; returns { iv, ct } base64 strings. */
export async function sealJSON(value, key) {
    const iv = getRandomValues(new Uint8Array(12))
    const data = new TextEncoder().encode(JSON.stringify(value))
    const ct = new Uint8Array(
        await getSubtle().encrypt({ name: 'AES-GCM', iv }, key, data),
    )

    return { iv: b64encode(iv), ct: b64encode(ct) }
}

/* Decrypt a sealJSON blob; throws (OperationError) on wrong key or tamper. */
export async function unsealJSON(sealed, key) {
    const iv = b64decode(sealed.iv)
    const ct = b64decode(sealed.ct)
    const data = await getSubtle().decrypt({ name: 'AES-GCM', iv }, key, ct)

    return JSON.parse(new TextDecoder().decode(data))
}
