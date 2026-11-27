// src/lib/pool/note-mailbox.js
//
// B3 — the off-chain note delivery: the NP01 carrier packet over Nostr
// (docs/B3-NOTE-DELIVERY-DESIGN-2026-11-27.md §3.1).
//
// The role-2 action carrier (169/201 B) carries only the ACTION's public
// statement — the recipient's private note material (value, rho, r) never
// rides the chain. This module transports the EXISTING NP01 packet
// (lib/pool/carrier.js — already encrypted to the recipient's BabyJub
// delivery point, self-authenticating by trial-decrypt + cm validation):
//
//   NOTE EVENT (kind 4321, regular/stored):
//     tags    = [["d", hex(SHA256(recipientDeliveryPoint))], ["action", <txid>]]
//     content = hex(packet)                        — the raw 164-B NP01 packet
//     key     = a FRESH throwaway Nostr key per publication (no identity,
//               no linkage; the relay sees an opaque tag + ciphertext).
//
//   RECEIPT EVENT (kind 4322, regular/stored):
//     tags    = [["d", hex(SHA256(packet))]]       — acknowledges delivery
//     content = ''
//     key     = fresh per receipt.
//
// The SENDER keeps every packet in a persistent OUTBOX (store pool.outbox)
// and re-publishes the SAME event (id-stable — relays dedupe naturally)
// until the recipient's receipt is observed. The RECIPIENT fetches by
// their own d-tag during every pool scan and the packets enter the scan's
// EXISTING trial-decrypt path (lib/pool/scan.js scanPool `mailboxPackets`).
//
// The relay set + kinds come from the pool registry (NOTE_MAILBOX) — a
// deployment decision, never a code constant. Everything is
// transport-injectable (the nostr-relay spec's MockWebSocket pattern).

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

import { Relay } from '@/lib/nostr/relay.js'
import { createEvent } from '@/lib/nostr/event.js'

/* The event kinds (the design doc's §7 open decision — a private
   convention between Nito wallets; both REGULAR kinds: 30000-39999 are
   parameterized-REPLACEABLE and would keep only the LATEST note per
   recipient tag, dropping every earlier note). */
export const NOTE_KIND_DEFAULT = 4321
export const RECEIPT_KIND_DEFAULT = 4322

/* The NP01 packet size (lib/pool/carrier.js CARRIER_PACKET_SIZE — restated
   here so mailbox payloads can be validated without importing the
   babyjub-carrying module). */
const CARRIER_PACKET_SIZE = 164

/**
 * The routing tag: SHA256 of the DELIVERY POINT bytes (hex-encoded).
 *
 * The delivery point is shared sender↔recipient only; the relay sees an
 * opaque hash. Accepts the 64-hex-char string OR raw 32 bytes.
 */
export function dpTag(deliveryPoint) {
    const bytes = typeof deliveryPoint === 'string' ? hexToBytes(deliveryPoint) : deliveryPoint

    if (!bytes || bytes.length !== 32) {
        throw new Error('mailbox: the delivery point must be 32 bytes (64 hex chars)')
    }

    return bytesToHex(sha256(bytes))
}

/* A FRESH throwaway Nostr keypair (per event — no identity, no linkage
   between publications). */
export function freshKeys() {
    const privateKey = schnorr.utils.randomSecretKey()

    return { privateKey, publicKey: schnorr.getPublicKey(privateKey) }
}

/**
 * Build (sign) ONE note event for the recipient's delivery point.
 *
 * @param {object} params — { mailbox, recipientDeliveryPoint, packet,
 *   actionTxid, keys?, createdAt? } — mailbox = the registry entry
 *   { relays, noteKind?, receiptKind? }.
 * @returns {object} { event, keys, dpTag } — the SIGNED event (createEvent)
 *   plus the keys (the outbox persists them so a re-publish reuses the SAME
 *   event id — relays dedupe naturally; a fresh key per retry would mint a
 *   NEW id per retry and spam the relay).
 */
export function buildNoteEvent({ mailbox, recipientDeliveryPoint, packet, actionTxid, keys = null, createdAt }) {
    if (!mailbox || !Array.isArray(mailbox.relays) || mailbox.relays.length === 0) {
        throw new Error('mailbox: no relays configured')
    }
    if (!packet || packet.length !== CARRIER_PACKET_SIZE) {
        throw new Error(`mailbox: the packet must be ${CARRIER_PACKET_SIZE} bytes`)
    }

    const ownKeys = keys || freshKeys()

    const tags = [
        ['d', dpTag(recipientDeliveryPoint)],
    ]

    if (actionTxid) {
        tags.push(['action', actionTxid])
    }

    const event = createEvent({
        kind: mailbox.noteKind || NOTE_KIND_DEFAULT,
        content: bytesToHex(packet),
        tags,
        privateKey: ownKeys.privateKey,
        publicKey: ownKeys.publicKey,
        createdAt,
    })

    return { event, keys: ownKeys, dpTag: tags[0][1] }
}

/**
 * Publish ONE signed event to EVERY configured relay. One accept is a
 * delivery (Promise.allSettled — a down relay must not block the others).
 *
 * @returns {Promise<object>} { results, delivered } — per-relay outcomes +
 *   whether at least one relay accepted (OK=true).
 */
export async function publishEvent({ mailbox, event, WebSocketImpl, publishTimeout = 10000 }) {
    const attempts = (mailbox.relays || []).map(async (url) => {
        const relay = new Relay(url, { WebSocketImpl })

        try {
            relay.connect()
            await awaitOpen(relay, publishTimeout)
            await relay.publish(event, { timeout: publishTimeout })
            return { url, ok: true }
        } catch (err) {
            return { url, ok: false, error: String(err && err.message || err) }
        } finally {
            relay.close()
        }
    })

    const results = await Promise.all(attempts)

    return { results, delivered: results.some((r) => r.ok) }
}

/**
 * Fetch the note packets addressed to a delivery point: one REQ per relay
 * ({ kinds: [noteKind], "#d": [tag] }), collecting until EOSE (or the
 * timeout — a silent relay never blocks the scan). Results are deduped by
 * event id and VALIDATED (kind, tag match, hex payload of the exact packet
 * size); invalid events are skipped, never thrown (the mailbox must not
 * break the chain scan on a malformed relay entry).
 *
 * @param {object} params — { mailbox, ownDeliveryPoint, timeout?,
 *   WebSocketImpl?, limit? }
 * @returns {Promise<Array<object>>} [{ packet: Uint8Array, actionTxid,
 *   eventId }] in relay-arrival order.
 */
export async function fetchNotePackets({ mailbox, ownDeliveryPoint, timeout = 8000, WebSocketImpl, limit = 500 }) {
    const tag = dpTag(ownDeliveryPoint)

    const collect = (url) => new Promise((resolve) => {
        const collected = []
        const relay = new Relay(url, { WebSocketImpl })

        const finish = () => {
            clearTimeout(timer)
            relay.close()
            resolve(collected)
        }

        /* The EOSE terminates the fetch; the timeout guards a silent relay. */
        const subId = relay.subscribe(
            [{ kinds: [mailbox.noteKind || NOTE_KIND_DEFAULT], '#d': [tag], limit }],
            (event) => {
                const packet = parseNoteEvent({ event, tag, noteKind: mailbox.noteKind || NOTE_KIND_DEFAULT })

                if (packet) {
                    collected.push(packet)
                }
            },
            /* onEose */ () => finish(),
        )

        const timer = setTimeout(() => {
            relay.unsubscribe(subId)
            finish()
        }, timeout)
    })

    const perRelay = await Promise.all((mailbox.relays || []).map(collect))

    /* Dedupe by event id (multi-relay fetches see the same events). */
    const byId = new Map()

    for (const list of perRelay) {
        for (const entry of list) {
            if (!byId.has(entry.eventId)) {
                byId.set(entry.eventId, entry)
            }
        }
    }

    return [...byId.values()]
}

/**
 * Parse + validate ONE note event against the expected tag + kind. Returns
 * null on ANY mismatch (never throws — the mailbox is untrusted input).
 */
export function parseNoteEvent({ event, tag, noteKind }) {
    try {
        if (!event || event.kind !== noteKind || typeof event.content !== 'string') {
            return null
        }

        const tags = event.tags || []
        const d = tags.find((t) => Array.isArray(t) && t[0] === 'd')

        if (!d || d[1] !== tag) {
            return null
        }

        const packet = hexToBytes(event.content)

        if (packet.length !== CARRIER_PACKET_SIZE) {
            return null
        }

        const action = tags.find((t) => Array.isArray(t) && t[0] === 'action')

        return {
            packet,
            actionTxid: action ? String(action[1]) : null,
            eventId: event.id,
        }
    } catch {
        return null
    }
}

/**
 * Build (sign) the RECEIPT for one delivered packet — the recipient's
 * acknowledgement that clears the sender's outbox entry.
 */
export function buildReceiptEvent({ mailbox, packet, keys = null, createdAt }) {
    const ownKeys = keys || freshKeys()

    const event = createEvent({
        kind: mailbox.receiptKind || RECEIPT_KIND_DEFAULT,
        content: '',
        tags: [['d', bytesToHex(sha256(packet))]],
        privateKey: ownKeys.privateKey,
        publicKey: ownKeys.publicKey,
        createdAt,
    })

    return { event, keys: ownKeys }
}

/**
 * Fetch the receipts for a set of packets (the outbox sweep): one REQ per
 * relay filtered by the packets' receipt tags. Resolves with the SET of
 * packet-hex hashes that have been acknowledged.
 *
 * @param {object} params — { mailbox, packets (Uint8Array[]), timeout?,
 *   WebSocketImpl? }
 * @returns {Promise<Set<string>>} the acknowledged receipt tags.
 */
export async function fetchReceipts({ mailbox, packets, timeout = 8000, WebSocketImpl }) {
    const hashes = (packets || []).map((packet) => bytesToHex(sha256(packet)))

    if (hashes.length === 0) {
        return new Set()
    }

    const collect = (url) => new Promise((resolve) => {
        const seen = new Set()
        const relay = new Relay(url, { WebSocketImpl })

        const finish = () => {
            clearTimeout(timer)
            relay.close()
            resolve(seen)
        }

        const subId = relay.subscribe(
            [{ kinds: [mailbox.receiptKind || RECEIPT_KIND_DEFAULT], '#d': hashes, limit: 500 }],
            (event) => {
                const d = (event.tags || []).find((t) => Array.isArray(t) && t[0] === 'd')

                if (d && hashes.includes(d[1])) {
                    seen.add(d[1])
                }
            },
            () => finish(),
        )

        const timer = setTimeout(() => {
            relay.unsubscribe(subId)
            finish()
        }, timeout)
    })

    const perRelay = await Promise.all((mailbox.relays || []).map(collect))

    const seen = new Set()

    for (const set of perRelay) {
        for (const h of set) {
            seen.add(h)
        }
    }

    return seen
}

/* The receipt tag for one packet (the outbox's receiptSeen check). */
export function packetTag(packet) {
    return bytesToHex(sha256(packet))
}

/* Await a relay's OPEN state (Relay.publish sends immediately and would
   throw on a still-connecting socket; real sockets open asynchronously). */
async function awaitOpen(relay, timeout) {
    const started = Date.now()

    while (relay.state !== 'open' && Date.now() - started < timeout) {
        await new Promise((resolve) => setTimeout(resolve, 20))
    }

    if (relay.state !== 'open') {
        throw new Error(`relay: connect timeout (${relay.url})`)
    }
}
