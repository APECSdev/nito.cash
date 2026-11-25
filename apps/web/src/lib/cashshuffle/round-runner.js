// src/lib/cashshuffle/round-runner.js
//
// The CashShuffle round runner: protocol + transport, one object.
//
// The runner assumes an explicit peer set (the out-of-band invite — live pool
// discovery is design-only). Every peer runs this class; the transport carries
// the packets; the protocol core owns the phase/coordinator/blame rules. The
// coordinator is the lowest ephemeral pubkey, computed once the pool fills.
//
// The runner is transport-injectable: the tests pass a fake transport, the
// Desk passes the real CashShuffleTransport.

import { bytesToHex } from '@noble/hashes/utils.js'

import {
    PHASES,
    advance,
    announcement,
    blame,
    broadcast,
    createRound,
    register,
    shuffle,
    signing,
    verify,
    snapshot,
} from './protocol.js'

export class CashShuffleRound {
    constructor({ transport, keys, roundId, poolSize = 5, onUpdate } = {}) {
        if (!transport) throw new Error('round-runner: a transport is required')
        if (!keys?.publicKey) throw new Error('round-runner: session keys are required')
        if (!roundId) throw new Error('round-runner: roundId is required')
        this.transport = transport
        this.keys = keys
        this.roundId = roundId
        this.poolSize = poolSize
        this.onUpdate = onUpdate || (() => {})
        this.round = createRound({ roundId, relay: 'transport', poolSize })
        this.peers = []
        this.closed = false
    }

    get self() {
        return bytesToHex(this.keys.publicKey)
    }

    get isCoordinator() {
        return this.round.coordinator === this.self
    }

    snapshot() {
        return snapshot(this.round)
    }

    #notify() {
        this.onUpdate(this.snapshot())
    }

    /* Join: broadcast our registration to the explicit peer set. */
    async join(amount) {
        register(this.round, { key: this.self, amount })
        await this.transport.broadcast(this.peers, 'REGISTER', { amount: String(amount) })
        this.#notify()
    }

    /* The transport callback: route one packet into the protocol. */
    async onMessage(packet) {
        if (this.closed) return
        const { type, from, payload } = packet
        try {
            if (type === 'REGISTER') {
                if (!this.peers.includes(from)) this.peers.push(from)
                register(this.round, { key: from, amount: payload?.amount })
            } else if (type === 'ANNOUNCEMENT') {
                announcement(this.round, { from })
            } else if (type === 'SHUFFLE') {
                shuffle(this.round, { from, onion: payload?.onion })
                if (this.round.phase === 'SHUFFLE' && this.round.players.length === this.round.poolSize) advance(this.round)
            } else if (type === 'VERIFY') {
                verify(this.round, { from, transaction: payload?.transaction, expectedOutputs: payload?.expectedOutputs })
                if (this.round.phase === 'VERIFY') advance(this.round)
            } else if (type === 'SIGNING') {
                signing(this.round, { from, signature: payload?.signature })
                if (this.round.phase === 'SIGNING' && this.round.players.length === this.round.poolSize) advance(this.round)
            } else if (type === 'BROADCAST') {
                broadcast(this.round, { from, txid: payload?.txid })
            } else if (type === 'BLAME') {
                blame(this.round, { from, accused: payload?.accused, reason: payload?.reason })
            }
        } catch (err) {
            /* Out-of-phase or unauthorized packets are dropped, not fatal. */
            this.lastError = err.message
        }
        this.#notify()
    }

    /* Coordinator step: open the shuffle phase. */
    async announce() {
        if (!this.isCoordinator) throw new Error('round-runner: only the coordinator can announce')
        announcement(this.round, { from: this.self })
        await this.transport.broadcast(this.peers, 'ANNOUNCEMENT', {})
        this.#notify()
    }

    /* Contribute the onion; the coordinator advances to signing after the tally. */
    async contribute(onion) {
        shuffle(this.round, { from: this.self, onion })
        await this.transport.broadcast(this.peers, 'SHUFFLE', { onion })
        this.#notify()
    }

    /* Coordinator step: advance the phase after a tally. */
    async advancePhase() {
        advance(this.round)
        this.#notify()
    }

    /* Sign the final tx and broadcast the signature. */
    async sign(signature) {
        signing(this.round, { from: this.self, signature })
        await this.transport.broadcast(this.peers, 'SIGNING', { signature })
        this.#notify()
    }

    /* Coordinator step: broadcast the txid. */
    async publish(txid) {
        if (!this.isCoordinator) throw new Error('round-runner: only the coordinator can broadcast')
        broadcast(this.round, { from: this.self, txid })
        await this.transport.broadcast(this.peers, 'BROADCAST', { txid })
        this.#notify()
    }

    /* Blame an accused peer; the protocol aborts at N-1. */
    async accuse(accused, reason) {
        blame(this.round, { from: this.self, accused, reason })
        await this.transport.broadcast(this.peers, 'BLAME', { accused, reason })
        this.#notify()
    }

    close() {
        this.closed = true
        if (typeof this.transport.close === 'function') this.transport.close()
    }
}

export { PHASES }
