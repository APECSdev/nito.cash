/* Unit tests for the encrypted-note carrier (lib/pool/carrier.js).
 *
 * Covers: encrypt -> decrypt round-trip, wrong-key rejection (commitment
 * membership), tampered-ciphertext rejection, off-curve ephemeral-point
 * safety (no throw), delivery-point <-> ownerPub consistency with the
 * existing notes.js derivation, and the OP_RETURN locking-bytecode format.
 */

import { beforeAll, describe, expect, it } from 'vitest'

/* Import the carrier library. */
import {
    CARRIER_LOCKING_SIZE,
    CARRIER_PACKET_SIZE,
    buildCarrierLockingBytecode,
    decryptPacket,
    deriveDeliveryPoint,
    encryptNote,
    ownerPubFromDeliveryPoint,
    parseCarrierLockingBytecode,
} from '@/lib/pool/carrier'

/* Import pool lib. */
import {
    deriveOwnerPub,
    deriveSpendKey,
    getBabyjub,
    getPoseidon,
    noteCommitment,
    randomField,
} from '@/lib/pool/notes'

/* Fixed entropies (bytes) — two DISTINCT wallets (sender / recipient). */
const SENDER_ENTROPY = Uint8Array.from({ length: 32 }, () => 0xab)
const RECIPIENT_ENTROPY = Uint8Array.from({ length: 32 }, () => 0xcd)

/* A fixed recipient-owned note (field elements as BigInts). */
const NOTE = {
    value: 250n,
    ownerPub: null, // set in beforeAll (needs the recipient's derived key)
    rho: 1001n,
    r: 5001n,
}

describe('pool carrier (encrypted-note delivery)', () => {
    /* Warm up the poseidon/babyjub wasm singletons once (init is slow). */
    let senderKey
    let recipientKey
    let recipientPoint
    let cm
    let packet
    let lockingBytecode

    beforeAll(async () => {
        await getPoseidon()
        await getBabyjub()

        senderKey = deriveSpendKey(SENDER_ENTROPY)
        recipientKey = deriveSpendKey(RECIPIENT_ENTROPY)
        recipientPoint = await deriveDeliveryPoint(recipientKey)

        /* The note's ownerPub MUST be the recipient's x-coordinate. */
        NOTE.ownerPub = await ownerPubFromDeliveryPoint(recipientPoint)

        cm = await noteCommitment(NOTE.value, NOTE.ownerPub, NOTE.rho, NOTE.r)
        NOTE._cm = cm

        packet = await encryptNote(NOTE, recipientPoint)
        lockingBytecode = buildCarrierLockingBytecode(packet)
    }, 60000)

    it('derives a delivery point whose x-coordinate equals deriveOwnerPub', async () => {
        /* The carrier's recipient identity and the existing notes.js owner
           derivation are two views of the SAME key. */
        expect(NOTE.ownerPub).toEqual(await deriveOwnerPub(recipientKey))
    })

    it('produces a 164-byte packet with the NP01 magic', () => {
        expect(packet.length).toEqual(164)
        expect(Array.from(packet.slice(0, 4))).toEqual([0x4e, 0x50, 0x30, 0x31])
    })

    it('round-trips: the recipient decrypts their exact note + commitment', async () => {
        const leaves = ['12345', cm.toString(10)]

        const note = await decryptPacket(packet, recipientKey, leaves)

        expect(note).not.toBeNull()
        expect(note.value).toEqual(NOTE.value)
        expect(note.ownerPub).toEqual(NOTE.ownerPub)
        expect(note.rho).toEqual(NOTE.rho)
        expect(note.r).toEqual(NOTE.r)
        expect(note.cm).toEqual(cm)
        /* The leaf index is resolved from the (array) leaf set. */
        expect(note.leafIndex).toEqual(1)
    })

    it('accepts a Set of leaves (index unresolved)', async () => {
        const note = await decryptPacket(packet, recipientKey, new Set([cm.toString(10)]))

        expect(note).not.toBeNull()
        expect(note.cm).toEqual(cm)
        expect(note.leafIndex).toBeNull()
    })

    it('rejects a wrong spend key (commitment matches no leaf)', async () => {
        /* The SENDER's key must not decrypt the recipient's packet. */
        const note = await decryptPacket(packet, senderKey, [cm.toString(10)])

        expect(note).toBeNull()
    })

    it('rejects a tampered ciphertext byte', async () => {
        const tampered = Uint8Array.from(packet)

        /* Flip one bit in the ciphertext region (after magic + eph point). */
        tampered[4 + 32 + 10] ^= 0x01

        const note = await decryptPacket(tampered, recipientKey, [cm.toString(10)])

        expect(note).toBeNull()
    })

    it('rejects an off-curve ephemeral point without throwing', async () => {
        /* Random 32 bytes are (almost surely) NOT a valid BabyJub point —
           the scanner must get null, never an exception. */
        const bad = new Uint8Array(CARRIER_PACKET_SIZE)
        bad.set([0x4e, 0x50, 0x30, 0x31], 0)
        globalThis.crypto.getRandomValues(bad.subarray(4, 4 + 32))

        const note = await decryptPacket(bad, recipientKey, [cm.toString(10)])

        expect(note).toBeNull()
    })

    it('rejects a wrong-size packet and a wrong magic', async () => {
        expect(await decryptPacket(new Uint8Array(10), recipientKey, [cm.toString(10)])).toBeNull()

        const wrongMagic = Uint8Array.from(packet)

        wrongMagic[0] = 0x00

        expect(await decryptPacket(wrongMagic, recipientKey, [cm.toString(10)])).toBeNull()
    })

    it('round-trips full-range random field elements', async () => {
        const randomNote = {
            value: randomField(),
            ownerPub: NOTE.ownerPub,
            rho: randomField(),
            r: randomField(),
        }

        const randomCm = await noteCommitment(
            randomNote.value, randomNote.ownerPub, randomNote.rho, randomNote.r)

        const randomPacket = await encryptNote(randomNote, recipientPoint)

        const note = await decryptPacket(randomPacket, recipientKey, [randomCm.toString(10)])

        expect(note).not.toBeNull()
        expect(note.value).toEqual(randomNote.value)
        expect(note.rho).toEqual(randomNote.rho)
        expect(note.r).toEqual(randomNote.r)
        expect(note.cm).toEqual(randomCm)
    })

    it('builds and parses the 167-byte OP_RETURN locking bytecode', () => {
        /* OP_RETURN + OP_PUSHDATA1 + minimal length + payload. */
        expect(lockingBytecode.length).toEqual(CARRIER_LOCKING_SIZE)
        expect(CARRIER_LOCKING_SIZE).toEqual(167)
        expect(Array.from(lockingBytecode.slice(0, 3))).toEqual([0x6a, 0x4c, 164])

        const parsed = parseCarrierLockingBytecode(lockingBytecode)

        expect(parsed).not.toBeNull()
        expect(parsed).toEqual(packet)
    })

    it('parse returns null for non-carrier outputs', () => {
        /* The unshield payout output shape (bare OP_RETURN, no payload). */
        expect(parseCarrierLockingBytecode(Uint8Array.of(0x6a))).toBeNull()

        /* A P2PKH-looking output. */
        expect(parseCarrierLockingBytecode(Uint8Array.of(0x76, 0xa9, 0x14, 0x00, 0x88, 0xac))).toBeNull()

        /* Wrong magic in the payload. */
        const wrong = Uint8Array.from(lockingBytecode)
        wrong[3] = 0x00
        expect(parseCarrierLockingBytecode(wrong)).toBeNull()

        /* null / undefined. */
        expect(parseCarrierLockingBytecode(null)).toBeNull()
    })
})
