/*
 * PUSD shielded pool (Chipnet PoC) — wallet-side note store.
 *
 * Holds the user's shielded notes and the pool commitment leaves the wallet
 * knows about. Persistence is split: `sealed` (an AES-256-GCM ciphertext of
 * the note list, keyed from the wallet entropy — see src/lib/pool/seal.js)
 * and the public `leaves` persist via the root pinia-plugin-persistedstate
 * (cookie on the `nito` target, localStorage otherwise), while the decrypted
 * `notes` mirror is runtime-only (`omit: ['pool.notes']` in
 * src/store/index.js) and rehydrated by the unlockPool action at boot.
 * Scope caveat: the profile store persists the master seed in the same
 * storage, so against a reader of that storage this is defense-in-depth,
 * not a hard boundary (see private-payments/roadmap).
 */

/* Import seal/unseal helpers. */
import { deriveSealKey, sealJSON, unsealJSON } from '@/lib/pool/seal.js'

/* Runtime-only seal key — never persisted, never part of store state. */
let _sealKey = null

/* Initialize state. */
const state = {
    /* Notes owned by this wallet — RUNTIME-ONLY mirror (excluded from
       persistence; rehydrated from `sealed` by the unlockPool action).
       Each: { value, ownerPub, rho, r, nk, cm, nf, leafIndex, spent }
       (field elements as decimal strings). */
    notes: [],

    /* Pool commitment leaves the wallet has recorded (in append order).
       Public on-chain data — persisted as plaintext. */
    leaves: [],

    /* AES-256-GCM ciphertext of `notes`, keyed from the wallet entropy —
       the only note data that persists. */
    sealed: null,
}

/* Getters. */
const getters = {
    getNotes: (state) => state.notes,

    getUnspentNotes: (state) => state.notes.filter((n) => !n.spent),

    getLeaves: (state) => state.leaves,

    getNoteCount: (state) => state.notes.length,

    getShieldedBalance: (state) =>
        state.notes
            .filter((n) => !n.spent)
            .reduce((sum, n) => sum + BigInt(n.value), 0n),
}

/* Actions. */
const actions = {
    /*
     * Record a new (unspent) note and append its commitment as the next leaf.
     * The note's leafIndex is assigned here (current leaf count). Re-seals
     * the persisted ciphertext when the store is unlocked; while locked the
     * note stays runtime-only (nothing secret reaches persistence).
     */
    async recordNote({ commit, state }, note) {
        const leafIndex = state.leaves.length

        commit('APPEND_LEAF', { leaf: note.cm })
        commit('ADD_NOTE', { note: { ...note, leafIndex, spent: false } })

        await reseal({ commit, state })
    },

    /* Mark the note with the given nullifier as spent. */
    async spendNote({ commit, state }, { nf }) {
        commit('SPEND_NOTE', { nf })

        await reseal({ commit, state })
    },

    /*
     * Derive the seal key from the wallet entropy and decrypt the persisted
     * ciphertext into the runtime-only `notes` mirror. No-op (returns false)
     * when no seed is set yet; returns whether the store is unlocked.
     */
    async unlockPool({ commit, state, rootGetters }) {
        const entropyHex = rootGetters['profile/getMasterSeed']

        if (!entropyHex) {
            return false
        }

        _sealKey = await deriveSealKey(entropyHex)

        if (state.sealed) {
            const notes = await unsealJSON(state.sealed, _sealKey)

            commit('SET_NOTES', { notes })
        }

        return true
    },

    /* Drop the seal key and the decrypted mirror (ciphertext stays persisted). */
    lockPool({ commit }) {
        _sealKey = null

        commit('SET_NOTES', { notes: [] })
    },
}

/* Re-seal the runtime notes into the persisted ciphertext (no-op while locked). */
async function reseal({ commit, state }) {
    if (!_sealKey) {
        return
    }

    const sealed = await sealJSON(state.notes, _sealKey)

    commit('SET_SEALED', { sealed })
}

/* Mutations. */
const mutations = {
    ADD_NOTE(state, { note }) {
        state.notes.push(note)
    },

    APPEND_LEAF(state, { leaf }) {
        state.leaves.push(leaf)
    },

    SPEND_NOTE(state, { nf }) {
        const note = state.notes.find((n) => n.nf === nf)

        if (note) {
            note.spent = true
        }
    },

    SET_NOTES(state, { notes }) {
        state.notes = notes
    },

    SET_SEALED(state, { sealed }) {
        state.sealed = sealed
    },
}

/* Export. */
export default {
    namespaced: true,
    state,
    getters,
    actions,
    mutations
}
