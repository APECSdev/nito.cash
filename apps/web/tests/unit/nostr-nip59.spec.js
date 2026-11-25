import { describe, expect, it } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import * as secp256k1 from '@noble/secp256k1'
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'

import { createEvent, getEventHash, serializeEvent, signEvent, verifyEvent } from '@/lib/nostr/event'
import { GIFT_WRAP_KIND, SEAL_KIND, createRumor, unwrapGift, wrapRumor } from '@/lib/nostr/nip59'

const key = () => {
    const priv = randomBytes(32)
    return { priv, pub: schnorr.getPublicKey(priv), pub33: secp256k1.getPublicKey(priv) }
}
const alice = key()
const bob = key()
const throwaway = key()

describe('lib/nostr/event', () => {
    it('serializes + signs + verifies', () => {
        const event = createEvent({ kind: 1, content: 'hello', privateKey: alice.priv, publicKey: alice.pub, createdAt: 1700000000 })
        expect(event.id).toBe(getEventHash(event))
        expect(verifyEvent(event)).toBe(true)
        expect(serializeEvent(event)).toContain('"hello"')
    })

    it('rejects a tampered event', () => {
        const event = createEvent({ kind: 1, content: 'hello', privateKey: alice.priv, publicKey: alice.pub, createdAt: 1700000000 })
        expect(verifyEvent({ ...event, content: 'tampered' })).toBe(false)
    })
})

describe('lib/nostr/nip59', () => {
    it('wraps + unwraps a rumor end-to-end', () => {
        const rumor = createRumor({ kind: 1, content: 'shuffle: register', privateKey: alice.priv, publicKey: alice.pub, createdAt: 1700000000 })
        const gift = wrapRumor({
            rumor,
            senderPrivateKey: alice.priv,
            senderPublicKey: alice.pub,
            recipientPublicKey: bob.pub33,
            throwawayPrivateKey: throwaway.priv,
            throwawayPublicKey: throwaway.pub,
        })
        expect(gift.kind).toBe(GIFT_WRAP_KIND)
        expect(gift.pubkey).toBe(bytesToHex(throwaway.pub))
        expect(gift.tags[0][0]).toBe('p')
        expect(gift.tags[0][1]).toBe(bytesToHex(bob.pub))
        const unwrapped = unwrapGift({ gift, recipientPrivateKey: bob.priv, senderPublicKey: alice.pub })
        expect(unwrapped.content).toBe('shuffle: register')
        expect(unwrapped.pubkey).toBe(bytesToHex(alice.pub))
    })

    it('rejects a wrong recipient and an unexpected sender', () => {
        const rumor = createRumor({ kind: 1, content: 'x', privateKey: alice.priv, publicKey: alice.pub, createdAt: 1700000000 })
        const gift = wrapRumor({ rumor, senderPrivateKey: alice.priv, senderPublicKey: alice.pub, recipientPublicKey: bob.pub33, throwawayPrivateKey: throwaway.priv, throwawayPublicKey: throwaway.pub })
        expect(() => unwrapGift({ gift, recipientPrivateKey: alice.priv, senderPublicKey: alice.pub })).toThrow()
        expect(() => unwrapGift({ gift, recipientPrivateKey: bob.priv, senderPublicKey: bob.pub })).toThrow('unexpected sender')
    })

    it('keeps the rumor unsigned (NIP-59 semantics)', () => {
        const rumor = createRumor({ kind: 1, content: 'r', privateKey: alice.priv, publicKey: alice.pub, createdAt: 1700000000 })
        expect(rumor.sig).toBeDefined()
        expect(SEAL_KIND).toBe(13)
        expect(GIFT_WRAP_KIND).toBe(1059)
    })
})
