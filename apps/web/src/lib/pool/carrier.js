// src/lib/pool/carrier.js
//
// Encrypted-note carrier for the shielded pool (wire format "NP01" — v1).
//
// THE PROBLEM THIS SOLVES (the biggest blocker to real shielded transfers):
// the pool's live covenant arguments and outputs carry NO encrypted note
// packet, so every PoC transfer so far was a SELF-transfer — the sender
// generated and already knew both output notes. A recipient can never learn a
// note sent to them. (Confirmed from public chipnet data, 2026-11-12:
// pusd-shielded-pool HANDOFF-HUSHYOURMONEY.md §10 — "Cross-wallet delivery
// still needs a carrier (e.g., OP_RETURN) plus a covenant output-tolerance
// check.")
//
// THE DESIGN (see pusd-shielded-pool NOTE-CARRIER.md for the full spec):
// the sender appends ONE extra OP_RETURN output to the pool action tx, which
// carries a single encrypted packet for the RECIPIENT's note. The tx's other
// output note (typically the sender's own change) needs no carrier — the
// sender already knows it.
//
//   payload (164 bytes): "NP01" | ephPub(32, packed) | ct(128)
//   plaintext (128 bytes): value(32 BE) | ownerPub(32 BE) | rho(32 BE) | r(32 BE)
//
// Crypto: ECDH over BabyJub (the pool's own curve).
//   sender: ss = x( ephSk × ReceiverPoint )     ephSk random, ephPub = ephSk × Base8
//   receiver: ss = x( ReceiverSk × ephPub )
//   keystream: block i = sha256(ss || LE32(i)), i = 0..3 (128 bytes); ct = pt XOR ks
//
// The DELIVERY POINT is the recipient's spend key as a FULL (packed) BabyJub
// point — the shared "address" for shielded payments. The note's circuit-level
// `ownerPub` (a single field element) is the x-coordinate of that same point
// (identical to notes.js deriveOwnerPub), so nothing about the circuit or the
// note format changes.
//
// NO MAC is needed: a trial decryption recomputes the note commitment
// cm = Poseidon(value, ownerPub, rho, r) and accepts only if cm is a KNOWN
// pool leaf (Zcash-style note detection). A wrong key or tampered ciphertext
// yields a cm that matches no leaf with overwhelming probability, so garbage
// decryptions are rejected silently (decryptPacket returns null).
//
// NO COVENANT CHANGE is required: asset-pool.cash spend() constrains only
// tx.outputs[0] (and outputs[6] on unshield) — appended outputs are
// unconstrained — and the verifier steps never introspect outputs (intra-tx
// model, COVENANT-DESIGN.md §3a). The empirical full-tx VM check is the
// runner-side eval (eval-pool.mjs CARRIER_PACKET_HEX). The carrier output is
// always APPENDED (never inserted) so no existing output index shifts.

import { sha256 } from '@bitauth/libauth'

import { getBabyjub, randomField, noteCommitment } from './notes.js'

/* ---- Wire format constants ---- */

/* Magic header: "NP01" ('N' 'P' = Nito Pool, '0' '1' = format version 1). */
export const CARRIER_MAGIC = Uint8Array.of(0x4e, 0x50, 0x30, 0x31)

/* Fixed packet layout (bytes). */
export const CARRIER_MAGIC_SIZE = 4
export const CARRIER_EPH_SIZE = 32
export const CIPHERTEXT_SIZE = 128
export const CARRIER_PACKET_SIZE = CARRIER_MAGIC_SIZE + CARRIER_EPH_SIZE + CIPHERTEXT_SIZE

/* OP_RETURN(0x6a) + OP_PUSHDATA1(0x4c) + 1 length byte + payload. */
export const CARRIER_LOCKING_SIZE = 1 + 1 + 1 + CARRIER_PACKET_SIZE // 167 bytes

/* Plaintext field size (32-byte big-endian field element, matches the
   actionHash byte convention in notes.js). */
const FIELD_SIZE = 32

/* ---- byte <-> BigInt helpers ---- */

/* BigInt -> exactly `size` big-endian bytes (throws on overflow). */
function toBEBytes(value, size) {
    let n = BigInt(value)

    if (n < 0n || n >= (1n << BigInt(size * 8))) {
        throw new Error(`carrier: field element out of range (${n})`)
    }

    const out = new Uint8Array(size)

    for (let i = size - 1; i >= 0; i -= 1) {
        out[i] = Number(n & 0xffn)
        n >>= 8n
    }

    return out
}

/* Big-endian bytes -> BigInt. */
function fromBEBytes(bytes) {
    let n = 0n

    for (const b of bytes) {
        n = (n << 8n) | BigInt(b)
    }

    return n
}

/* Keystream block i: sha256(ss || LE32(i)). */
function keystreamBlock(ssBytes, i) {
    const counter = new Uint8Array(4)

    new DataView(counter.buffer).setUint32(0, i, true)

    const preimage = new Uint8Array(ssBytes.length + counter.length)
    preimage.set(ssBytes, 0)
    preimage.set(counter, ssBytes.length)

    return sha256.hash(preimage)
}

/* XOR `data` with the SHA256 keystream keyed by the shared secret. */
function xorKeystream(data, ssBytes) {
    const out = new Uint8Array(data.length)

    for (let i = 0; i < data.length; i += 32) {
        const block = keystreamBlock(ssBytes, i / 32)

        for (let j = 0; j < 32 && i + j < data.length; j += 1) {
            out[i + j] = data[i + j] ^ block[j]
        }
    }

    return out
}

/* Concatenate byte arrays. */
function concat(...arrays) {
    const total = arrays.reduce((sum, a) => sum + a.length, 0)
    const out = new Uint8Array(total)

    let offset = 0
    for (const a of arrays) {
        out.set(a, offset)
        offset += a.length
    }

    return out
}

/* NOTE: circomlibjs babyjub.unpackPoint MUTATES its input buffer — it clears
   the packed X-sign bit IN PLACE (buff[31] &= 0x7F) — so a stored delivery
   point (or packet) that is unpacked more than once silently flips to the
   NEGATED point on every call after the first (observed: the ECDH shared
   secret diverges and every decryption returns null). Always hand it a
   private copy. */
function unpackPointCopy(bb, bytes) {
    return bb.unpackPoint(Uint8Array.from(bytes))
}

/* ---- Recipient identity ---- */

/**
 * The recipient's DELIVERY POINT — their spend key as a full (packed) BabyJub
 * point. This 32-byte packed point is the "address" a sender needs to deliver
 * a shielded payment (share it out-of-band: QR / text — the PoC has no
 * on-chain registry yet).
 *
 * @param {bigint} spendKey — the recipient's pool spend key (notes.deriveSpendKey).
 * @returns {Promise<Uint8Array>} 32-byte packed point (circomlibjs packPoint form).
 */
export async function deriveDeliveryPoint(spendKey) {
    const bb = await getBabyjub()

    const point = bb.mulPointEscalar(bb.Base8, BigInt(spendKey))

    return bb.packPoint(point)
}

/**
 * The circuit-level ownerPub (x-coordinate field element) of a delivery
 * point — the value the SENDER must use as the note's `ownerPub` so the
 * recipient's key authorizes spending it. Equals notes.deriveOwnerPub(spendKey).
 *
 * @param {Uint8Array} deliveryPoint — 32-byte packed point.
 * @returns {Promise<bigint>} the x-coordinate as a field element.
 * @throws on an invalid (off-curve) point.
 */
export async function ownerPubFromDeliveryPoint(deliveryPoint) {
    const bb = await getBabyjub()

    const point = unpackPointCopy(bb, deliveryPoint)

    if (!point) {
        throw new Error('carrier: invalid delivery point (not on BabyJub)')
    }

    return BigInt(bb.F.toString(point[0]))
}

/* ---- Encrypt ---- */

/**
 * Encrypt ONE output note for delivery to a recipient.
 *
 * @param {object} note — { value, ownerPub, rho, r } (field elements; decimal
 *   strings or BigInts). `ownerPub` MUST be the x-coordinate of
 *   `receiverDeliveryPoint` (use ownerPubFromDeliveryPoint) — the carrier does
 *   NOT override it, so the note the circuit commits to and the note the
 *   recipient decrypts are guaranteed to be the same.
 * @param {Uint8Array} receiverDeliveryPoint — 32-byte packed recipient point.
 * @returns {Promise<Uint8Array>} the 164-byte carrier packet.
 * @throws on an invalid receiver point or out-of-range note fields.
 */
export async function encryptNote(note, receiverDeliveryPoint) {
    const bb = await getBabyjub()

    /* Validate the receiver point (unpackPoint rejects off-curve bytes). */
    const receiverPoint = unpackPointCopy(bb, receiverDeliveryPoint)

    if (!receiverPoint) {
        throw new Error('carrier: invalid receiver delivery point (not on BabyJub)')
    }

    /* Ephemeral keypair (fresh per packet — no reuse, no linkage).
       NOTE: packPoint encodes the point as the Y coordinate + an X sign bit
       (the circomlibjs BabyJub compressed form) — NOT the bare x-coordinate. */
    const ephSk = randomField()

    const ephPoint = bb.mulPointEscalar(bb.Base8, ephSk)

    const ephPacked = bb.packPoint(ephPoint)

    /* ECDH: sender side. */
    const ssPoint = bb.mulPointEscalar(receiverPoint, ephSk)

    const ssBytes = toBEBytes(BigInt(bb.F.toString(ssPoint[0])), 32)

    /* Plaintext: value | ownerPub | rho | r (32-byte big-endian each). */
    const plaintext = concat(
        toBEBytes(note.value, FIELD_SIZE),
        toBEBytes(note.ownerPub, FIELD_SIZE),
        toBEBytes(note.rho, FIELD_SIZE),
        toBEBytes(note.r, FIELD_SIZE),
    )

    /* Ciphertext. */
    const ciphertext = xorKeystream(plaintext, ssBytes)

    /* Packet: magic | ephPub | ct. */
    return concat(CARRIER_MAGIC, ephPacked, ciphertext)
}

/* ---- Decrypt ---- */

/**
 * Try to decrypt ONE carrier packet with a spend key, accepting the note only
 * if its recomputed commitment is a KNOWN pool leaf (Zcash-style trial
 * decryption). Every failure — bad magic, bad size, off-curve ephemeral point,
 * wrong key, tampered ciphertext, unknown commitment — returns null (never
 * throws: this runs inside the wallet's chain scan).
 *
 * @param {Uint8Array} packet — the 164-byte carrier payload.
 * @param {bigint} spendKey — this wallet's pool spend key.
 * @param {Array<string|bigint>|Set<string|bigint>} knownLeaves — the pool's
 *   note-commitment leaves (decimal strings as persisted in store pool.leaves;
 *   BigInts also accepted). With an Array, the note's leafIndex is resolved.
 * @returns {Promise<object|null>} { value, ownerPub, rho, r, cm, leafIndex }
 *   (field elements as BigInt; leafIndex = position in the leaves array, or
 *   null when a Set / no match-by-index is provided), or null.
 */
export async function decryptPacket(packet, spendKey, knownLeaves) {
    /* Header + size checks. */
    if (!packet || packet.length !== CARRIER_PACKET_SIZE) {
        return null
    }

    for (let i = 0; i < CARRIER_MAGIC_SIZE; i += 1) {
        if (packet[i] !== CARRIER_MAGIC[i]) {
            return null
        }
    }

    /* Ephemeral point (off-curve bytes -> null, not a throw). */
    const bb = await getBabyjub()

    const ephPacked = packet.slice(CARRIER_MAGIC_SIZE, CARRIER_MAGIC_SIZE + CARRIER_EPH_SIZE)

    const ephPoint = unpackPointCopy(bb, ephPacked)

    if (!ephPoint) {
        return null
    }

    /* ECDH: receiver side. */
    const ssPoint = bb.mulPointEscalar(ephPoint, BigInt(spendKey))

    const ssBytes = toBEBytes(BigInt(bb.F.toString(ssPoint[0])), 32)

    /* Decrypt + parse the plaintext fields. */
    const ct = packet.slice(CARRIER_MAGIC_SIZE + CARRIER_EPH_SIZE)

    const plaintext = xorKeystream(ct, ssBytes)

    const value = fromBEBytes(plaintext.slice(0 * FIELD_SIZE, 1 * FIELD_SIZE))
    const ownerPub = fromBEBytes(plaintext.slice(1 * FIELD_SIZE, 2 * FIELD_SIZE))
    const rho = fromBEBytes(plaintext.slice(2 * FIELD_SIZE, 3 * FIELD_SIZE))
    const r = fromBEBytes(plaintext.slice(3 * FIELD_SIZE, 4 * FIELD_SIZE))

    /* Validate by note-commitment membership: a wrong key / tampered packet
       produces a commitment that matches no real leaf. */
    const cm = await noteCommitment(value, ownerPub, rho, r)

    const cmStr = cm.toString(10)

    const leafIndex = Array.isArray(knownLeaves)
        ? knownLeaves.findIndex((leaf) => String(leaf) === cmStr)
        : null

    const isKnown = leafIndex !== null
        ? leafIndex !== -1
        : knownLeaves && [...knownLeaves].some((leaf) => String(leaf) === cmStr)

    if (!isKnown) {
        return null
    }

    return {
        value,
        ownerPub,
        rho,
        r,
        cm,
        leafIndex: leafIndex !== -1 ? leafIndex : null,
    }
}

/* ---- Output (locking bytecode) helpers ---- */

/**
 * Build the OP_RETURN locking bytecode carrying one packet.
 * `OP_RETURN(0x6a) OP_PUSHDATA1(0x4c) <len> <payload>` — 167 bytes, far under
 * the 223-byte standardness ceiling for data-carrying outputs.
 *
 * @param {Uint8Array} packet — the 164-byte carrier packet.
 * @returns {Uint8Array} the 167-byte locking bytecode.
 */
export function buildCarrierLockingBytecode(packet) {
    if (!packet || packet.length !== CARRIER_PACKET_SIZE) {
        throw new Error('carrier: invalid packet size')
    }

    return concat(Uint8Array.of(0x6a, 0x4c, CARRIER_PACKET_SIZE), packet)
}

/**
 * Extract a carrier packet from an output's locking bytecode, or null when
 * the output is not a carrier (the scanner skips every other output shape).
 *
 * @param {Uint8Array} lockingBytecode — one tx output's locking bytecode.
 * @returns {Uint8Array|null} the 164-byte packet.
 */
export function parseCarrierLockingBytecode(lockingBytecode) {
    if (!lockingBytecode || lockingBytecode.length !== CARRIER_LOCKING_SIZE) {
        return null
    }

    /* OP_RETURN + OP_PUSHDATA1 + exact minimal length. */
    if (lockingBytecode[0] !== 0x6a || lockingBytecode[1] !== 0x4c ||
        lockingBytecode[2] !== CARRIER_PACKET_SIZE) {
        return null
    }

    const packet = lockingBytecode.slice(3)

    for (let i = 0; i < CARRIER_MAGIC_SIZE; i += 1) {
        if (packet[i] !== CARRIER_MAGIC[i]) {
            return null
        }
    }

    return packet
}
