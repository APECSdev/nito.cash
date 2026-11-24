/* Unit tests for the CashAccounts registration/covenant helpers.
 *
 * The compiled covenant artifacts are build-host inputs, so these tests use
 * correctly-SIZED stand-ins (197-byte Identity script with the required
 * 0x21 + 33-byte spend-key head; 177-byte Genesis script). That is enough to
 * pin the output layout, the sighash-0x61 digest and the Genesis unlocking
 * argument order. The live registration still requires the BCH-2026 VM gate.
 */
import { describe, expect, it } from 'vitest'
import { binToHex, encodeDataPush, hexToBin, instantiateSecp256k1 } from '@bitauth/libauth'

import {
    assertCompiledArtifact,
    identityScriptHash,
    spendPubkeyFromIdentityScript,
} from '@/lib/cashaccount/covenant.js'
import {
    buildFundingOutputs,
    buildRegistrationOutputs,
    registrationSigningDigest,
    signRegistration,
} from '@/lib/cashaccount/registration.js'
import { decodeProfile } from '@/lib/cashaccount/profile.js'
import { KALLISTI_CATEGORY } from '../fixtures/cashaccount-kallisti.js'

const SPEND_KEY = new Uint8Array(32).fill(3)
const SCAN_KEY = new Uint8Array(32).fill(4)
const NOSTR_KEY = new Uint8Array(32).fill(5)

const CHANGE_ADDRESS = 'bitcoincash:qpv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf'

/* A 197-byte Identity script with the real 0x21 + 33-byte head. */
const makeIdentityScript = () => {
    const script = new Uint8Array(197)
    script[0] = 0x21
    script.set(hexToBin('02' + '11'.repeat(32)), 1)
    return script
}

/* A 177-byte Genesis stand-in. */
const makeGenesisScript = () => new Uint8Array(177).fill(0x51)

const buildUnsignedTransaction = (fundingTxid, outputs) => ({
    version: 1,
    inputs: [{
        outpointTransactionHash: hexToBin(fundingTxid),
        outpointIndex: 0,
        sequenceNumber: 0xffffffff,
        unlockingBytecode: new Uint8Array(0),
    }],
    outputs,
    locktime: 0,
})

const registrationOutputs = () => buildRegistrationOutputs({
    fundingTxid: KALLISTI_CATEGORY,
    identityScript: makeIdentityScript(),
    commitment: {
        network: 'mainnet',
        prefix: 8,
        scanPubkey: '02456219ccdc6500d7a681191c7aa4dfcc9937d0e24a6943e828dcccb838bcb2be',
        expiry: 0,
    },
    profile: {
        name: 'Kallisti',
        displayName: 'Kallisti.cash',
        urls: ['https://kalllisti.io'],
    },
    changeAddress: CHANGE_ADDRESS,
    changeSatoshis: 5000,
})

describe('cashaccount/covenant — artifact helpers', () => {
    it('reads the spend key from the Identity script head and hashes the script', () => {
        const identity = makeIdentityScript()

        expect(spendPubkeyFromIdentityScript(identity)).toBe('02' + '11'.repeat(32))
        expect(identityScriptHash(identity)).toHaveLength(64)
        expect(assertCompiledArtifact('identity', identity)).toBe(identity)
    })

    it('rejects a wrong-size artifact and a malformed Identity head', () => {
        expect(() => assertCompiledArtifact('identity', new Uint8Array(196))).toThrow(/197 bytes/)
        expect(() => assertCompiledArtifact('nope', new Uint8Array(1))).toThrow(/unknown artifact/)
        expect(() => spendPubkeyFromIdentityScript(new Uint8Array(197))).toThrow(/0x21/)
    })
})

describe('cashaccount/registration — output layout', () => {
    it('puts the Genesis Covenant at funding output 0 and change after it', () => {
        const outputs = buildFundingOutputs({
            genesisScript: makeGenesisScript(),
            genesisSatoshis: 10000,
            changeAddress: CHANGE_ADDRESS,
            changeSatoshis: 2000,
        })

        expect(outputs).toHaveLength(2)
        expect(binToHex(outputs[0].lockingBytecode)).toBe(binToHex(makeGenesisScript()))
        expect(outputs[0].valueSatoshis).toBe(10000n)
        expect(outputs[1].valueSatoshis).toBe(2000n)
    })

    it('creates the mutable NFT at output 0 and the profile at output 1', () => {
        const outputs = registrationOutputs()

        expect(outputs).toHaveLength(3)
        expect(binToHex(outputs[0].token.category)).toBe(KALLISTI_CATEGORY)
        expect(outputs[0].token.nft.capability).toBe('mutable')
        expect(outputs[0].token.nft.commitment).toHaveLength(40)
        expect(outputs[0].valueSatoshis).toBe(1389n)
        expect(decodeProfile(outputs[1].lockingBytecode).name).toBe('Kallisti')
        expect(outputs[1].valueSatoshis).toBe(0n)
        expect(outputs[2].valueSatoshis).toBe(5000n)
    })
})

describe('cashaccount/registration — sighash 0x61 + Genesis unlocking', () => {
    it('produces a deterministic 32-byte digest', () => {
        const transaction = buildUnsignedTransaction(KALLISTI_CATEGORY, registrationOutputs())
        const first = registrationSigningDigest({
            transaction,
            genesisScript: makeGenesisScript(),
            fundingValueSatoshis: 10000,
        })
        const second = registrationSigningDigest({
            transaction,
            genesisScript: makeGenesisScript(),
            fundingValueSatoshis: 10000,
        })

        expect(first).toHaveLength(32)
        expect(first).toEqual(second)
    })

    it('installs push(keySigs) push(ownerSig) and both signatures verify', async () => {
        const transaction = buildUnsignedTransaction(KALLISTI_CATEGORY, registrationOutputs())
        const genesisScript = makeGenesisScript()
        const digest = registrationSigningDigest({ transaction, genesisScript, fundingValueSatoshis: 10000 })

        await signRegistration({
            transaction,
            genesisScript,
            fundingValueSatoshis: 10000,
            spendPrivateKey: SPEND_KEY,
            scanPrivateKey: SCAN_KEY,
        })

        const unlocking = transaction.inputs[0].unlockingBytecode
        const keySigPushLength = unlocking[0]
        const keySig = unlocking.slice(1, 1 + keySigPushLength)
        const ownerSigPushLength = unlocking[1 + keySigPushLength]
        const ownerSig = unlocking.slice(2 + keySigPushLength, 2 + keySigPushLength + ownerSigPushLength)

        expect(keySigPushLength).toBe(64)
        expect(ownerSigPushLength).toBe(64)

        const secp256k1 = await instantiateSecp256k1()
        const spendPubkey = secp256k1.derivePublicKeyCompressed(SPEND_KEY)
        const scanPubkey = secp256k1.derivePublicKeyCompressed(SCAN_KEY)

        expect(secp256k1.verifySignatureSchnorr(ownerSig, spendPubkey, digest)).toBe(true)
        expect(secp256k1.verifySignatureSchnorr(keySig, scanPubkey, digest)).toBe(true)
    })

    it('appends the Nostr signature to keySigs when a binding is present', async () => {
        const transaction = buildUnsignedTransaction(KALLISTI_CATEGORY, registrationOutputs())
        const genesisScript = makeGenesisScript()
        const digest = registrationSigningDigest({ transaction, genesisScript, fundingValueSatoshis: 10000 })

        await signRegistration({
            transaction,
            genesisScript,
            fundingValueSatoshis: 10000,
            spendPrivateKey: SPEND_KEY,
            scanPrivateKey: SCAN_KEY,
            nostrPrivateKey: NOSTR_KEY,
        })

        const unlocking = transaction.inputs[0].unlockingBytecode
        const keySigPush = unlocking[0] === 0x4c
            ? { length: unlocking[1], offset: 2 }
            : { length: unlocking[0], offset: 1 }
        const keySigs = unlocking.slice(keySigPush.offset, keySigPush.offset + keySigPush.length)

        expect(keySigs).toHaveLength(128)

        const secp256k1 = await instantiateSecp256k1()
        const scanPubkey = secp256k1.derivePublicKeyCompressed(SCAN_KEY)
        const nostrPubkey = secp256k1.derivePublicKeyCompressed(NOSTR_KEY)

        expect(secp256k1.verifySignatureSchnorr(keySigs.slice(0, 64), scanPubkey, digest)).toBe(true)
        expect(secp256k1.verifySignatureSchnorr(keySigs.slice(64, 128), nostrPubkey, digest)).toBe(true)
    })
})

describe('cashaccount/registration — encoding helpers', () => {
    it('uses a direct push for a 64-byte signature', () => {
        expect(encodeDataPush(new Uint8Array(64))[0]).toBe(64)
    })
})
