import { describe, expect, it, vi } from 'vitest'

import { Relay } from '@/lib/nostr/relay'

class MockWebSocket {
    static instances = []
    constructor(url) {
        this.url = url
        this.sent = []
        this.onopen = null
        this.onmessage = null
        this.onclose = null
        this.onerror = null
        MockWebSocket.instances.push(this)
    }
    send(data) { this.sent.push(JSON.parse(data)) }
    close() { this.onclose?.() }
    open() { this.onopen?.() }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }) }
}

const relay = (opts = {}) => new Relay('wss://relay.example', { WebSocketImpl: MockWebSocket, ...opts })

describe('lib/nostr/relay', () => {
    it('connects, publishes and resolves on OK', async () => {
        const r = relay()
        r.connect()
        const socket = r.socket
        socket.open()
        const promise = r.publish({ id: 'evt-1' })
        expect(socket.sent[0]).toEqual(['EVENT', { id: 'evt-1' }])
        socket.receive(['OK', 'evt-1', true, ''])
        await expect(promise).resolves.toEqual({ id: 'evt-1', message: '' })
    })

    it('rejects on a relay OK=false', async () => {
        const r = relay()
        r.connect()
        r.socket.open()
        const promise = r.publish({ id: 'evt-2' })
        r.socket.receive(['OK', 'evt-2', false, 'blocked'])
        await expect(promise).rejects.toThrow('blocked')
    })

    it('subscribes, routes EVENT by subscription, and unsubscribes', () => {
        const onEvent = vi.fn()
        const r = relay({ onEvent })
        r.connect()
        const socket = r.socket
        socket.open()
        const subId = r.subscribe([{ kinds: [1059] }])
        expect(socket.sent[0][0]).toBe('REQ')
        expect(socket.sent[0][1]).toBe(subId)
        socket.receive(['EVENT', subId, { id: 'gift-1' }])
        expect(onEvent).toHaveBeenCalledWith({ id: 'gift-1' })
        r.unsubscribe(subId)
        expect(socket.sent[1]).toEqual(['CLOSE', subId])
    })

    it('captures the AUTH challenge and sends the signed AUTH event', async () => {
        const onAuth = vi.fn()
        const r = relay({ onAuth })
        r.connect()
        const socket = r.socket
        socket.open()
        socket.receive(['AUTH', 'challenge-1'])
        expect(onAuth).toHaveBeenCalledWith('challenge-1')
        const sign = vi.fn(async () => ({ id: 'auth-evt' }))
        await r.authenticate(sign)
        expect(sign).toHaveBeenCalledWith('challenge-1', 'wss://relay.example')
        expect(socket.sent[0]).toEqual(['AUTH', { id: 'auth-evt' }])
    })

    it('delivers NOTICE and resets state on close', () => {
        const onNotice = vi.fn()
        const onClose = vi.fn()
        const r = relay({ onNotice, onClose })
        r.connect()
        const socket = r.socket
        socket.open()
        socket.receive(['NOTICE', 'rate limited'])
        expect(onNotice).toHaveBeenCalledWith('rate limited')
        socket.close()
        expect(r.state).toBe('closed')
        expect(r.socket).toBeNull()
        expect(onClose).toHaveBeenCalled()
    })

    it('re-sends subscriptions on open', () => {
        const r = relay()
        r.connect()
        const socket = r.socket
        socket.open()
        const subId = r.subscribe([{ kinds: [1] }])
        socket.sent.length = 0
        socket.open()
        expect(socket.sent[0]).toEqual(['REQ', subId, { kinds: [1] }])
    })
})
