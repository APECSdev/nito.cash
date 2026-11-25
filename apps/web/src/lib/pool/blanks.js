// src/lib/pool/blanks.js
//
// Blank inventory + permissionless vending (role-2 tagged pool).
//
// A BLANK is the pool's mutable NFT with an EMPTY commitment and 0 FT:
//   token.category === pool category
//   token.nft.capability === 'mutable'
//   token.nft.commitment === '' (empty)
//   token.amount === 0
// The guard mints them in batches; the operator loads them into the vending
// covenant; anyone buys one by paying the pinned price on-chain (no signature,
// no permission). Each lock spends exactly TWO blanks. The wallet counts the
// held blanks as "actions remaining" and treats the vending locking as a
// buyable UTXO source.

/* The role-2 vending covenant (handoff §4.1): category-pinned P2SH32, 157 B
   redeem, 1,000 sats per blank; the buyer's tokenless funding input pays the
   price and the blank is delivered to the funding input's own locking. */
export const BLANK_VENDING_MACHINE =
    'aa206b51396304b3bd4e0e9c254f84d1ee80d83a5c7ccaf3750883d00866480d981287'
export const BLANK_VENDING_PRICE_SATS = 1000
export const BLANK_VENDING_REDEEM_BYTES = 157
export const BLANKS_PER_LOCK = 2

/* The pool category is supplied by the caller (registry pool.assetCategory);
   the helpers stay pool-agnostic so they work for any role-2 deployment. */

function tokenOf(utxo) {
    return utxo?.token_data || utxo?.token || null
}

/* Fulcrum returns the NFT commitment as hex ('' for empty); some callers pass
   a `0x`-prefixed string. Treat every empty spelling as empty. */
function isEmptyCommitment(commitment) {
    if (commitment === undefined || commitment === null) return true
    const value = String(commitment)
    return value === '' || value === '0x'
}

/*
 * isBlankUtxo — the exact blank shape:
 *   pool category + mutable NFT + EMPTY commitment + 0 FT.
 * Rejects malformed/foreign tokens (never spend another category's NFT).
 */
export function isBlankUtxo(utxo, category) {
    if (!utxo || !category) return false
    const token = tokenOf(utxo)
    if (!token) return false
    if (String(token.category || '').toLowerCase() !== String(category).toLowerCase()) return false

    const amount = token.amount
    if (amount !== undefined && amount !== null && String(amount) !== '0') return false

    const nft = token.nft
    if (!nft) return false
    if (nft.capability !== 'mutable') return false
    if (!isEmptyCommitment(nft.commitment)) return false

    return true
}

export function getBlanks(utxos, category) {
    return (utxos || []).filter((utxo) => isBlankUtxo(utxo, category))
}

export function countBlanks(utxos, category) {
    return getBlanks(utxos, category).length
}

/* "Actions remaining" = whole locks the held blanks can fund (2 per lock). */
export function actionsRemaining(utxos, category) {
    return Math.floor(countBlanks(utxos, category) / BLANKS_PER_LOCK)
}

/*
 * selectBlanks — pick exactly `count` (default 2) blanks for one lock.
 * Returns null when the inventory cannot fund the lock; never partially
 * selects (a lock must spend exactly two blanks).
 */
export function selectBlanks(utxos, category, count = BLANKS_PER_LOCK) {
    const blanks = getBlanks(utxos, category)
    if (blanks.length < count) return null
    return blanks.slice(0, count)
}

/* The vending machine UTXO is the buyable source: its locking is the machine
   P2SH32; buying spends it with the buyer's funding input + the pinned price. */
export function isVendingUtxo(utxo, machine = BLANK_VENDING_MACHINE) {
    const locking = utxo?.lockingBytecode || utxo?.scriptPubKey || utxo?.script || null
    if (!locking) return false
    return String(locking).toLowerCase() === String(machine).toLowerCase()
}

export function getVendingUtxos(utxos, machine = BLANK_VENDING_MACHINE) {
    return (utxos || []).filter((utxo) => isVendingUtxo(utxo, machine))
}

/*
 * The vending machine is a P2SH32 — libauth's lockingBytecodeToCashAddress
 * only encodes P2PKH/P2SH20, and Fulcrum rejects the hashType-bit CashAddress
 * spelling of a P2SH32 ("Invalid address"). Return the locking bytecode hex,
 * which is the canonical machine identifier the wallet/explorer can use.
 */
export function vendingAddress(machine = BLANK_VENDING_MACHINE) {
    return String(machine).toLowerCase()
}

/* The machine's token category is the pool's; a vending UTXO carries the
   category + mutable NFT (the stock). This predicate is the "buyable" test. */
export function isBuyableVendingUtxo(utxo, category, machine = BLANK_VENDING_MACHINE) {
    return isVendingUtxo(utxo, machine) && isBlankUtxo(utxo, category)
}

export function blankSummary(utxos, category) {
    const blanks = getBlanks(utxos, category)
    return {
        blanks: blanks.length,
        actions: Math.floor(blanks.length / BLANKS_PER_LOCK),
        vending: getVendingUtxos(utxos).length,
        buyable: getVendingUtxos(utxos).filter((utxo) => isBlankUtxo(utxo, category)).length,
        blanksPerLock: BLANKS_PER_LOCK,
        vendingPriceSats: BLANK_VENDING_PRICE_SATS,
    }
}
