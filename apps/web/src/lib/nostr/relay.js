// src/lib/nostr/relay.js
//
// Nostr relay client (the CashShuffle-over-Nostr transport, design §2).
//
// A thin WebSocket wrapper over the Nostr wire protocol:
//   client → relay: ["EVENT", event] / ["REQ", subId, ...filters] / ["CLOSE", subId] / ["AUTH", event]
//   relay → client: ["EVENT", subId, event] / ["EOSE", subId] / ["OK", id, ok, message]
//                   ["NOTICE", message] / ["AUTH", challenge]
//
// The class is transport-injectable (a WebSocket implementation can be passed)
// so the protocol is testable in jsdom without a network. It owns one socket,
// the subscription map, and the auth challenge. Reconnect/backoff is the
// caller's policy (the round has its own timeout).

export const RELAY_STATES = Object.freeze(['closed', 'connecting', 'open', 'closing'])

export class Relay {
    constructor(url, { WebSocketImpl, onEvent, onNotice, onAuth, onOk, onClose } = {}) {
        if (!url) throw new Error('relay: url is required')
        this.url = url
        this.WebSocketImpl = WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null)
        this.onEvent = onEvent || (() => {})
        this.onNotice = onNotice || (() => {})
        this.onAuth = onAuth || (() => {})
        this.onOk = onOk || (() => {})
        this.onClose = onClose || (() => {})
        this.socket = null
        this.state = 'closed'
        this.subscriptions = new Map()
        this.challenge = null
        this.pending = new Map()
        this.nextSubId = 1
    }

    connect() {
        if (!this.WebSocketImpl) throw new Error('relay: no WebSocket implementation')
        if (this.socket) return this
        this.state = 'connecting'
        const socket = new this.WebSocketImpl(this.url)
        this.socket = socket
        socket.onopen = () => {
            this.state = 'open'
            for (const [subId, entry] of this.subscriptions) this.#send(['REQ', subId, ...entry.filters])
        }
        socket.onmessage = (message) => this.#handle(message.data)
        socket.onclose = () => {
            this.state = 'closed'
            this.socket = null
            this.onClose()
        }
        socket.onerror = () => {
            this.state = 'closed'
        }
        return this
    }

    /* Publish an event; resolves on the relay's OK (or rejects on a timeout). */
    publish(event, { timeout = 10000 } = {}) {
        this.connect()
        const id = event.id
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id)
                reject(new Error(`relay: no OK for ${id}`))
            }, timeout)
            this.pending.set(id, { resolve, reject, timer })
            this.#send(['EVENT', event])
        })
    }

    /* Subscribe to filters; the callback receives each event. The optional
     * third callback receives the subscription's EOSE (the "fetch is done"
     * signal the mailbox's poll-style fetches await — the round transport
     * ignores it). */
    subscribe(filters, onEvent = this.onEvent, onEose = null) {
        this.connect()
        const subId = `nito-${this.nextSubId++}`
        this.subscriptions.set(subId, { filters, onEvent, onEose })
        /* If the socket is still connecting, onopen re-sends the map. */
        if (this.state === 'open') this.#send(['REQ', subId, ...filters])
        return subId
    }

    unsubscribe(subId) {
        this.subscriptions.delete(subId)
        if (this.socket && this.state === 'open') this.#send(['CLOSE', subId])
    }

    /* NIP-42: sign the relay's challenge with the session key. */
    async authenticate(sign) {
        if (!this.challenge) throw new Error('relay: no AUTH challenge')
        const event = await sign(this.challenge, this.url)
        this.#send(['AUTH', event])
        return event
    }

    close() {
        if (this.socket) {
            this.state = 'closing'
            this.socket.close()
        }
        this.subscriptions.clear()
    }

    #send(message) {
        if (!this.socket || this.state !== 'open') throw new Error('relay: not connected')
        this.socket.send(JSON.stringify(message))
    }

    #handle(data) {
        let message
        try {
            message = JSON.parse(data)
        } catch {
            return
        }
        if (!Array.isArray(message) || message.length === 0) return
        const [type] = message
        if (type === 'EVENT') {
            const [, subId, event] = message
            const entry = this.subscriptions.get(subId)
            if (entry) entry.onEvent(event)
            else this.onEvent(event)
        } else if (type === 'EOSE') {
            const [, subId] = message
            const entry = this.subscriptions.get(subId)
            if (entry?.onEose) entry.onEose()
        } else if (type === 'OK') {
            const [, id, ok, msg] = message
            const pending = this.pending.get(id)
            if (pending) {
                clearTimeout(pending.timer)
                this.pending.delete(id)
                ok ? pending.resolve({ id, message: msg }) : pending.reject(new Error(`relay: rejected ${id}: ${msg}`))
            }
            this.onOk(id, ok, msg)
        } else if (type === 'NOTICE') {
            this.onNotice(message[1])
        } else if (type === 'AUTH') {
            this.challenge = message[1]
            this.onAuth(this.challenge)
        }
    }
}
