/* Unit tests for the CashAccounts v2 library (lib/cashaccount/*).
 *
 * Pure/local only: the identifier/collision/identicon vector from the spec,
 * the REAL mainnet registration 8267bff0… ("Kallisti", block 978459) as the
 * commitment/profile/account fixture, the CashID URI + signature round-trip,
 * and the Nostr NIP-06 derivation/event round-trip. No network calls.
 */
import { describe, expect, it } from 'vitest'
import { secp256k1 } from '@noble/curves/secp256k1.js'

import {
    accountColor,
    assignIdentifiers,
    collisionExtension,
    collisionHash,
    formatIdentifier,
    identiconFor,
    identiconIndex,
    isValidAccountName,
    minimalCollision,
    parseIdentifier,
    pendingIdentifier,
} from '@/lib/cashaccount/identifier.js'
import { IDENTICON_CODE_POINTS } from '@/lib/cashaccount/identicons.js'
import {
    commitmentLength,
    decodeCommitment,
    encodeCommitment,
} from '@/lib/cashaccount/commitment.js'
import {
    decodeProfile,
    encodeProfile,
    isRegistrationScript,
    MAX_OP_RETURN_BYTES,
} from '@/lib/cashaccount/profile.js'
import {
    bitcoinSignedMessageHash,
    buildResponseUri,
    cashIdTweak,
    parseChallenge,
    parseResponse,
    signCashIdResponse,
    verifyCashIdResponse,
} from '@/lib/cashaccount/cashid.js'
import {
    deriveNostrKey,
    npubDecode,
    npubEncode,
    signNostrEvent,
    toBchNostrProofKey,
    verifyNostrEvent,
} from '@/lib/cashaccount/nostr.js'
import { accountFromRegistration } from '@/lib/cashaccount/resolver.js'

/* The spec's worked identifier example (CashAccountV2.md lines 94-114,
   143-330). */
const SPEC_BLOCK_HASH = '000000000000000002abbeff5f6fb22a0b3b5c2685c6ef4ed2d2257ed54e9dcb'
const SPEC_CATEGORY = '590d1fdf7e04af0ee08f9194bb9e8d1971bdcbf55d29303d5bf32d4eae5e7136'
const SPEC_COLLISION = '69d18aa0c3ef9ad7c27d48ed78ca07379c49cc1d6a4917e33ea7323fa57342e9'

/* The live mainnet registration (ChainGraph, 2026-11-23). */
const LIVE = {
    hash: '8267bff0bf6532bfd109ecae1062deb88822166333de5ece52d4309371a42878',
    block: {
        height: 978459,
        hash: '00000000000000000066a3b894ab1054f896c6554c15bde0ef8215597b88ec8d',
        transactionIndex: 41,
    },
    inputs: [{
        index: 0,
        outpointTransactionHash: '46e5567875706cbdf44a040d66ced15174f64d2b8805884bbe35a93153564111',
        outpointIndex: 0,
    }],
    outputs: [{
        index: 0,
        valueSatoshis: 1389,
        lockingBytecodeHex: '2103cc053f481413acc58895bf8be09eb67b4b4cfb0ace8b7be9f7867c5bce36873dc0009d00d100ce8800cd76016a876400d27602ff0287637801237f75012154797e01207e887801437f77a914cd13172484499df974b6e56edbdad7d6f4c7571288677801227f76c101227f778878517f78012188587901617e78ad547901247f78517f75528878527f7500cf527f758878537f775c7901617e78ad78547f77760087635e790088675e7901617e5252797ead686d6d6d6d6875687b01617e7bad6d6d51',
        tokenCategory: '46e5567875706cbdf44a040d66ced15174f64d2b8805884bbe35a93153564111',
        fungibleAmount: '0',
        nftCapability: 'mutable',
        nftCommitment: '02010802456219ccdc6500d7a681191c7aa4dfcc9937d0e24a6943e828dcccb838bcb2be00000000d8ca572c9f84a1b3c67a4cb9ffd0d8c29aea311430f1e87bd615c9cf48cad7be',
    }, {
        index: 1,
        valueSatoshis: 0,
        lockingBytecodeHex: '6a0401010102084b616c6c6973746912024b616c6c697374692e63617368f09f8d8f150468747470733a2f2f6b616c6c6c697374692e696f',
        tokenCategory: null,
        fungibleAmount: null,
        nftCapability: null,
        nftCommitment: null,
    }],
}

describe('cashaccount/identifier — the spec vector', () => {
    it('derives 69d1… from the spec block hash + category', () => {
        expect(collisionHash(SPEC_BLOCK_HASH, SPEC_CATEGORY)).toBe(SPEC_COLLISION)
        expect(minimalCollision(SPEC_COLLISION)).toBe('69D1')
        expect(collisionExtension(SPEC_COLLISION)).toBe('8a')
        expect(formatIdentifier('Kallisti', SPEC_COLLISION, { extensionNybbles: 2 })).toBe('Kallisti#69D1.8a')
    })

    it('resolves the spec identicon to the microphone and the color to #69d18a', () => {
        expect(identiconIndex(SPEC_COLLISION)).toBe(105)
        expect(identiconFor(SPEC_COLLISION)).toEqual({ index: 105, emoji: String.fromCodePoint(127908), name: 'microphone' })
        expect(accountColor(SPEC_COLLISION)).toBe('#69d18a')
    })

    it('renders the pre-confirmation placeholder', () => {
        expect(pendingIdentifier('Alice')).toBe('Alice#FFFF.00')
    })

    it('parses minimal, extended, and identicon-suffixed identifiers', () => {
        expect(parseIdentifier('Kallisti#69D1')).toEqual({ name: 'Kallisti', collision: '69D1', extension: null })
        expect(parseIdentifier('Kallisti#69D1.8a')).toEqual({ name: 'Kallisti', collision: '69D1', extension: '8a' })
        expect(parseIdentifier('Kallisti#69D1.8a🎤')).toEqual({ name: 'Kallisti', collision: '69D1', extension: '8a' })
        expect(parseIdentifier('Kallisti#69D1.8a extra')).toEqual({ name: 'Kallisti', collision: '69D1', extension: '8a' })
        expect(parseIdentifier('no-hash')).toBeNull()
        expect(parseIdentifier('A#69D1')).toBeNull()
        expect(isValidAccountName('Kallisti_2')).toBe(true)
        expect(isValidAccountName('bad name')).toBe(false)
    })

    it('assigns the minimal identifier to the earliest and extensions to later collisions', () => {
        const records = assignIdentifiers([
            { name: 'Kallisti', collisionHash: '69d18aa0c3ef', height: 100, transactionIndex: 5 },
            { name: 'Kallisti', collisionHash: '69d1bbbbbbbb', height: 101, transactionIndex: 1 },
            { name: 'Kallisti', collisionHash: '69d19999aaaa', height: 102, transactionIndex: 1 },
        ])

        expect(records[0].identifier).toBe('Kallisti#69D1')
        expect(records[0].minimal).toBe(true)
        expect(records[1].identifier).toBe('Kallisti#69D1.bb')
        expect(records[1].minimal).toBe(false)
        expect(records[2].identifier).toBe('Kallisti#69D1.99')
    })

    it('has exactly 128 identicon code points', () => {
        expect(IDENTICON_CODE_POINTS).toHaveLength(128)
    })
})

describe('cashaccount/commitment — the live Kallisti NFT', () => {
    it('decodes the 72-byte commitment', () => {
        const decoded = decodeCommitment(LIVE.outputs[0].nftCommitment)

        expect(decoded.version).toBe(2)
        expect(decoded.networkByte).toBe(1)
        expect(decoded.network).toBe('mainnet')
        expect(decoded.prefix).toBe(8)
        expect(decoded.scanPubkey).toBe('02456219ccdc6500d7a681191c7aa4dfcc9937d0e24a6943e828dcccb838bcb2be')
        expect(decoded.expiry).toBe(0)
        expect(decoded.nostrPubkey).toBe('d8ca572c9f84a1b3c67a4cb9ffd0d8c29aea311430f1e87bd615c9cf48cad7be')
        expect(decoded.length).toBe(72)
    })

    it('round-trips the live commitment and the 40-byte form', () => {
        const decoded = decodeCommitment(LIVE.outputs[0].nftCommitment)
        const reencoded = encodeCommitment({
            network: decoded.network,
            prefix: decoded.prefix,
            scanPubkey: decoded.scanPubkey,
            expiry: decoded.expiry,
            nostrPubkey: decoded.nostrPubkey,
        })

        expect(Buffer.from(reencoded).toString('hex')).toBe(LIVE.outputs[0].nftCommitment)

        const short = encodeCommitment({
            network: 'chipnet',
            prefix: 0x04,
            scanPubkey: decoded.scanPubkey,
        })

        expect(short).toHaveLength(commitmentLength(false))
        expect(decodeCommitment(short).network).toBe('chipnet')
        expect(decodeCommitment(short).nostrPubkey).toBeNull()
    })

    it('rejects a bad version/length', () => {
        expect(() => decodeCommitment('00')).toThrow(/length/)
        expect(() => decodeCommitment(LIVE.outputs[0].nftCommitment.replace(/^02/, '03'))).toThrow(/version/)
    })
})

describe('cashaccount/profile — the live Kallisti OP_RETURN', () => {
    it('decodes the real registration profile', () => {
        const profile = decodeProfile(LIVE.outputs[1].lockingBytecodeHex)

        expect(profile.name).toBe('Kallisti')
        expect(profile.displayName).toBe('Kallisti.cash🍏')
        expect(profile.bio).toBeNull()
        expect(profile.urls).toEqual(['https://kalllisti.io'])
        expect(profile.avatar).toBeNull()
    })

    it('re-encodes the exact live OP_RETURN', () => {
        const script = encodeProfile({
            name: 'Kallisti',
            displayName: 'Kallisti.cash🍏',
            urls: ['https://kalllisti.io'],
        })

        expect(Buffer.from(script).toString('hex')).toBe(LIVE.outputs[1].lockingBytecodeHex)
        expect(isRegistrationScript(LIVE.outputs[1].lockingBytecodeHex)).toBe(true)
    })

    it('enforces the 223-byte OP_RETURN limit', () => {
        expect(() => encodeProfile({ name: 'Kallisti', bio: 'x'.repeat(MAX_OP_RETURN_BYTES) })).toThrow(/limit/)
    })
})

describe('cashaccount/cashid — URI + signature round-trip', () => {
    const challengeUri = 'cashid:example.com/cashid?x=102132435465768798a9bacbdcedfe0f&e=1800000000'
    const outpoint = {
        category: '590d1fdf7e04af0ee08f9194bb9e8d1971bdcbf55d29303d5bf32d4eae5e7136',
        txid: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
        vout: 0,
    }

    it('builds the spec example response URI exactly', () => {
        const challenge = parseChallenge(challengeUri)
        const response = buildResponseUri(challenge, outpoint)

        expect(challenge.host).toBe('example.com')
        expect(challenge.path).toBe('/cashid')
        expect(challenge.nonce).toBe('102132435465768798a9bacbdcedfe0f')
        expect(challenge.expiry).toBe(1800000000)
        expect(response).toBe(`${challengeUri}&d=${outpoint.category}:${outpoint.txid}:0`)
        expect(parseResponse(response).data).toEqual(outpoint)
    })

    it('signs and verifies a response with the tweaked CashCode key', async () => {
        const privateKey = new Uint8Array(32).fill(7)
        const publicKey = secp256k1.getPublicKey(privateKey, true)
        const responseUri = buildResponseUri(parseChallenge(challengeUri), outpoint)
        const response = await signCashIdResponse({
            spendPrivateKey: privateKey,
            spendPubkey: publicKey,
            responseUri,
        })

        expect(response.address.startsWith('bitcoincash:')).toBe(true)
        expect(response.signature).toHaveLength(88)

        const verified = await verifyCashIdResponse({ response, spendPubkey: publicKey })
        expect(verified.valid).toBe(true)
        expect(verified.address).toBe(response.address)

        const tampered = await verifyCashIdResponse({
            response: { ...response, request: `${response.request}00` },
            spendPubkey: publicKey,
        })
        expect(tampered.valid).toBe(false)
    })

    it('hashes the BSM message deterministically', () => {
        expect(bitcoinSignedMessageHash('hello')).toEqual(bitcoinSignedMessageHash('hello'))
        expect(bitcoinSignedMessageHash('hello')).toHaveLength(32)
        expect(cashIdTweak({ spendPubkey: secp256k1.getPublicKey(new Uint8Array(32).fill(7), true), responseUri: 'cashid:x?x=0' })).toHaveLength(32)
    })
})

describe('cashaccount/nostr — NIP-06 derivation + BIP340 events', () => {
    const seed = new Uint8Array(64).fill(1)
    const category = LIVE.outputs[0].tokenCategory

    it('derives the same key at the NIP-06 path', () => {
        const first = deriveNostrKey({ bip39Seed: seed, categoryHex: category })
        const second = deriveNostrKey({ bip39Seed: seed, categoryHex: category })

        expect(first.path).toBe("m/44'/1237'/0'/0/0")
        expect(first.npub).toBe(second.npub)
        expect(first.npub.startsWith('npub1')).toBe(true)
        expect(first.xOnlyPublicKey).toHaveLength(32)
        expect(npubDecode(first.npub)).toBe(Buffer.from(first.xOnlyPublicKey).toString('hex'))
        expect(npubEncode(first.xOnlyPublicKey)).toBe(first.npub)
    })

    it('signs and verifies a kind-0 event', () => {
        const { privateKey } = deriveNostrKey({ bip39Seed: seed, categoryHex: category })
        const event = signNostrEvent({ privateKey, kind: 0, content: '{"name":"Kallisti"}', createdAt: 1800000000 })

        expect(event.sig).toHaveLength(128)
        expect(verifyNostrEvent(event)).toBe(true)
        expect(verifyNostrEvent({ ...event, content: '{"name":"Mallory"}' })).toBe(false)
    })

    it('normalizes the BCH proof key to even-Y', () => {
        const { privateKey } = deriveNostrKey({ bip39Seed: seed, categoryHex: category })
        const proofKey = toBchNostrProofKey(privateKey)
        const compressed = secp256k1.getPublicKey(proofKey, true)

        expect(compressed[0]).toBe(0x02)
    })
})

describe('cashaccount/resolver — the live Kallisti registration', () => {
    it('builds the account from the on-chain transaction', () => {
        const account = accountFromRegistration(LIVE)

        expect(account.pending).toBe(false)
        expect(account.name).toBe('Kallisti')
        expect(account.collisionHash).toBe('7b9ae265a98b64cbf5d2b2b6808f8ea7a62d7da5859475dfb424c8dad880fc73')
        expect(account.identifier).toBe('Kallisti#7B9A')
        expect(account.identicon).toEqual({ index: 115, emoji: String.fromCodePoint(127942), name: 'trophy' })
        expect(account.color).toBe('#7b9ae2')
        expect(account.category).toBe(LIVE.outputs[0].tokenCategory)
        expect(account.network).toBe('mainnet')
        expect(account.spendPubkey).toBe('03cc053f481413acc58895bf8be09eb67b4b4cfb0ace8b7be9f7867c5bce36873d')
        expect(account.scanPubkey).toBe('02456219ccdc6500d7a681191c7aa4dfcc9937d0e24a6943e828dcccb838bcb2be')
        expect(account.npub.startsWith('npub1')).toBe(true)
        expect(account.profile.displayName).toBe('Kallisti.cash🍏')
        expect(account.profile.urls).toEqual(['https://kalllisti.io'])
        expect(account.block.height).toBe(978459)
        expect(account.txid).toBe(LIVE.hash)
    })

    it('rejects a transaction whose input 0 does not spend the category funding output', () => {
        const broken = {
            ...LIVE,
            inputs: [{ ...LIVE.inputs[0], outpointTransactionHash: '00'.repeat(32) }],
        }

        expect(() => accountFromRegistration(broken)).toThrow(/funding output/)
    })
})
