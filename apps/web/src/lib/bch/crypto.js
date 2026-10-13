// apps/web/src/lib/bch/crypto.js
/**
 * Local key/address cryptography (replaces the `window.BITBOX` crypto primitives).
 *
 * This module is pure/local — it never touches the network. It replaces:
 *   bitbox.Crypto.randomBytes      -> randomHex()
 *   bitbox.Mnemonic.fromEntropy    -> mnemonicFromEntropy()
 *   bitbox.Mnemonic.toSeed         -> seedFromMnemonic()
 *   bitbox.HDNode.fromSeed         -> hdNodeFromEntropy()
 *   HDNode.derivePath              -> derivePath()  (scure/bip32 `.derive`)
 *   bitbox.HDNode.toCashAddress    -> toCashAddress()
 *
 * PARITY: verified byte-for-byte identical to bitbox (mnemonic, BIP39 seed,
 * and CashAddress) across multiple entropies + derivation indices, so existing
 * wallets derive the exact same addresses after migration.
 *
 * Chain: entropy(32B hex) -> BIP39 mnemonic(english) -> BIP39 seed(no
 * passphrase) -> BIP32 master -> derivePath("m/44'/<coin>'/0'/0/N") ->
 * compressed pubkey -> hash160 -> P2PKH CashAddress.
 */
import { HDKey } from '@scure/bip32'
import { entropyToMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import {
    publicKeyToP2pkhCashAddress,
    cashAddressToLockingBytecode,
    encodeDataPush,
    encodeTransactionBCH,
    generateSigningSerializationBCH,
    hash256,
    hexToBin,
    binToHex,
    instantiateSecp256k1,
    instantiateSha256,
    SigningSerializationTypeBCH,
} from '@bitauth/libauth'
import { getNetwork, DEFAULT_NETWORK } from './networks.js'

/* ---- byte <-> hex helpers ---- */

export function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2)
    for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(hex.substr(i * 2, 2), 16)
    }
    return out
}

/**
 * Cryptographically-secure random bytes as a hex string.
 * Replacement for `bitbox.Crypto.randomBytes(n).toString('hex')`.
 * Uses the browser/node CSPRNG (`crypto.getRandomValues`).
 */
export function randomHex(numBytes) {
    const bytes = new Uint8Array(numBytes)
    globalThis.crypto.getRandomValues(bytes)
    return bytesToHex(bytes)
}

/* entropy hex -> BIP39 mnemonic (english wordlist) */
export function mnemonicFromEntropy(entropyHex) {
    return entropyToMnemonic(hexToBytes(entropyHex), wordlist)
}

/* BIP39 mnemonic -> 64-byte seed (empty passphrase, matching bitbox default) */
export function seedFromMnemonic(mnemonic) {
    return mnemonicToSeedSync(mnemonic)
}

/**
 * entropy hex -> BIP32 master HD node (scure/bip32 `HDKey`).
 * `HDKey` exposes `.derive(path)`, `.publicKey` (33B) and `.privateKey` (32B).
 */
export function hdNodeFromEntropy(entropyHex) {
    return HDKey.fromMasterSeed(seedFromMnemonic(mnemonicFromEntropy(entropyHex)))
}

/* Derive the child HD node at a BIP32 path (e.g. "m/44'/145'/0'/0/0"). */
export function derivePath(hdNode, path) {
    return hdNode.derive(path)
}

/**
 * Child HD node -> P2PKH CashAddress for a network.
 * @param {HDKey} hdNode - node with a `.publicKey`.
 * @param {string} networkId - 'mainnet' | 'chipnet' (defaults to mainnet).
 */
export function toCashAddress(hdNode, networkId = DEFAULT_NETWORK) {
    const { address } = publicKeyToP2pkhCashAddress({
        publicKey: hdNode.publicKey,
        prefix: getNetwork(networkId).addressPrefix,
    })
    return address
}

/* Child HD node -> 32-byte private key (used for transaction signing in F4). */
export function toPrivateKeyBytes(hdNode) {
    return hdNode.privateKey
}

/* Child HD node -> 33-byte (compressed) public key. */
export function toPublicKeyBytes(hdNode) {
    return hdNode.publicKey
}

/*
 * ---- Transaction building + P2PKH (Schnorr) signing ----
 *
 * Replaces `bitbox.TransactionBuilder` + `bitbox.HDNode.toKeyPair` + the
 * `_transactionBuilder.sign(..., SIGHASH_ALL, amount, SCHNORR)` call.
 *
 * The signing algorithm follows libauth's own BCH compiler exactly:
 *   serialization = generateSigningSerializationBCH(ctx, {coveredBytecode,
 *       signingSerializationType}, sha256)
 *   digest        = hash256(serialization)
 *   signature     = schnorrSign(privateKey, digest)  ++  signingSerializationType
 *   unlocking     = push(signature) ++ push(publicKey)
 * where `signingSerializationType = 0x41` (SIGHASH_ALL | SIGHASH_FORKID).
 */

/* Lazily-instantiated (async, WASM) crypto primitives. */
let _secp256k1 = null
let _sha256 = null

/* Instantiate (once) the WASM secp256k1 + sha256 primitives. */
export async function initSigning() {
    if (!_secp256k1) {
        _secp256k1 = await instantiateSecp256k1()
    }
    if (!_sha256) {
        _sha256 = await instantiateSha256()
    }
}

/* CashAddress -> raw P2PKH locking bytecode (Uint8Array). */
export function addressToLockingBytecode(address) {
    return cashAddressToLockingBytecode(address).bytecode
}

/**
 * Build an (unsigned) P2PKH transaction bundle.
 * @param {Array} inputs  - [{ txid, vout, satoshis, address }]
 * @param {Array} outputs - [{ address, satoshis }]
 * @returns {{transaction, sourceOutputs, coveredBytecodes}}
 *   `transaction` is a libauth TransactionCommon (unlockingBytecode empty);
 *   `sourceOutputs` / `coveredBytecodes` are aligned with `inputs` (used when
 *   signing each input).
 */
export function buildTransaction(inputs, outputs) {
    /* P2PKH locking bytecode of each input's (source) address. */
    const coveredBytecodes = inputs.map((input) => addressToLockingBytecode(input.address))

    /* The (source) outputs being spent, aligned with `inputs`. */
    const sourceOutputs = inputs.map((input, index) => ({
        lockingBytecode: coveredBytecodes[index],
        valueSatoshis: BigInt(input.satoshis),
    }))

    /* The (unsigned) transaction. */
    const transaction = {
        version: 1,
        inputs: inputs.map((input) => ({
            outpointIndex: input.vout,
            outpointTransactionHash: hexToBin(input.txid),
            sequenceNumber: 0xffffffff,
            unlockingBytecode: new Uint8Array(0),
        })),
        outputs: outputs.map((output) => ({
            lockingBytecode: addressToLockingBytecode(output.address),
            valueSatoshis: BigInt(output.satoshis),
        })),
        locktime: 0,
    }

    return { transaction, sourceOutputs, coveredBytecodes }
}

/**
 * Sign a single P2PKH input (in place) with BCH Schnorr + SIGHASH_ALL.
 * @param {object} bundle - the result of buildTransaction().
 * @param {number} inputIndex - which input to sign.
 * @param {Uint8Array} privateKey - 32-byte private key.
 * @param {Uint8Array} publicKey - 33-byte (compressed) public key.
 */
export async function signP2pkhInput(bundle, inputIndex, privateKey, publicKey) {
    await initSigning()

    /* SIGHASH_ALL | SIGHASH_FORKID (0x41), as a single-byte array. */
    const signingSerializationType = Uint8Array.of(SigningSerializationTypeBCH.allOutputs)

    /* The signing context (transaction + the source outputs being spent). */
    const context = {
        inputIndex,
        sourceOutputs: bundle.sourceOutputs,
        transaction: bundle.transaction,
    }

    /* BIP143-style (BCH) signing serialization -> sighash digest. */
    const serialization = generateSigningSerializationBCH(
        context,
        {
            coveredBytecode: bundle.coveredBytecodes[inputIndex],
            signingSerializationType,
        },
        _sha256
    )
    const digest = hash256(serialization, _sha256)

    /* Schnorr-sign the digest. */
    const signature = _secp256k1.signMessageHashSchnorr(privateKey, digest)
    if (typeof signature === 'string') {
        throw new Error(`Schnorr signing failed: ${signature}`)
    }

    /* The bitcoin-encoded signature (sig + sighash type byte). */
    const bitcoinEncodedSignature = Uint8Array.from([...signature, ...signingSerializationType])

    /* The P2PKH unlocking bytecode: push(signature) push(publicKey). */
    bundle.transaction.inputs[inputIndex].unlockingBytecode = Uint8Array.from([
        ...encodeDataPush(bitcoinEncodedSignature),
        ...encodeDataPush(publicKey),
    ])
}

/* Encode a (signed) transaction to its raw hex representation. */
export function encodeTransactionToHex(transaction) {
    return binToHex(encodeTransactionBCH(transaction))
}

/**
 * Estimate the byte count of a P2PKH transaction.
 * Matches `bitbox.BitcoinCash.getByteCount({ P2PKH: in }, { P2PKH: out })`:
 * 10 (overhead) + 148 per P2PKH input + 34 per P2PKH output.
 */
export function estimateByteCount(inputsCount, outputsCount) {
    return 10 + (inputsCount * 148) + (outputsCount * 34)
}
