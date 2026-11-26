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
import { getDefaultPool, getProverPool } from '@/lib/pool/registry.js'
import { deriveSpendKey, noteCommitment, nullifier } from '@/lib/pool/notes.js'

/* Import the end-to-end action orchestrator (blocker #4 wiring — see
   lib/pool/actions.js). */
import { submitPoolAction } from '@/lib/pool/actions.js'

/* The role-2 (3-input tagged pool) pipeline: the orchestrator, the real prover
   chain, the witness generator, the carrier, and the blank selection. */
import { submitRole2Action as submitRole2ActionLib } from '@/lib/pool/role2-actions.js'
import { buildPoolWitness, generateProof } from '@/lib/pool/prover.js'
/* verifier-role2 is the node-side witness generator (it reads its fixtures
   with node:fs); the store imports it lazily inside prove(). */
import { encodeRole2Carrier } from '@/lib/pool/role2-carrier.js'
import { selectBlanks } from '@/lib/pool/blanks.js'

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

        /* `scan` carries the RAW engine result (the ordered action chain) —
           submitPoolAction assembles the witness tree from it. */
        return { received, spent, actions: result.actions.length, scan: result }
    },

    /*
     * Blocker #4 wiring — the end-to-end SHIELD / TRANSFER / UNSHIELD flow.
     * Refreshes the note state (full scan — which also yields the ordered
     * action chain that IS the witness tree), then delegates to
     * lib/pool/actions.js submitPoolAction (in-note/funding selection →
     * witness → Groth16 proof → signed tx → broadcast). On success the
     * wallet's own output notes are recorded + the spent in-notes marked
     * (pre-scan bootstrap; the next scanPool reconciles against the real
     * chain and dedupes by commitment).
     *
     * Params: { action: 'shield'|'transfer'|'unshield', amount: BigInt|number
     *   (PUSD base units), recipientDeliveryPoint?: hex (transfer only) }.
     * Requires a wallet-prover-compatible pool (registry.js getProverPool) —
     * every registered pool is flagged false today (runner-gated vkey
     * lineage; chipnet-pusd-v2's step program pins the bench's 5-input
     * layout while the builder emits 8), so this dispatch THROWS (with a
     * user-visible error) until a generalized-program pool is registered.
     */
    async submitPoolAction({ dispatch, state, rootGetters }, { action, amount, recipientDeliveryPoint, onStage }) {
        const entropyHex = rootGetters['profile/getMasterSeed']

        if (!entropyHex) {
            const error = new Error('Open your wallet first (no seed set).')

            dispatch('displayError', error, { root: true })

            throw error
        }

        const network = rootGetters['profile/getNetwork']

        const pool = getProverPool(network)

        if (!pool) {
            const error = new Error('No wallet-prover-compatible pool is registered on this network yet (awaiting a Path-A deployment under the wallet-committed key).')

            dispatch('displayError', error, { root: true })

            throw error
        }

        /* Refresh notes/leaves + fetch the ordered action chain in one sweep. */
        const scanned = await dispatch('scanPool')

        if (!scanned || !scanned.scan) {
            const error = new Error('The pool scan returned no action chain — try again.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        const cluster = await getCluster(network)

        const spendKey = deriveSpendKey(hexToBytes(entropyHex))

        /* Wallet-side funding material (the wallets store's own views —
           the SAME account model sendCrypto signs with). */
        const hdNode = rootGetters['wallets/getHDNode']
        const accounts = rootGetters['wallets/getAddresses']('BCH') || []
        const derivationPath = rootGetters['wallets/getDerivationPath']('BCH')
        const accountBase = derivationPath.split('/').slice(0, 4).join('/')
        const changeAddress = rootGetters['wallets/getChangeAddress']('BCH')

        let result

        try {
            result = await submitPoolAction({
                cluster, pool, networkId: network,
                scan: scanned.scan,
                hdNode, accounts, accountBase, derivationPath,
                spendKey, ownNotes: state.notes,
                action,
                amount: BigInt(amount),
                recipientDeliveryPoint,
                onStage,
                changeAddress,
                /* UNSHIELD pays the transparent payout to the FIRST account
                   address (the wallet's own receiving address). */
                payoutAddress: (accounts[0] && accounts[0].address) || changeAddress,
            })
        } catch (error) {
            /* Warn user (BEFORE the rethrow, so the caller's rejection
               handler runs — the sendCrypto.js pattern). */
            dispatch('displayError', error, { root: true })

            throw error
        }

        /* Record the wallet's own output notes (leafIndex = the pre-scan
           append position; the next scanPool reconciles + dedupes by cm). */
        for (const note of result.outNotes) {
            await dispatch('recordNote', note)
        }

        /* Mark the spent in-notes (spendNote is idempotent). */
        for (const nf of result.spentNfs) {
            await dispatch('spendNote', { nf })
        }

        dispatch('displayNotification', 'Pool action broadcast!', { root: true })

        return result
    },

    /*
     * Record the role-2 action's off-chain out-notes (the 169-B carrier has no
     * room for the NP01 packet, so the wallet keeps them locally; a later scan
     * reconciles by commitment).
     */
    async recordRole2Notes({ dispatch, state }, { outNotes }) {
        for (const n of outNotes || []) {
            const cm = await noteCommitment(BigInt(n.value), BigInt(n.ownerPub), BigInt(n.rho), BigInt(n.r))
            const nf = await nullifier(BigInt(n.nk), BigInt(n.rho))

            await dispatch('recordNote', {
                value: String(n.value),
                ownerPub: String(n.ownerPub),
                rho: String(n.rho),
                r: String(n.r),
                nk: String(n.nk),
                cm: String(cm),
                nf: String(nf),
                leafIndex: state.leaves.length,
                spent: false,
            })
        }
    },

    /*
     * Role-2 action — the 3-input tagged pool (SHIELD / TRANSFER / UNSHIELD).
     *
     * Refreshes the role-2 scan, then runs the REAL pipeline:
     *   witness (buildPoolWitness) → proof (generateProof) → the 3 unlockings
     *   (produceRole2Inputs, sized against the real pool shape) → the 169-B
     *   carrier → submitRole2Action (the lock + the action, broadcast together).
     *
     * Params: { action: 'shield'|'transfer'|'unshield', amount: BigInt|number
     *   (PUSD base units), recipientDeliveryPoint?: hex (transfer only) }.
     * Requires the role-2 pool to be walletProverCompatible (the registry
     * flag flips only after the web-platform acceptance).
     */
    async submitRole2Action({ dispatch, state, rootGetters }, { action, amount, recipientDeliveryPoint, onStage }) {
        const entropyHex = rootGetters['profile/getMasterSeed']

        if (!entropyHex) {
            const error = new Error('Open your wallet first (no seed set).')

            dispatch('displayError', error, { root: true })

            throw error
        }

        const network = rootGetters['profile/getNetwork']
        const pool = getPools(network).find((p) => p.id === 'chipnet-pusd-role2')

        if (!pool) {
            const error = new Error('The role-2 pool is not registered on this network.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        if (pool.walletProverCompatible !== true) {
            const error = new Error('The role-2 pool is not wallet-prover-compatible yet (awaiting the web-platform acceptance).')

            dispatch('displayError', error, { root: true })

            throw error
        }

        const scanned = await dispatch('scanPool')

        if (!scanned || !scanned.scan) {
            const error = new Error('The pool scan returned no action chain — try again.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        const cluster = await getCluster(network)
        const spendKey = deriveSpendKey(hexToBytes(entropyHex))
        const changeAddress = rootGetters['wallets/getChangeAddress']('BCH')
        const payoutAddress = (rootGetters['wallets/getAddresses']('BCH')?.[0]?.address) || changeAddress

        /* The pool's own UTXOs (the state NFT + the blanks live at the program). */
        const poolUtxos = await cluster.getUtxosWithTokens(scanned.scan.address)
        const blanks = selectBlanks(poolUtxos, pool.assetCategory)

        if (blanks.length < 2) {
            const error = new Error('Two blanks are required — buy them from the vending machine first.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        const shield = action === 'shield' ? BigInt(amount) : 0n
        const sign = action === 'unshield' ? 1n : 0n

        /* The state UTXO is the tip action's out1 (the new state NFT). */
        const tip = scanned.scan.actions[scanned.scan.actions.length - 1]
        const stateUtxo = tip
            ? poolUtxos.find((u) => u.tx_hash === tip.txid && u.tx_pos === 1)
            : null

        if (!stateUtxo || !stateUtxo.token?.nft?.commitment) {
            const error = new Error('The role-2 state UTXO was not found at the pool address.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        /* A plain BCH UTXO funds the lock fee (the fuel sats are fixed). */
        const funding = (await cluster.getUtxosWithTokens(changeAddress))
            .find((u) => !u.token && BigInt(u.value) >= 20000n)

        if (!funding) {
            const error = new Error('No plain BCH UTXO with 20,000 sats is available for the lock fee.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        const prove = async () => {
            const unspent = state.notes.filter((n) => !n.spent)
            const inNotes = unspent.slice(0, 2).map((n) => ({
                note: { value: BigInt(n.value), ownerPub: BigInt(n.ownerPub), rho: BigInt(n.rho), r: BigInt(n.r) },
                nk: BigInt(n.nk),
                index: Number(n.leafIndex),
            }))

            if (inNotes.length !== 2) throw new Error('Two unspent pool notes are required for a role-2 action.')

            const leaves = state.leaves.map((leaf) => BigInt(leaf))

            /* Fresh out-note secrets (the nk · G convention — spendable later). */
            const { buildBabyjub } = await import('circomlibjs')
            const bbj = await buildBabyjub()
            const F = bbj.F
            const modr = (x) => ((x % F.p) + F.p) % F.p
            const pubOf = (nk) => { const p = bbj.mulPointEscalar(bbj.Base8, nk); const x = BigInt(F.toObject(p[0])); if (x >= F.p) throw new Error('out-note ownerPub out of range'); return x }
            const seed = `${stateUtxo.tx_hash}:${action}:${amount}`
            let counter = 0
            const rnd = async () => {
                const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${seed}:${counter++}`))
                return modr(BigInt('0x' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')))
            }

            const inSum = inNotes.reduce((sum, n) => sum + n.note.value, 0n)
            const outSum = inSum + (sign ? -shield : shield)
            if (outSum < 0n) throw new Error('The selected notes do not cover the unshield amount.')

            const out0v = (outSum * 3n) / 5n
            const out1v = outSum - out0v
            const outNotes = []
            for (const value of [out0v, out1v]) {
                const nk = await rnd()
                outNotes.push({ value, ownerPub: pubOf(nk), rho: await rnd(), r: await rnd(), nk })
            }

            const witness = await buildPoolWitness({
                inNotes,
                outNotes: outNotes.map(({ value, ownerPub, rho, r }) => ({ value, ownerPub, rho, r })),
                leaves,
                publicValueAbs: shield,
                publicValueSign: sign,
                assetCategory: BigInt('0x' + pool.assetCategory),
            })

            const { proof, publicSignals } = await generateProof(witness)
            const commitment = stateUtxo.token.nft.commitment
            const oldNull = commitment.slice(32)
            const newRoot = witness.newMerkleRoot
            const nf0 = BigInt(witness.nf[0])
            const nf1 = BigInt(witness.nf[1])
            const cm0 = BigInt(witness.cm[0])
            const cm1 = BigInt(witness.cm[1])
            const carrier = encodeRole2Carrier({ nf0, nf1, cm0, cm1, newRoot: BigInt(newRoot), pv: shield, sign })
            const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
            const newNull = await sha256(new Uint8Array([...oldNull, ...nf0.toString(16).padStart(64, '0').match(/../g).map((h) => parseInt(h, 16)), ...nf1.toString(16).padStart(64, '0').match(/../g).map((h) => parseInt(h, 16))]))
            const scenarioArgs = {
                sc: { nf0, nf1, cm0, cm1, newRoot: BigInt(newRoot), pv: shield, sign },
                n0: BigInt(publicSignals[0]),
                balance: BigInt(stateUtxo.token.amount),
                oldNull,
                categoryDisplay: stateUtxo.token.category,
            }
            const { produceRole2Inputs } = await import('@/lib/pool/verifier-role2.js')
            const unlockings = produceRole2Inputs({ proof, publicSignals, scenarioArgs })
            const newBalance = BigInt(stateUtxo.token.amount) + shield - 2n * sign * shield

            return { carrier, unlockings, newRoot: newRoot, newNull, newBalance, outNotes }
        }

        let result
        try {
            result = await submitRole2ActionLib({
                pool,
                state: stateUtxo,
                blanks,
                funding,
                shield,
                changeAddress,
                privateKey: spendKey,
                prove,
                broadcast: (hex) => cluster.broadcast(hex),
                onStage,
                saveNotes: async (notes) => { await dispatch('recordRole2Notes', notes) },
                payoutAddress,
            })
        } catch (error) {
            dispatch('displayError', error, { root: true })
            throw error
        }

        dispatch('displayNotification', 'Role-2 action broadcast!', { root: true })
        return result
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
