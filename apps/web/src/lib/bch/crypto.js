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
import { publicKeyToP2pkhCashAddress } from '@bitauth/libauth'
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
