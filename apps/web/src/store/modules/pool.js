/*
 * PUSD shielded pool (Chipnet PoC) — wallet-side note store.
 *
 * Holds the user's shielded notes and the pool commitment leaves the wallet
 * knows about. Persisted via the root pinia-plugin-persistedstate (cookie on
 * the `nito` target, localStorage otherwise) — an encrypted note store
 * replaces this before mainnet (see private-payments/roadmap).
 */

/* Initialize state. */
const state = {
    /* Notes owned by this wallet. Each: { value, ownerPub, rho, r, nk,
       cm, nf, leafIndex, spent } (field elements as decimal strings). */
    notes: [],

    /* Pool commitment leaves the wallet has recorded (in append order). */
    leaves: [],
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
     * The note's leafIndex is assigned here (current leaf count).
     */
    recordNote({ commit, state }, note) {
        const leafIndex = state.leaves.length

        commit('APPEND_LEAF', { leaf: note.cm })
        commit('ADD_NOTE', { note: { ...note, leafIndex, spent: false } })
    },

    /* Mark the note with the given nullifier as spent. */
    spendNote({ commit }, { nf }) {
        commit('SPEND_NOTE', { nf })
    },
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
}

/* Export. */
export default {
    namespaced: true,
    state,
    getters,
    actions,
    mutations
}
