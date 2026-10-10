/* Import modules. */
const msgpack = require('msgpack-lite')

/**
 * Get Flags
 */
const getFlags = (state) => {
    /* Validate state (of flags). */
    if (!state || !state.f) {
        return null
    }

    /* Initialize accounts. */
    const flags = msgpack.decode(Buffer.from(state.f))

    /* Return flags. */
    return flags
}

/* Export module. */
export default getFlags
