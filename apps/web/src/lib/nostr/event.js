// src/lib/nostr/event.js
//
// Nostr event serialization + Schnorr signing (the CashShuffle-over-Nostr
// transport, design §2).
//
//   id   = SHA256(JSON.stringify([0, pubkey, created_at, kind, tags, content]))
//   sig  = Schnorr(id, privateKey)   (64-byte BIP-340)
//
// The event id is the SHA-256 of the canonical serialization; the signature is
// BIP-340 Schnorr over that id. Verification is the same hash + schnorr.verify.
// The module is transport-free.

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

export function serializeEvent(event) {
    return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags || [], event.content || ''])
}

export function getEventHash(event) {
    return bytesToHex(sha256(utf8ToBytes(serializeEvent(event))))
}

export function signEvent(event, privateKey) {
    const id = getEventHash(event)
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), privateKey))
    return { ...event, id, sig }
}

export function verifyEvent(event) {
    try {
        if (getEventHash(event) !== event.id) return false
        return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))
    } catch {
        return false
    }
}

export function createEvent({ kind, content = '', tags = [], privateKey, publicKey, createdAt = Math.floor(Date.now() / 1000) }) {
    return signEvent({ pubkey: bytesToHex(publicKey), created_at: createdAt, kind, tags, content }, privateKey)
}
