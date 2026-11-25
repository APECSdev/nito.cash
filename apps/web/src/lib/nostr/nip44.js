// src/lib/nostr/nip44.js
//
// NIP-44 v2 encryption (the CashShuffle-over-Nostr transport, design §2).
//
//   shared_x  = secp256k1 ECDH(sender_priv, recipient_pub).x  (32 B)
//   key       = HKDF-SHA256(ikm=shared_x, salt="nip44-v2", info=nonce, 76 B)
//   chacha_key = key[0..32], chacha_nonce = key[32..44], hmac_key = key[44..76]
//   padded    = length-prefixed padding (4-byte BE length + zero padding)
//   ciphertext= ChaCha20(chacha_key, chacha_nonce, padded)
//   mac       = HMAC-SHA256(hmac_key, nonce ‖ ciphertext)
//   payload   = base64(0x02 ‖ nonce(32) ‖ ciphertext ‖ mac(32))
//
// The payload is versioned (0x02) and self-describing; the nonce is random per
// message. This is the exact NIP-44 v2 layout (the v2 spec), not a custom
// scheme. The module is transport-free and testable offline.

import { chacha20 } from '@noble/ciphers/chacha.js'
import * as secp256k1 from '@noble/secp256k1'
import { hkdf } from '@noble/hashes/hkdf.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'
import { base64 } from '@scure/base'

export const NIP44_VERSION = 2
export const NIP44_SALT = new TextEncoder().encode('nip44-v2')
const MIN_PLAINTEXT = 1
const MAX_PLAINTEXT = 65535

/* Official NIP-44 v2 padding: a 2-byte BE length + the plaintext + zero
   padding to the next chunk boundary. The chunk sizes are 32, 64, 128, 256,
   512, 1024, 2048, 4096, 8192, 16384, 32768, 65536 (the v2 spec). */
const CHUNK_SIZES = [32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536]

function paddedLength(len) {
    const needed = len + 2
    const chunk = CHUNK_SIZES.find((size) => size >= needed)
    if (!chunk) throw new Error('nip44: plaintext too long')
    return chunk
}

function pad(plaintext) {
    const len = plaintext.length
    if (len < MIN_PLAINTEXT || len > MAX_PLAINTEXT) throw new Error('nip44: invalid plaintext length')
    const padded = new Uint8Array(paddedLength(len))
    new DataView(padded.buffer).setUint16(0, len, false)
    padded.set(plaintext, 2)
    return padded
}

function unpad(padded) {
    const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength)
    const len = view.getUint16(0, false)
    if (len < MIN_PLAINTEXT || len > MAX_PLAINTEXT || len + 2 > padded.length) throw new Error('nip44: invalid padding')
    return padded.slice(2, 2 + len)
}

function conversationKey(privateKey, publicKey) {
    /* Nostr public keys are x-only (32 B); the ECDH needs a compressed point.
       Prefix 0x02 (the even-y convention) when the caller passes x-only. */
    const compressed = publicKey.length === 32 ? new Uint8Array([0x02, ...publicKey]) : publicKey
    const shared = secp256k1.getSharedSecret(privateKey, compressed)
    return shared.slice(1, 33)
}

export function encrypt(plaintext, privateKey, publicKey, nonce = randomBytes(32)) {
    const text = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext
    const key = hkdf(sha256, conversationKey(privateKey, publicKey), NIP44_SALT, nonce, 76)
    const chachaKey = key.slice(0, 32)
    const chachaNonce = key.slice(32, 44)
    const hmacKey = key.slice(44, 76)
    const ciphertext = chacha20(chachaKey, chachaNonce, pad(text))
    const mac = hmac(sha256, hmacKey, new Uint8Array([...nonce, ...ciphertext]))
    return base64.encode(new Uint8Array([NIP44_VERSION, ...nonce, ...ciphertext, ...mac]))
}

export function decrypt(payload, privateKey, publicKey) {
    const raw = base64.decode(payload)
    if (raw[0] !== NIP44_VERSION) throw new Error('nip44: unsupported version')
    const nonce = raw.slice(1, 33)
    const ciphertext = raw.slice(33, raw.length - 32)
    const mac = raw.slice(raw.length - 32)
    const key = hkdf(sha256, conversationKey(privateKey, publicKey), NIP44_SALT, nonce, 76)
    const chachaKey = key.slice(0, 32)
    const chachaNonce = key.slice(32, 44)
    const hmacKey = key.slice(44, 76)
    const expected = hmac(sha256, hmacKey, new Uint8Array([...nonce, ...ciphertext]))
    if (bytesToHex(expected) !== bytesToHex(mac)) throw new Error('nip44: invalid MAC')
    return new TextDecoder().decode(unpad(chacha20(chachaKey, chachaNonce, ciphertext)))
}

/* Convenience for the tests / callers that hold hex keys. */
export function encryptHex(plaintext, privateKeyHex, publicKeyHex, nonceHex) {
    return encrypt(plaintext, hexToBytes(privateKeyHex), hexToBytes(publicKeyHex), nonceHex ? hexToBytes(nonceHex) : undefined)
}

export function decryptHex(payload, privateKeyHex, publicKeyHex) {
    return decrypt(payload, hexToBytes(privateKeyHex), hexToBytes(publicKeyHex))
}
