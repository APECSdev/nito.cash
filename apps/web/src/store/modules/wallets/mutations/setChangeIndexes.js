/* Import modules. */
const msgpack = require('msgpack-lite')

/**
 * Set Change (Chain) Indexes
 *
 * Stores the DISCOVERED branch-1 (BIP44 change chain) indexes per wallet,
 * msgpack-encoded (same pattern as the accounts model). Payload shape:
 *     { BCH: [0, 1, 2] }
 */
const setChangeIndexes = (state, _changeIndexes) => {
    /* Set change indexes. */
    state.c = msgpack.encode(_changeIndexes)
}

/* Export module. */
export default setChangeIndexes
