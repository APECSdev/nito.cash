// apps/web/src/lib/cashaccount/resolver.js
//
// CashAccounts v2 resolver: ChainGraph → verified account records.
//
// The resolver never trusts a name→category claim. It starts from the
// on-chain registration (the OP_RETURN prefix scan), decodes the profile and
// the Identity NFT commitment, checks the Genesis Covenant's structural
// invariant (input 0 spends output 0 of the funding transaction, and the
// NFT category IS that funding txid), and computes the Collision Hash from
// the registration block. The category is the stable identity; the name is
// the human label (spec lines 469-482: pin the category).

import {
    getCategoryOutputs,
    getTransaction,
    loadAllRegistrations,
} from './chaingraph.js'
import { decodeCommitment } from './commitment.js'
import { spendPubkeyFromIdentityScript } from './covenant.js'
import {
    accountColor,
    assignIdentifiers,
    collisionHash,
    formatIdentifier,
    identiconFor,
    normalizeHex,
    parseIdentifier,
    pendingIdentifier,
} from './identifier.js'
import { npubEncode } from './nostr.js'
import { decodeProfile, isRegistrationScript } from './profile.js'

/**
 * Build an account record from a REGISTRATION transaction.
 *
 * The registration transaction is the one whose input 0 spends the funding
 * transaction's output 0. The Identity NFT category equals the funding txid
 * (spec lines 347-353; Appendix A's `category` derivation).
 *
 * @param {object} tx - normalized transaction from chaingraph.js
 * @returns {object}
 */
export function accountFromRegistration(tx) {
    if (!tx || !Array.isArray(tx.outputs) || tx.outputs.length < 2) {
        throw new Error('resolver: transaction does not have the registration outputs')
    }

    const nftOutput = tx.outputs[0]
    const profileOutput = tx.outputs[1]

    if (!nftOutput.tokenCategory || !nftOutput.nftCommitment) {
        throw new Error('resolver: output 0 is not the Identity NFT')
    }

    if (nftOutput.nftCapability !== 'mutable') {
        throw new Error('resolver: the Identity NFT must be mutable')
    }

    if (!isRegistrationScript(profileOutput.lockingBytecodeHex)) {
        throw new Error('resolver: output 1 is not a CashAccounts v2 registration')
    }

    const profile = decodeProfile(profileOutput.lockingBytecodeHex)
    const commitment = decodeCommitment(nftOutput.nftCommitment)
    const category = normalizeHex(nftOutput.tokenCategory)
    const inputZero = tx.inputs && tx.inputs[0]

    if (!inputZero) {
        throw new Error('resolver: registration has no input 0')
    }

    if (normalizeHex(inputZero.outpointTransactionHash) !== category) {
        throw new Error('resolver: input 0 does not spend the category funding output')
    }

    if (inputZero.outpointIndex !== 0) {
        throw new Error('resolver: input 0 does not spend funding output 0')
    }

    const spendPubkey = spendPubkeyFromIdentityScript(nftOutput.lockingBytecodeHex)
    const npub = commitment.nostrPubkey ? npubEncode(commitment.nostrPubkey) : null
    const pending = !tx.block
    const hash = pending ? null : collisionHash(tx.block.hash, category)
    const identicon = hash ? identiconFor(hash) : null

    return {
        pending,
        name: profile.name,
        identifier: hash ? formatIdentifier(profile.name, hash) : pendingIdentifier(profile.name),
        collisionHash: hash,
        identicon,
        color: hash ? accountColor(hash) : null,
        category,
        network: commitment.network,
        networkByte: commitment.networkByte,
        prefix: commitment.prefix,
        scanPubkey: commitment.scanPubkey,
        spendPubkey,
        nostrPubkey: commitment.nostrPubkey,
        npub,
        commitment,
        profile,
        identityScript: nftOutput.lockingBytecodeHex,
        txid: tx.hash,
        vout: 0,
        valueSatoshis: nftOutput.valueSatoshis,
        block: tx.block,
        transactionIndex: tx.block ? tx.block.transactionIndex : null,
    }
}

/**
 * Resolve a registration transaction by txid.
 *
 * @param {string} txid
 * @returns {Promise<object>}
 */
export async function resolveByTxid(txid) {
    const tx = await getTransaction(txid)

    if (!tx) {
        throw new Error(`resolver: transaction ${txid} was not found`)
    }

    return accountFromRegistration(tx)
}

/**
 * Resolve an account by its Identity NFT category.
 *
 * @param {string} category
 * @returns {Promise<object>}
 */
export async function resolveByCategory(category) {
    const normalized = normalizeHex(category)
    const outputs = await getCategoryOutputs(normalized)
    const candidates = outputs.filter((output) => output.outputIndex === 0 && output.nftCapability)

    for (const candidate of candidates) {
        try {
            return accountFromRegistration(candidate.transaction)
        } catch (error) {
            /* Not the genesis transaction; keep looking. */
        }
    }

    throw new Error(`resolver: no registration found for category ${normalized}`)
}

/**
 * Load every registration and assign Minimal/Extended identifiers.
 *
 * The returned records are the accounts plus `extensionNybbles`, `extension`,
 * `identifier` and `minimal` from identifier.assignIdentifiers().
 *
 * @param {{ pageSize?: number, maxPages?: number }} [options]
 * @returns {Promise<object[]>}
 */
export async function loadRegistrationAccounts(options = {}) {
    const transactions = await loadAllRegistrations(options)
    const accounts = []

    for (const transaction of transactions) {
        try {
            accounts.push(accountFromRegistration(transaction))
        } catch (error) {
            /* The prefix scan can include a malformed registration; skip it. */
        }
    }

    const confirmed = accounts.filter((account) => !account.pending)
    const assigned = assignIdentifiers(confirmed.map((account) => ({
        ...account,
        name: account.profile.name,
        height: account.block.height,
        transactionIndex: account.block.transactionIndex,
    })))
    const assignedByCategory = new Map(assigned.map((account) => [account.category, account]))

    return accounts.map((account) => assignedByCategory.get(account.category) || account)
}

/**
 * Resolve a Complete/Minimal Identifier.
 *
 * Without an extension the earliest registration for the four-digit prefix
 * is returned (the Minimal Identifier). With an extension, the matching
 * later registration is returned.
 *
 * @param {string} identifier
 * @returns {Promise<object>}
 */
export async function resolveByIdentifier(identifier) {
    const parsed = parseIdentifier(identifier)

    if (!parsed) {
        throw new Error(`resolver: "${identifier}" is not a CashAccount identifier`)
    }

    const accounts = await loadRegistrationAccounts()
    const matches = accounts.filter((account) => {
        if (account.pending || !account.collisionHash) {
            return false
        }

        if (account.profile.name.toUpperCase() !== parsed.name.toUpperCase()) {
            return false
        }

        if (account.collisionHash.slice(0, 4) !== parsed.collision.toLowerCase()) {
            return false
        }

        if (parsed.extension) {
            return account.collisionHash.slice(4, 4 + parsed.extension.length) === parsed.extension
        }

        return true
    })

    if (matches.length === 0) {
        throw new Error(`resolver: no registration matches ${identifier}`)
    }

    /* The no-extension form is the EARLIEST registration for the four-digit
       prefix (spec lines 432-440). The scan order is not guaranteed to be
       chain order, so sort explicitly. */
    matches.sort((a, b) => {
        const heightDelta = Number(a.block.height) - Number(b.block.height)

        if (heightDelta !== 0) {
            return heightDelta
        }

        return Number(a.transactionIndex || 0) - Number(b.transactionIndex || 0)
    })

    return matches[0]
}

/**
 * Resolve an account from any of the accepted inputs.
 *
 * @param {{ identifier?: string, txid?: string, category?: string }} params
 * @returns {Promise<object>}
 */
export async function resolveAccount({ identifier = null, txid = null, category = null } = {}) {
    if (identifier) {
        const parsed = parseIdentifier(identifier)

        if (parsed) {
            return resolveByIdentifier(identifier)
        }

        const hex = normalizeHex(identifier)

        if (/^[0-9a-f]{64}$/.test(hex)) {
            try {
                return await resolveByTxid(hex)
            } catch (error) {
                return resolveByCategory(hex)
            }
        }

        throw new Error(`resolver: "${identifier}" is not an identifier, txid, or category`)
    }

    if (txid) {
        return resolveByTxid(txid)
    }

    if (category) {
        return resolveByCategory(category)
    }

    throw new Error('resolver: provide an identifier, txid, or category')
}

/**
 * A tiny helper for the UI: the short category form.
 *
 * @param {string} category
 * @returns {string}
 */
export function shortCategory(category) {
    const hex = normalizeHex(category)
    return `${hex.slice(0, 8)}…${hex.slice(-8)}`
}

