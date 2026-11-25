// src/lib/nostr/nip59.js
//
// NIP-59 gift wrap (the CashShuffle-over-Nostr transport, design §2).
//
//   rumor  = the unsigned event the sender wants to deliver
//   seal   = kind 13, content = NIP-44(rumor), pubkey = sender ephemeral,
//            signed by the sender ephemeral key
//   gift   = kind 1059, content = NIP-44(seal), pubkey = throwaway key,
//            signed by the throwaway key, with a `p` tag for the recipient
//
// The recipient unwraps: decrypt the gift with the recipient key → the seal →
// decrypt the seal with the recipient key → the rumor → verify the rumor's
// pubkey is the expected sender. Relays only ever see the gift wrap.

import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { schnorr } from '@noble/curves/secp256k1.js'

import { createEvent, signEvent, verifyEvent } from './event.js'
import { decrypt, encrypt } from './nip44.js'

export const SEAL_KIND = 13
export const GIFT_WRAP_KIND = 1059

function toBytes(value) {
    return value instanceof Uint8Array ? value : hexToBytes(String(value).replace(/^0x/, ''))
}

/* Seal a rumor to a recipient (sender ephemeral key signs the seal). */
export function sealRumor(rumor, senderPrivateKey, senderPublicKey, recipientPublicKey) {
    const content = encrypt(JSON.stringify(rumor), toBytes(senderPrivateKey), toBytes(recipientPublicKey))
    return createEvent({
        kind: SEAL_KIND,
        content,
        tags: [],
        privateKey: toBytes(senderPrivateKey),
        publicKey: toBytes(senderPublicKey),
        createdAt: rumor.created_at,
    })
}

/* Gift-wrap a seal to a recipient (a fresh throwaway key signs the wrap). */
export function giftWrap(seal, recipientPublicKey, throwawayPrivateKey, throwawayPublicKey) {
    const content = encrypt(JSON.stringify(seal), toBytes(throwawayPrivateKey), toBytes(recipientPublicKey))
    const recipientBytes = toBytes(recipientPublicKey)
    /* Nostr `p` tags carry the x-only (32-byte) key. */
    const recipientHex = bytesToHex(recipientBytes.length === 33 ? recipientBytes.slice(1) : recipientBytes)
    return createEvent({
        kind: GIFT_WRAP_KIND,
        content,
        tags: [['p', recipientHex]],
        privateKey: toBytes(throwawayPrivateKey),
        publicKey: toBytes(throwawayPublicKey),
    })
}

/* The full send: rumor → seal → gift wrap. */
export function wrapRumor({ rumor, senderPrivateKey, senderPublicKey, recipientPublicKey, throwawayPrivateKey, throwawayPublicKey }) {
    const seal = sealRumor(rumor, senderPrivateKey, senderPublicKey, recipientPublicKey)
    return giftWrap(seal, recipientPublicKey, throwawayPrivateKey, throwawayPublicKey)
}

/* Unwrap a gift wrap as the recipient: returns the rumor (or throws). */
export function unwrapGift({ gift, recipientPrivateKey, senderPublicKey }) {
    if (gift.kind !== GIFT_WRAP_KIND) throw new Error('nip59: not a gift wrap')
    if (!verifyEvent(gift)) throw new Error('nip59: invalid gift-wrap signature')
    const seal = JSON.parse(decrypt(gift.content, toBytes(recipientPrivateKey), hexToBytes(gift.pubkey)))
    if (seal.kind !== SEAL_KIND) throw new Error('nip59: not a seal')
    if (!verifyEvent(seal)) throw new Error('nip59: invalid seal signature')
    if (senderPublicKey && seal.pubkey !== (typeof senderPublicKey === 'string' ? senderPublicKey : bytesToHex(senderPublicKey))) {
        throw new Error('nip59: unexpected sender')
    }
    return JSON.parse(decrypt(seal.content, toBytes(recipientPrivateKey), hexToBytes(seal.pubkey)))
}

/* A helper for tests / callers: build a signed rumor. */
export function createRumor({ kind, content, tags = [], privateKey, publicKey, createdAt = Math.floor(Date.now() / 1000) }) {
    return signEvent({ pubkey: bytesToHex(publicKey), created_at: createdAt, kind, tags, content }, privateKey)
}
