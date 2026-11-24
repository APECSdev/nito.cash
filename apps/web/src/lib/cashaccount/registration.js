// apps/web/src/lib/cashaccount/registration.js
//
// CashAccounts v2 registration transaction layout and covenant signing.
//
// The registration transaction spends the FUNDING transaction's output 0
// (the Genesis Covenant P2S) and creates:
//
//   out 0 : the mutable Identity NFT (category = funding txid, commitment
//           40/72 bytes, locked by the compiled Identity Covenant)
//   out 1 : the profile OP_RETURN (see profile.js)
//   out 2 : BCH change back to the owner
//
// The Genesis Covenant (Appendix A) signs with sighash 0x61 and the raw
// 64-byte BCH Schnorr signatures. Its function is
// `register(ownerSig, keySigs)`; the CashScript unlocking script pushes the
// arguments in reverse order (the Identity Covenant's Appendix B note:
// "pushes nostrSig, scanSig, spendSig, then ownerSig"), so this builder
// pushes `keySigs` first, then `ownerSig`.
//
// BYTE ORDER: libauth keeps outpoint hashes and token categories in DISPLAY
// order (verified live in lib/pool/decode.js:111-118); the pool builder uses
// the same `hexToBin(txid)` convention (lib/pool/build.js:235). This module
// follows it.
//
// PHASE 1 GATE: the first live registration must be evaluated on the BCH-2026
// VM before broadcast (the wallet's established pre-broadcast gate). The
// compiled Identity Covenant artifact is a build-host input (CashScript
// 0.13.0); covenant.js carries the sources and the expected 197-byte size.

import {
    cashAddressToLockingBytecode,
    encodeDataPush,
    generateSigningSerializationBCH,
    hash256,
    hexToBin,
    instantiateSecp256k1,
    sha256,
    SigningSerializationTypeBCH,
} from '@bitauth/libauth'
import { encodeCommitment } from './commitment.js'
import { assertCompiledArtifact } from './covenant.js'
import { encodeProfile } from './profile.js'

/* The live mainnet registration 8267bff0… carries 1,389 sats on the NFT
   output. The spec only requires the relay dust threshold; this constant is
   the observed live value and a safe floor. */
export const IDENTITY_NFT_SATS = 1389

/* The Genesis Covenant's input must spend the funding output at index 0. */
export const FUNDING_OUTPUT_INDEX = 0

let _secp256k1 = null

async function getSecp256k1() {
    if (!_secp256k1) {
        _secp256k1 = await instantiateSecp256k1()
    }

    return _secp256k1
}

/**
 * The funding transaction's outputs: the Genesis Covenant at output 0, then
 * change. The caller assembles/signs the funding inputs (P2PKH) around this
 * layout.
 *
 * @param {object} params
 * @param {Uint8Array|string} params.genesisScript - compiled Appendix A
 * @param {number} params.genesisSatoshis - value locked for the registration
 * @param {string} [params.changeAddress] - omit to create no change output
 * @param {number} [params.changeSatoshis=0]
 * @returns {Array<object>} libauth outputs
 */
export function buildFundingOutputs({ genesisScript, genesisSatoshis, changeAddress = null, changeSatoshis = 0 }) {
    const genesisBytes = typeof genesisScript === 'string'
        ? hexToBin(genesisScript)
        : genesisScript

    assertCompiledArtifact('genesis', genesisBytes)

    const outputs = [{
        lockingBytecode: genesisBytes,
        valueSatoshis: BigInt(genesisSatoshis),
    }]

    if (changeAddress && changeSatoshis > 0) {
        outputs.push({
            lockingBytecode: cashAddressToLockingBytecode(changeAddress).bytecode,
            valueSatoshis: BigInt(changeSatoshis),
        })
    }

    return outputs
}

/**
 * The registration transaction's outputs.
 *
 * @param {object} params
 * @param {string} params.fundingTxid - the funding transaction (the category)
 * @param {Uint8Array|string} params.identityScript - compiled Appendix B
 * @param {object} params.commitment - encodeCommitment() fields
 * @param {object} params.profile - encodeProfile() fields
 * @param {string} [params.changeAddress] - P2PKH CashAddress for change
 * @param {number} [params.changeSatoshis=0]
 * @returns {Array<object>} libauth outputs
 */
export function buildRegistrationOutputs({ fundingTxid, identityScript, commitment, profile, changeAddress = null, changeSatoshis = 0 }) {
    const identityBytes = typeof identityScript === 'string'
        ? hexToBin(identityScript)
        : identityScript

    assertCompiledArtifact('identity', identityBytes)

    const commitmentBytes = encodeCommitment(commitment)
    const profileScript = encodeProfile(profile)
    const category = hexToBin(fundingTxid)

    const outputs = [{
        lockingBytecode: identityBytes,
        valueSatoshis: BigInt(IDENTITY_NFT_SATS),
        token: {
            category,
            amount: 0n,
            nft: {
                capability: 'mutable',
                commitment: commitmentBytes,
            },
        },
    }, {
        lockingBytecode: profileScript,
        valueSatoshis: 0n,
    }]

    if (changeAddress && changeSatoshis > 0) {
        outputs.push({
            lockingBytecode: cashAddressToLockingBytecode(changeAddress).bytecode,
            valueSatoshis: BigInt(changeSatoshis),
        })
    }

    return outputs
}

/**
 * The SIGHASH_ALL|FORKID|UTXOS (0x61) digest for the registration input.
 *
 * The registration transaction has exactly one input in this builder (the
 * Genesis Covenant output); additional P2PKH fee inputs require extending
 * the source-output list and signing them separately.
 *
 * @param {object} params
 * @param {object} params.transaction - unsigned libauth transaction
 * @param {Uint8Array|string} params.genesisScript - the funding output's script
 * @param {number} params.fundingValueSatoshis - the funding output's value
 * @returns {Uint8Array} 32-byte digest
 */
export function registrationSigningDigest({ transaction, genesisScript, fundingValueSatoshis }) {
    const genesisBytes = typeof genesisScript === 'string'
        ? hexToBin(genesisScript)
        : genesisScript
    const sourceOutputs = [{
        lockingBytecode: genesisBytes,
        valueSatoshis: BigInt(fundingValueSatoshis),
    }]
    const signingSerializationType = Uint8Array.of(SigningSerializationTypeBCH.allOutputsAllUtxos)

    const serialization = generateSigningSerializationBCH(
        {
            inputIndex: 0,
            sourceOutputs,
            transaction,
        },
        {
            coveredBytecode: genesisBytes,
            signingSerializationType,
        },
        sha256,
    )

    return hash256(serialization)
}

/**
 * Sign the Genesis Covenant input and install its unlocking bytecode.
 *
 * @param {object} params
 * @param {object} params.transaction - unsigned libauth transaction (mutated)
 * @param {Uint8Array|string} params.genesisScript
 * @param {number} params.fundingValueSatoshis
 * @param {Uint8Array} params.spendPrivateKey - CashCode spend key
 * @param {Uint8Array} params.scanPrivateKey - CashCode scan key
 * @param {Uint8Array|null} [params.nostrPrivateKey=null] - BCH proof key
 *   (the even-Y-normalized key from nostr.js toBchNostrProofKey)
 * @returns {Promise<object>} the same transaction
 */
export async function signRegistration({ transaction, genesisScript, fundingValueSatoshis, spendPrivateKey, scanPrivateKey, nostrPrivateKey = null }) {
    const secp256k1 = await getSecp256k1()
    const digest = registrationSigningDigest({ transaction, genesisScript, fundingValueSatoshis })

    const ownerSignature = secp256k1.signMessageHashSchnorr(spendPrivateKey, digest)
    const scanSignature = secp256k1.signMessageHashSchnorr(scanPrivateKey, digest)

    if (typeof ownerSignature === 'string' || typeof scanSignature === 'string') {
        throw new Error('registration: Schnorr signing failed')
    }

    let keySignatures = scanSignature

    if (nostrPrivateKey) {
        const nostrSignature = secp256k1.signMessageHashSchnorr(nostrPrivateKey, digest)

        if (typeof nostrSignature === 'string') {
            throw new Error('registration: Nostr Schnorr signing failed')
        }

        keySignatures = new Uint8Array([...scanSignature, ...nostrSignature])
    }

    transaction.inputs[0].unlockingBytecode = new Uint8Array([
        ...encodeDataPush(keySignatures),
        ...encodeDataPush(ownerSignature),
    ])

    return transaction
}
