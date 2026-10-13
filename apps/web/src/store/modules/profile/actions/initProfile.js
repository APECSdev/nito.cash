/* Import crypto helpers (local key/address cryptography). */
import { randomHex } from '@/lib/bch/crypto.js'

/**
 * Initialize Wallet
 */
const initProfile = async ({ state, commit }) => {
    /* Validate profile. */
    if (state.ms && state.miv) {
        console.info('Profile already exists.') // eslint-disable-line no-console

        /* Cancel initialization. */
        return
    } else {
        console.info('Initializing NEW profile...') // eslint-disable-line no-console
    }

    /**
     * Master Seed
     *
     * Generate a wallet master seed from random bytes.
     *
     * !!! WARNING !!! WARNING !!! WARNING !!!
     * We MUST properly evaluate ANY and ALL weaknesses with
     * using randomBytes via a ("mobile") web browser.
     */
    const masterSeed = randomHex(32)

    /* Set new master (private) key. */
    commit('setMasterSeed', masterSeed)

    /**
     * Initialization Vector
     *
     * Used for AES encryption/decryption.
     * Algorithm is `aes-256-cbc`.
     */
    const iv = randomHex(16)

    /* Set new master initialization vector. */
    commit('setMasterIV', iv)

    /**
     * Initialize Flags
     *
     * - Darm mode (dm)
     * - Unconfirmed transactions (ut)
     */
    const defaultFlags = {
        dm: false,
        ut: true,
    }

    /* Set (default) flags. */
    commit('setFlags', defaultFlags)

    /* Initialize (default) locale. */
    const defaultLocale = 'en-US'

    /* Set (default) locale. */
    commit('setLocale', defaultLocale)
}

/* Export module. */
export default initProfile
