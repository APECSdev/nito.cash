// src/lib/cashshuffle/transport.js
//
// CashShuffle-over-Nostr transport (design §2): the message bus that carries
// the protocol packets over NIP-59 gift-wrapped NIP-44 events.
//
// One round = one message kind (22231). Each packet is a rumor:
//
//   { kind: 22231, round: <roundId>, type: <protocol type>, from: <x-only>,
//     to: <x-only | null>, payload: {...} }
//
// A unicast is gift-wrapped to the recipient; a broadcast is gift-wrapped to
// each pool member (the coordinator fans out). The relay only ever sees kind
// 1059 ciphertext with a `p` tag. The transport is relay-injectable for tests.

import { Relay } from '../nostr/relay.js'
import { createEvent } from '../nostr/event.js'
import { createRumor, unwrapGift, wrapRumor } from '../nostr/nip59.js'
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js'
import { schnorr } from '@noble/curves/secp256k1.js'

export const CASHSHUFFLE_KIND = 22231
export const NIP42_KIND = 22242

export class CashShuffleTransport {
    constructor({ relays, keys, roundId, onMessage, WebSocketImpl, authPolicy = 'optional' } = {}) {
        if (!Array.isArray(relays) || relays.length === 0) throw new Error('transport: at least one relay is required')
        if (!keys?.privateKey || !keys?.publicKey) throw new Error('transport: session keys are required')
        if (!roundId) throw new Error('transport: roundId is required')
        this.relays = relays
        this.keys = keys
        this.roundId = roundId
        this.onMessage = onMessage || (() => {})
        this.WebSocketImpl = WebSocketImpl
        this.authPolicy = authPolicy
        this.clients = []
        this.subscriptions = []
        this.authenticated = new Map()
    }

    connect() {
        for (const url of this.relays) {
            const relay = new Relay(url, {
                WebSocketImpl: this.WebSocketImpl,
                onEvent: (event) => this.#receive(event),
                onAuth: (challenge) => this.#authenticate(relay, url, challenge),
            })
            relay.connect()
            this.clients.push(relay)
        }
        this.#subscribe()
        return this
    }

    #subscribe() {
        const tag = bytesToHex(this.keys.publicKey)
        for (const relay of this.clients) {
            this.subscriptions.push(relay.subscribe([{ kinds: [1059], '#p': [tag] }]))
        }
    }

    /*
     * NIP-42: answer the relay's AUTH challenge with the session key.
     * The AUTH event is kind 22242 with the relay + challenge tags; the
     * relay's own `authenticate` signs/sends it. A failed AUTH is recorded,
     * not fatal (the round can continue on a relay that does not require it).
     */
    async #authenticate(relay, url, challenge) {
        if (this.authPolicy === 'none') return
        try {
            const event = createEvent({
                kind: NIP42_KIND,
                content: '',
                tags: [['relay', url], ['challenge', challenge]],
                privateKey: this.keys.privateKey,
                publicKey: this.keys.publicKey,
            })
            await relay.authenticate(async () => event)
            this.authenticated.set(url, true)
        } catch (err) {
            this.authenticated.set(url, false)
            this.lastAuthError = err.message
        }
    }

    /* Unicast one packet to a recipient. */
    async send(to, type, payload) {
        return this.#publish(to, type, payload)
    }

    /* Broadcast one packet to every pool member (the coordinator fans out). */
    async broadcast(members, type, payload) {
        /* Fan out in parallel: every member's gift is independent. */
        return Promise.all(members.map((member) => this.#publish(member, type, payload)))
    }

    async #publish(to, type, payload) {
        const rumor = createRumor({
            kind: CASHSHUFFLE_KIND,
            content: JSON.stringify({ round: this.roundId, type, from: bytesToHex(this.keys.publicKey), to, payload }),
            tags: [],
            privateKey: this.keys.privateKey,
            publicKey: this.keys.publicKey,
        })
        const throwawayPrivateKey = randomBytes(32)
        const throwawayPublicKey = schnorr.getPublicKey(throwawayPrivateKey)
        const gift = wrapRumor({
            rumor,
            senderPrivateKey: this.keys.privateKey,
            senderPublicKey: this.keys.publicKey,
            recipientPublicKey: to,
            throwawayPrivateKey,
            throwawayPublicKey,
        })
        const relay = this.clients[0]
        if (!relay) throw new Error('transport: not connected')
        if (this.authPolicy === 'required' && this.authenticated.get(relay.url) !== true) {
            throw new Error('transport: relay authentication is required but failed')
        }
        return relay.publish(gift)
    }

    #receive(event) {
        if (event.kind !== 1059) return
        let packet
        try {
            const rumor = unwrapGift({ gift: event, recipientPrivateKey: this.keys.privateKey })
            packet = JSON.parse(rumor.content)
        } catch {
            return
        }
        if (packet.round !== this.roundId) return
        this.onMessage(packet)
    }

    close() {
        for (const relay of this.clients) relay.close()
        this.clients = []
        this.subscriptions = []
    }
}
