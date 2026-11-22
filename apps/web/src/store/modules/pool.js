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

/* Import the note-detection scan (blocker #2 wiring — see lib/pool/scan.js). */
import { scanPool } from '@/lib/pool/scan.js'
import { getDefaultPool } from '@/lib/pool/registry.js'
import { deriveSpendKey } from '@/lib/pool/notes.js'

/* Import byte helpers + the Fulcrum provider (quorum-verified chain data). */
import { hexToBytes } from '@/lib/bch/crypto.js'
import { getCluster } from '@/lib/bch/provider.js'

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

    /* Last note-detection scan checkpoint (informational; the scan is a
       full rescan by design — chipnet-scale). { height, txid, actionCount }. */
    scan: null,
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
        /* The note-detection scan assigns each received note its REAL on-chain
           leaf position; a locally-created note (pre-scan self-transfer) falls
           back to appending at the current leaf count (the bootstrap
           behavior). */
        const leafIndex = note.leafIndex ?? state.leaves.length

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
     * Note-detection scan (blocker #2): pull the pool's full action chain
     * from the network (covenant-address history -> decoded actions ->
     * carrier packets), trial-decrypt with this wallet's pool spend key,
     * record any received notes, and mark any on-chain-spent notes.
     *
     * Full rescan by design (chipnet-scale action counts); idempotent —
     * received notes are deduped by commitment, spend marks by nullifier.
     * Requires the wallet seed (no seed -> no-op, like unlockPool).
     */
    async scanPool({ commit, state, dispatch, rootGetters }) {
        const entropyHex = rootGetters['profile/getMasterSeed']

        if (!entropyHex) {
            return null
        }

        /* Set the (active) network's default pool. */
        const network = rootGetters['profile/getNetwork']

        const pool = getDefaultPool(network)

        if (!pool) {
            return null
        }

        /* Initialize the Fulcrum cluster + the wallet's pool spend key. */
        const cluster = await getCluster(network)

        const spendKey = deriveSpendKey(hexToBytes(entropyHex))

        /* Scan + detect (throws on any chain/validation break). */
        const result = await scanPool({
            cluster,
            pool,
            networkId: network,
            spendKey,
            notes: state.notes,
        })

        /* Record received notes (dedupe by commitment — a rescan must not
           double-record). */
        let received = 0

        for (const note of result.received) {
            if (state.notes.some((n) => n.cm === note.cm)) {
                continue
            }

            await dispatch('recordNote', note)

            received += 1
        }

        /* Mark on-chain-spent notes (spendNote is idempotent). */
        let spent = 0

        for (const nf of result.spent) {
            const note = state.notes.find((n) => n.nf === nf && !n.spent)

            if (note) {
                await dispatch('spendNote', { nf })

                spent += 1
            }
        }

        /* Checkpoint (public data). */
        commit('SET_SCAN', {
            height: result.tipHeight,
            txid: result.tipTxid,
            actionCount: result.actions.length,
        })

        return { received, spent, actions: result.actions.length }
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

    /*
     * Destroy ALL pool state (runtime notes, public leaves, the persisted
     * ciphertext AND the derived seal key) — dispatched when the wallet
     * itself is destroyed (Settings → Destroy), so a newly-created wallet
     * starts with a clean pool instead of inheriting stale (undecryptable)
     * leaves/ciphertext from the destroyed one.
     */
    resetPool({ commit }) {
        /* Drop the (derived) seal key. */
        _sealKey = null

        commit('RESET_POOL')
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

    RESET_POOL(state) {
        /* Reset (runtime) notes. */
        state.notes = []

        /* Reset (public) leaves. */
        state.leaves = []

        /* Reset (persisted) ciphertext. */
        state.sealed = null

        /* Reset (public) scan checkpoint. */
        state.scan = null
    },

    SET_SCAN(state, { height, txid, actionCount }) {
        state.scan = { height, txid, actionCount }
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
