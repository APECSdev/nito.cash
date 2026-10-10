/**
 * Destroy Profile
 *
 * This will completely destory the user's profile.
 */
const destroyProfile = (state) => {
    /* Reset flags. */
    state.f = null

    /* Reset locale. */
    state.l = null

    /* Reset master initialization vector. */
    state.miv = null

    /* Reset master seed. */
    state.ms = null
}

/* Export module. */
export default destroyProfile
