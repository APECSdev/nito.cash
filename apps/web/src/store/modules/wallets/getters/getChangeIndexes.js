/* Import modules. */
const msgpack = require('msgpack-lite')

/**
 * Get Change (Chain) Indexes
 *
 * Returns the DISCOVERED branch-1 (BIP44 change chain) account indexes for
 * the wallet. NOTE: foreign (BIP44-standard) wallets keep their change on
 * branch 1 (`m/44'/145'/0'/1/N`), while nito's own change lives on branch 0
 * (see getChangeAddress, which appends index + 1 to the branch-0 pool) — so
 * a restored wallet's foreign change funds are invisible unless the change
 * chain is scanned separately (see restoreWallet's discovery scan).
 *
 * Returns an ARRAY of indexes (possibly empty).
 */
const getChangeIndexes = (state, getters, rootState, rootGetters) => (_wallet) => {
    /* Validate state. */
    if (!state || !state.c) {
        return []
    }

    /* Decode (msgpack) change indexes. */
    let change
    try {
        change = msgpack.decode(Buffer.from(state.c))
    } catch (err) {
        /* Corrupted payload — treat as "nothing discovered" (do NOT break
           address derivation / balance scans over it). */
        return []
    }

    /* Validate (wallet) change indexes. */
    if (!change || !Array.isArray(change[_wallet])) {
        return []
    }

    /* Return (change) indexes. */
    return change[_wallet]
}

/* Export module. */
export default getChangeIndexes
