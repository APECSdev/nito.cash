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
import { getDefaultPool, getProverPool, getPools, getNoteMailbox } from '@/lib/pool/registry.js'
/* B3 — the off-chain note delivery (the Nostr note mailbox). */
import { buildNoteEvent, buildReceiptEvent, dpTag, fetchNotePackets, fetchReceipts, packetTag, publishEvent } from '@/lib/pool/note-mailbox.js'
import { deriveDeliveryPoint, encryptNote } from '@/lib/pool/carrier.js'
import { deriveSpendKey, noteCommitment, nullifier } from '@/lib/pool/notes.js'

/* Import the end-to-end action orchestrator (blocker #4 wiring — see
   lib/pool/actions.js). */
import { assembleLeaves, parseDeliveryPoint, selectInNotes, submitPoolAction } from '@/lib/pool/actions.js'
import { ownerPubFromDeliveryPoint } from '@/lib/pool/carrier.js'

/* The role-2 (3-input tagged pool) pipeline: the orchestrator, the real prover
   chain, the witness generator, the carrier, and the blank selection. */
import { submitRole2Action as submitRole2ActionLib, submitRole2ActionV3 as submitRole2ActionV3Lib, submitRole2ActionV4h as submitRole2ActionV4HLib, matchStandingFuelNotes } from '@/lib/pool/role2-actions.js'
import { PROVING_WASM_URL, PROVING_ZKEY_URL, PROVING_WASM_3OUT_URL, PROVING_ZKEY_3OUT_URL, PROVING_WASM_V3_URL, PROVING_ZKEY_V3_URL, buildPoolWitness, buildPoolWitness3out, buildPoolWitnessV3, generateProof } from '@/lib/pool/prover.js'
import { nullifierWalkData } from '@/lib/pool/smt.js'
/* verifier-role2 is the node-side witness generator (it reads its fixtures
   with node:fs); the store imports it lazily inside prove(). */
import { encodeRole2Carrier } from '@/lib/pool/role2-carrier.js'
import { selectBlanks } from '@/lib/pool/blanks.js'

/* Import byte helpers + the Fulcrum provider (quorum-verified chain data). */
import { bytesToHex, derivePath, hexToBytes, toPrivateKeyBytes, toPublicKeyBytes } from '@/lib/bch/crypto.js'
import { getCluster } from '@/lib/bch/provider.js'

/* Runtime-only seal key — never persisted, never part of store state. */
let _sealKey = null

/* The in-flight scanPool promises, keyed by the scanned pool id (SINGLE-
   FLIGHT — the Wallet view's passive mount-scan must never race the submit
   path's pre-action scan; a scan for the DEFAULT pool must never satisfy a
   submit's SELECTED-pool scan). */
const _scanPromises = new Map()

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

    /* B3 — the TRANSFER outbox: NP01 packets this wallet has SENT that are
       not yet acknowledged. Each: { packetHex, actionTxid, dpTag, eventId,
       eventKeys: { publicKey, privateKey }, receiptSeen, publishedAt }.
       The packet CONTENT is ciphertext to the RECIPIENT's delivery point
       (useless to anyone else); the event keys are throwaway per-note
       identities (kept so a re-publish reuses the SAME event id — relays
       dedupe naturally). Persisted plaintext via the root store. */
    outbox: [],
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
    async scanPool({ commit, state, dispatch, rootGetters }, payload = {}) {
        /* SINGLE-FLIGHT: the Wallet view mounts a passive scan on every visit
           (the B3 receive leg) — two concurrent scans of the SAME pool would
           race the note bookkeeping. Reuse the in-flight promise FOR THE SAME
           POOL ONLY (the default-pool key is `__default__`). */
        const scanKey = payload.poolId || '__default__'

        if (_scanPromises.has(scanKey)) {
            return _scanPromises.get(scanKey)
        }

        const scanPromise = (async () => {
        const entropyHex = rootGetters['profile/getMasterSeed']

        if (!entropyHex) {
            return null
        }

        /* Set the (active) network's pool: the SELECTED one when the caller
           names it (the 3-out / 2-out selector — the scan's state UTXO, action
           chain and leaves all come from THIS pool), else the default. */
        const network = rootGetters['profile/getNetwork']

        const pool = (payload.poolId && getPools(network).find((p) => p.id === payload.poolId)) || getDefaultPool(network)

        if (!pool) {
            return null
        }

        /* B3 — the scan's pool target (the receive leg is pool-scoped: the
           packets + transfer actions live in the SELECTED pool's chain). */
        console.log('scanPool: scanning pool', pool ? pool.id : '(none)') // eslint-disable-line no-console

        /* Initialize the Fulcrum cluster + the wallet's pool spend key. */
        const cluster = await getCluster(network)

        const spendKey = deriveSpendKey(hexToBytes(entropyHex))

        /* B3 — the off-chain note mailbox: fetch the NP01 packets addressed
           to THIS wallet's delivery point (one poll per scan; guarded — a
           relay outage must NEVER break the chain scan). The packets attach
           to their actions inside scanPool and flow through the EXISTING
           trial-decrypt + cm-validation path. */
        let mailboxPackets = []
        const mailbox = getNoteMailbox(network)

        if (mailbox) {
            try {
                const ownDeliveryPoint = await deriveDeliveryPoint(spendKey)

                mailboxPackets = await fetchNotePackets({ mailbox, ownDeliveryPoint })
                /* B3 — the fetched packet count + their action txids (the
                   receive leg's visibility line). */
                console.log('note-mailbox: fetched', mailboxPackets.length, 'packet(s)', mailboxPackets.map((p) => (p.actionTxid || '').slice(0, 10)).join(',')) // eslint-disable-line no-console
            } catch (err) {
                console.error('note-mailbox fetch failed:', err) // eslint-disable-line no-console
            }
        }

        /* Scan + detect (throws on any chain/validation break). */
        const result = await scanPool({
            cluster,
            pool,
            networkId: network,
            spendKey,
            notes: state.notes,
            mailboxPackets,
        })

        /* B3 — the scan's completion marker (separates a slow scan from a
           completed-but-empty one when debugging the receive leg). */
        console.log('scanPool: lib done —', result?.actions?.length ?? '?', 'actions, received', result?.received?.length ?? '?') // eslint-disable-line no-console

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

        /* B3 — acknowledge every delivered mailbox packet (a receipt event
           per packet that decrypts for THIS wallet — the note is recorded or
           already present in either case; the receipt clears the sender's
           outbox). Fire-and-forget + guarded. */
        if (mailbox && mailboxPackets.length > 0) {
            ;(async () => {
                for (const { packet } of mailboxPackets) {
                    try {
                        const { event } = buildReceiptEvent({ mailbox, packet })

                        await publishEvent({ mailbox, event })
                    } catch (err) {
                        console.error('note-mailbox receipt failed:', err) // eslint-disable-line no-console
                    }
                }
            })()
        }

        /* B3 — the outbox sweep: clear acknowledged entries, re-publish the
           rest (the SAME event ids — relays dedupe; the re-publish covers
           relays that evicted or were down at send time). Fire-and-forget. */
        if (mailbox && (state.outbox || []).length > 0) {
            ;(async () => {
                try {
                    const pending = (state.outbox || []).filter((e) => !e.receiptSeen)
                    const seen = await fetchReceipts({ mailbox, packets: pending.map((e) => hexToBytes(e.packetHex)) })
                    const cleared = pending.filter((e) => seen.has(packetTag(hexToBytes(e.packetHex))))

                    /* Re-publish everything still pending (cheap: relays
                       dedupe by event id). */
                    for (const entry of pending) {
                        if (seen.has(packetTag(hexToBytes(entry.packetHex)))) continue

                        try {
                            await publishEvent({ mailbox, event: JSON.parse(entry.event) })
                        } catch (err) {
                            console.error('note-mailbox outbox republish failed:', err) // eslint-disable-line no-console
                        }
                    }

                    if (cleared.length > 0) {
                        commit('SET_OUTBOX', { outbox: (state.outbox || []).filter((e) => !seen.has(packetTag(hexToBytes(e.packetHex)))) })
                    }
                } catch (err) {
                    console.error('note-mailbox outbox sweep failed:', err) // eslint-disable-line no-console
                }
            })()
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
        })().finally(() => {
            /* Release the single-flight slot (a rejection propagates to the
               original caller; later callers start a fresh scan). */
            _scanPromises.delete(scanKey)
        })

        _scanPromises.set(scanKey, scanPromise)

        return scanPromise
    },

    /*
     * B3 — deliver a TRANSFER's recipient note off-chain (the Nostr note
     * mailbox). Called right after the action broadcast: encrypts the
     * RECIPIENT's out-note with the existing NP01 packet machinery and
     * publishes it to the configured relays. The packet enters the outbox
     * FIRST (persisted before any network attempt — a relay outage must
     * never lose the note material; the sweep re-publishes until the
     * recipient's receipt clears it).
     *
     * Params: { result (the submit return: actionTxid + outNotes),
     *   recipientDeliveryPoint (hex), network }.
     */
    async deliverTransferNote({ state, commit, rootGetters }, { result, recipientDeliveryPoint, network }) {
        const mailbox = getNoteMailbox(network)

        if (!mailbox) {
            /* No mailbox configured for this network — nothing we can do
               (the registry gates this by configuration). */
            console.error('note-mailbox: no mailbox configured for', network) // eslint-disable-line no-console
            return null
        }

        /* The RECIPIENT'S out-note: the one whose ownerPub is the delivery
           point's BabyJub public key (every transfer shape puts it at index
           0 — find it properly anyway). */
        const recipientOwnerPub = await ownerPubFromDeliveryPoint(parseDeliveryPoint(recipientDeliveryPoint))

        const outNote = (result.outNotes || []).find((n) => BigInt(n.ownerPub) === recipientOwnerPub)

        if (!outNote) {
            throw new Error('The transfer produced no recipient out-note to deliver.')
        }

        /* The NP01 packet (encrypted to the recipient's delivery point). */
        const packet = await encryptNote({
            value: BigInt(outNote.value),
            ownerPub: recipientOwnerPub,
            rho: BigInt(outNote.rho),
            r: BigInt(outNote.r),
        }, parseDeliveryPoint(recipientDeliveryPoint))

        /* Build + persist FIRST (the outbox owns durability), then publish. */
        const { event, keys } = buildNoteEvent({ mailbox, recipientDeliveryPoint, packet, actionTxid: result.actionTxid })

        commit('SET_OUTBOX', { outbox: [...(state.outbox || []), {
            packetHex: bytesToHex(packet),
            actionTxid: result.actionTxid,
            dpTag: dpTag(parseDeliveryPoint(recipientDeliveryPoint)),
            eventId: event.id,
            event: JSON.stringify(event),
            eventKeys: {
                publicKey: bytesToHex(keys.publicKey),
                privateKey: bytesToHex(keys.privateKey),
            },
            receiptSeen: false,
            publishedAt: Date.now(),
        }] })

        /* Publish (the sweep re-publishes on failure — a rejection here
           must not fail the transfer, which is already on-chain). */
        const { delivered } = await publishEvent({ mailbox, event })

        return { eventId: event.id, delivered }
    },

    /*
     * B3 — re-publish every pending outbox entry NOW (called at boot when
     * the pool unlocks: the recipient may come online before the first
     * scan; the delivery window should not wait for one). Fire-and-forget
     * safe: relays dedupe by event id.
     */
    async republishOutbox({ state, rootGetters }) {
        const network = rootGetters['profile/getNetwork']
        const mailbox = getNoteMailbox(network)

        if (!mailbox) {
            return null
        }

        for (const entry of (state.outbox || [])) {
            if (entry.receiptSeen) continue

            try {
                await publishEvent({ mailbox, event: JSON.parse(entry.event) })
            } catch (err) {
                console.error('note-mailbox republish failed:', err) // eslint-disable-line no-console
            }
        }

        return true
    },

    /*
     * Blocker #4 wiring — the end-to-end SHIELD / TRANSFER / UNSHIELD flow.

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

    /* v8 ignore start — the off-chain note bookkeeping is exercised by the
       web-platform acceptance; the note primitives are covered by pool-notes. */
    /*
     * Record the role-2 action's off-chain out-notes (the 169-B carrier has no
     * room for the NP01 packet, so the wallet keeps them locally; a later scan
     * reconciles by commitment).
     */
    async recordRole2Notes({ dispatch, state }, { outNotes, leafIndexBase = null }) {
        for (const [index, n] of (outNotes || []).entries()) {
            /* A transfer's RECIPIENT note has no `nk` (it is the recipient's
               key) — only the wallet's own notes are recorded locally. */
            if (n.nk === undefined || n.nk === null) continue

            const cm = await noteCommitment(BigInt(n.value), BigInt(n.ownerPub), BigInt(n.rho), BigInt(n.r))
            const nf = await nullifier(BigInt(n.nk), BigInt(n.rho))

            /* The GLOBAL tree index (the genesis leaves + every prior
               action's cm0/cm1). `state.leaves` is only the wallet's own
               list — using it as the index mis-points the Merkle path (the
               transfer's circuit membership check fails, Pool_255:147). */
            const leafIndex = leafIndexBase !== null ? leafIndexBase + index : state.leaves.length

            await dispatch('recordNote', {
                value: String(n.value),
                ownerPub: String(n.ownerPub),
                rho: String(n.rho),
                r: String(n.r),
                nk: String(n.nk),
                cm: String(cm),
                nf: String(nf),
                leafIndex,
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
     *   (PUSD base units), recipientDeliveryPoint?: hex (transfer only),
     *   standingFuel?: [utxo, utxo] (B2 — exactly TWO fuel UTXOs already at
     *   the program: a lock whose action never broadcast; no fresh lock is
     *   built, the deposit tag binds the in-note pair, and the sweep's
     *   shield amount must equal the standing fuel0's FT) }.
     * Requires the role-2 pool to be walletProverCompatible (the registry
     * flag flips only after the web-platform acceptance).
     */
    /* v8 ignore start — the proving half is exercised end-to-end by the
       web-platform chipnet acceptance (scripts/pool-accept.mjs pins the
       witness byte-exactly); the store gates are unit-tested above. */
    async submitRole2Action({ dispatch, state, rootGetters }, { action, amount, recipientDeliveryPoint, onStage, poolId = 'chipnet-pusd-role2', standingFuel = null, standingWalk = null, standingHoldings = null, standingSlot = null }) {
        const entropyHex = rootGetters['profile/getMasterSeed']

        if (!entropyHex) {
            const error = new Error('Open your wallet first (no seed set).')

            dispatch('displayError', error, { root: true })

            throw error
        }

        const network = rootGetters['profile/getNetwork']
        const pool = getPools(network).find((p) => p.id === poolId)

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

        /* Scan THE SELECTED pool — the state UTXO, the action chain and the
           witness tree all come from the scan, so a 3-out submission must
           never scan the (2-out) default pool. */
        console.log('submit: the pre-action scan starting…') // eslint-disable-line no-console
        const scanned = await dispatch('scanPool', { poolId: pool.id })
        console.log('submit: the scan done —', scanned?.scan?.actions?.length ?? '?', 'actions') // eslint-disable-line no-console

        if (!scanned || !scanned.scan) {
            const error = new Error('The pool scan returned no action chain — try again.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        const cluster = await getCluster(network)
        const changeAddress = rootGetters['wallets/getChangeAddress']('BCH')
        const hdNode = rootGetters['wallets/getHDNode']
        const accounts = rootGetters['wallets/getAddresses']('BCH') || []
        const derivationPath = rootGetters['wallets/getDerivationPath']('BCH')
        const accountBase = derivationPath.split('/').slice(0, 4).join('/')
        const payoutAddress = (accounts[0] && accounts[0].address) || changeAddress

        /* Fulcrum UTXOs (tx_hash / tx_pos / value / token_data) normalized to
           the builders' shape (txid / vout / sats / token). */
        const normalize = (utxo) => ({
            txid: utxo.txid || utxo.tx_hash,
            vout: utxo.vout ?? utxo.tx_pos,
            sats: BigInt(utxo.sats ?? utxo.value),
            token: utxo.token || (utxo.token_data ? {
                category: utxo.token_data.category,
                amount: BigInt(utxo.token_data.amount),
                ...(utxo.token_data.nft ? {
                    nft: { capability: utxo.token_data.nft.capability, commitment: utxo.token_data.nft.commitment || '' },
                } : {}),
            } : undefined),
        })

        /* The pool's own UTXOs (the state NFT lives at the program). */
        const poolUtxos = (await cluster.getUtxosWithTokens(scanned.scan.address)).map(normalize)

        /* The blanks are USER-HELD (the lock signs them as P2PKH) — they must
           be selected from the wallet's own UTXOs, never the pool address.
           The lock signs EVERY input with ONE key, so the blanks + funding +
           supply must all sit at the SAME wallet address: group by address
           and pick the first group that can fund the whole lock. */
        const walletUtxos = []

        for (const account of accounts) {
            const utxos = await cluster.getUtxosWithTokens(account.address)

            for (const utxo of utxos || []) {
                walletUtxos.push({ ...normalize(utxo), address: account.address, account })
            }
        }

        /* The PUBLIC value: the deposit for SHIELD/DEPOSIT and the payout for
           UNSHIELD (sign=1); a TRANSFER's public value is 0. The v3 DEPOSIT is
           the onboarding: phantom in-notes (no imported notes, no bootstrap
           seeds — the empty genesis tree), the FT rides fuel0 exactly like a
           shield (sign=0). */
        const isV3 = pool.variant === 'v3' || pool.txInputCount === 5
        /* v4h (the C architecture — the MAINNET Preview v0 pool): the 7-input
           shape; the categories SPLIT (the pool's own category for the
           state/blanks; the HELD asset — real PUSD — for the deposit/holdings
           line). */
        const isV4H = pool.variant === 'v4h' || pool.txInputCount === 7
        const shield = action === 'shield' || action === 'unshield' || action === 'deposit' ? BigInt(amount) : 0n
        const transferAmount = action === 'transfer' ? BigInt(amount) : 0n
        const sign = action === 'unshield' ? 1n : 0n
        const outs = pool.outputs === 3 || pool.carrierBytes === 201 ? 3 : 2

        /* The state UTXO is the tip action's out1 (the new state NFT); at
           TRUE genesis (no actions yet) it is the DEPLOY's out1 (the seeded
           state — the very first action spends it). */
        const tip = scanned.scan.actions[scanned.scan.actions.length - 1]
        const stateUtxo = tip
            ? poolUtxos.find((u) => u.txid === tip.txid && u.vout === 1)
            : poolUtxos.find((u) => u.txid === pool.deployTxid && u.vout === 0) || null

        /* v4h — the holdings line (in5): the PRIOR action's out2 (the H-locked
           FT carrying the committed balance — the scan already validated
           out2's amount == the committed balance, so the outpoint is
           CONSTRUCTED from the scan's chain, not re-queried: the H locking is
           a different scripthash from the pool's); the genesis flag (the first
           action ever — its lock funds the tokenless in5 slot). */
        const genesisNow = scanned.scan.actions.length === 0
        let holdings = null
        if (isV4H && tip) {
            holdings = { txid: tip.txid, vout: 2, sats: Number(pool.holdingsSats || 1000) }
        }

        if (!stateUtxo || !stateUtxo.token?.nft?.commitment) {
            const error = new Error('The role-2 state UTXO was not found at the pool address.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        /* B2 — the STANDING-FUEL path: exactly TWO fuel UTXOs already at the
           program (a lock whose action never broadcast). No fresh lock is
           built; the deposit tag the lock wrote on both fuel UTXOs binds the
           in-note pair the recovery MUST reuse (matchStandingFuelNotes). The
           standing fuel0's FT IS the shield deposit; an unshield/transfer
           lock carries none (the payout comes from the state). */
        let standingPair = null

        if (standingFuel) {
            if (!Array.isArray(standingFuel) || standingFuel.length !== 2 || !standingFuel[0] || !standingFuel[1]) {
                const error = new Error('The standing-fuel sweep needs exactly TWO fuel UTXOs at the program.')

                dispatch('displayError', error, { root: true })

                throw error
            }

            const fuelTags = standingFuel.map((u) => String(u.token?.nft?.commitment ?? '').replace(/^0x/, '').toLowerCase())
            const fuel0Ft = BigInt(standingFuel[0].token?.amount ?? 0)
            const fuel1Ft = BigInt(standingFuel[1].token?.amount ?? 0)

            if (!fuelTags[0] || fuelTags[0] !== fuelTags[1]) {
                const error = new Error('The two standing fuel UTXOs must carry the SAME deposit tag.')

                dispatch('displayError', error, { root: true })

                throw error
            }

            if (fuel1Ft !== 0n) {
                const error = new Error('The standing fuel1 must carry no FT (the deposit rides fuel0 only).')

                dispatch('displayError', error, { root: true })

                throw error
            }

            if (action === 'shield') {
                /* The sweep's deposit already rides the fuel — the amount and
                   the fuel0 FT must agree (token conservation on-chain). */
                if (shield !== fuel0Ft) {
                    const error = new Error('The shield amount (' + shield + ') must equal the standing fuel0\u2026s FT (' + fuel0Ft + ') — the deposit already rides the fuel.')

                    dispatch('displayError', error, { root: true })

                    throw error
                }
            } else if (fuel0Ft !== 0n) {
                const error = new Error('A standing-fuel ' + action + ' needs a 0-FT fuel0 (only a shield deposits through the lock).')

                dispatch('displayError', error, { root: true })

                throw error
            }

            standingPair = await matchStandingFuelNotes({ commitment: fuelTags[0], ownNotes: state.notes, bootstrapNotes: pool.bootstrapNotes })

            if (!standingPair) {
                const error = new Error('No in-note pair (own notes or the public bootstrap pair) matches the standing fuel\u2026s deposit tag — the fuel is not recoverable by this wallet.')

                dispatch('displayError', error, { root: true })

                throw error
            }
        }

        /* A plain BCH UTXO funds the lock: 2 x 15,000 fuel sats + the lock fee
           (the blanks and the supply add their own sats to the lock's inputs). */
        const byAddress = new Map()

        for (const utxo of walletUtxos) {
            if (!byAddress.has(utxo.address)) byAddress.set(utxo.address, [])

            byAddress.get(utxo.address).push(utxo)
        }

        let lockSet = null
        let lockKey = null

        /* The standing-fuel path needs NO fresh lock — no blanks, no funding,
           no supply, no P2PKH key. */
        for (const [address, utxos] of (!standingFuel ? byAddress : [])) {
            const blanks = selectBlanks(utxos, pool.assetCategory)

            /* Accumulate the plain UTXOs (largest first) until the fuel +
               fee fit — the lock signs every input with the same key. The v3
               lock needs 2×23,000 fuel + 2×2,000 walk dust + fee. */
            /* The v4h lock also funds the H pair (in6 always + in5 at genesis). */
            const genesisNow = scanned.scan.actions.length === 0
            const fundingNeed = isV3
                ? 2n * BigInt(pool.fuelSats || 23000) + 2n * BigInt(pool.walkSats || 2000) + 600n
                : isV4H
                    ? 2n * BigInt(pool.fuelSats || 23000) + 2n * BigInt(pool.walkSats || 2000) + (genesisNow ? 2n : 1n) * BigInt(pool.holdingsSats || 1000) + 600n
                    : 32000n
            const funding = []
            let fundTotal = 0n

            for (const u of utxos.filter((c) => !c.token).sort((a, b) => (a.sats < b.sats ? 1 : -1))) {
                funding.push(u)
                fundTotal += u.sats
                if (fundTotal >= fundingNeed) break
            }

            /* Only a SHIELD/DEPOSIT moves FT through the lock; an UNSHIELD's
               payout comes from the STATE (a deposit would double the FT and
               break the program's conservation check). */
            /* The deposit SUPPLY: the HELD asset on v4h (the user pre-sends
               their real PUSD to their wallet — the Hush's §3 answer), the
               pool category on the legacy pools. */
            const supplyCategory = isV4H ? (pool.heldCategory ?? pool.assetCategory) : pool.assetCategory
            const supply = (action === 'shield' || ((isV3 || isV4H) && action === 'deposit')) && shield > 0n
                ? utxos.find((u) => u.token && u.token.category === supplyCategory && !u.token.nft && u.token.amount >= shield)
                : null

            if (!blanks) continue

            if (funding.length === 0 || fundTotal < fundingNeed - 2000n) continue

            if ((action === 'shield' || action === 'deposit') && shield > 0n && !supply) continue

            lockSet = { address, account: funding[0].account, blanks, funding, supply }
            break
        }

        if (!lockSet && !standingFuel) {
            const error = new Error(shield > 0n
                ? 'The lock needs ONE wallet address holding 2 blanks + 30,000 sats of plain BCH + a ' + pool.assetCategory.slice(0, 8) + '… FT UTXO covering the deposit.'
                : 'The lock needs ONE wallet address holding 2 blanks + 30,000 sats of plain BCH.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        console.log('submit: the funding', lockSet ? 'FOUND at ' + lockSet.address.slice(0, 20) + '…' : 'NOT FOUND (standing)', '', standingFuel ? 'standing' : '') // eslint-disable-line no-console
        if (lockSet) {
            /* The lock signs with the selected address's HD key — the pool spend
               key is NOT a BCH key and must never sign P2PKH inputs. */
            const lockPath = lockSet.account.branch === 1
                ? `${accountBase}/1/${lockSet.account.index}`
                : `${derivationPath}/${lockSet.account.index}`
            const lockNode = derivePath(hdNode, lockPath)
            lockKey = { privateKey: toPrivateKeyBytes(lockNode), publicKey: toPublicKeyBytes(lockNode) }
        }

        const prove = async () => {
            /* The FULL witness tree: the registry genesis leaves followed by
               every action's cm0/cm1 at the scan-assigned global indices. */
            const leaves = assembleLeaves(scanned.scan, pool)

            /* EXACTLY two in-notes: the STANDING path spends the pair the
               fuel's deposit tag binds (matchStandingFuelNotes above); the
               fresh-lock path spends the wallet's own (largest first), filled
               with the pool's published bootstrap notes for a first deposit. */
            const { picked: inNotes } = standingPair
                ? { picked: standingPair }
                /* A v3 DEPOSIT spends NO in-notes (the phantom path — the
                   empty-genesis onboarding): the selection must be skipped
                   entirely, else it throws before the witness can engage. */
                : (isV3 || isV4H) && action === 'deposit'
                    ? { picked: null }
                    : selectInNotes({
                action,
                amount: BigInt(amount),
                ownNotes: state.notes,
                /* The bootstrap pair funds the GENESIS action only. After any
                   action exists it is spent; reusing it double-spends the
                   seeds and tags the deposit with a PUBLIC nullifier pair
                   (the standing-lock finding, 2026-11-26). */
                bootstrapNotes: scanned.scan.actions.length === 0 ? pool.bootstrapNotes : [],
            })

            /* Fresh out-note secrets (the nk · G convention — spendable later). */
            const { buildBabyjub } = await import('circomlibjs')
            const bbj = await buildBabyjub()
            const F = bbj.F
            const modr = (x) => ((x % F.p) + F.p) % F.p
            const pubOf = (nk) => { const p = bbj.mulPointEscalar(bbj.Base8, nk); const x = BigInt(F.toObject(p[0])); if (x >= F.p) throw new Error('out-note ownerPub out of range'); return x }
            /* CSPRNG note secrets (the old tx-derived seed was public data). */
            const rnd = async () => {
                const bytes = new Uint8Array(32)
                crypto.getRandomValues(bytes)
                return modr(BigInt('0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')))
            }

            /* A v3 deposit carries NO in-notes (the phantom path) — the sum
               is the empty 0n, not a null crash. */
            const inSum = (inNotes || []).reduce((sum, n) => sum + n.note.value, 0n)
            const outSum = inSum + (sign ? -shield : shield)
            if (outSum < 0n) throw new Error('The selected notes do not cover the unshield amount.')

            /* The fixed 2-out shape (value-conserved):
               shield   : out0 = SELF (total + amount)  out1 = SELF 0
               transfer : out0 = RECIPIENT (amount)     out1 = SELF (total - amount)
               unshield : out0 = SELF (total - amount)  out1 = SELF 0 */
            const selfNote = async (value) => {
                const nk = await rnd()
                return { value, ownerPub: pubOf(nk), rho: await rnd(), r: await rnd(), nk }
            }

            let outNotes

            if (outs === 3) {
                if (action === 'transfer') {
                    if (outSum < transferAmount) throw new Error('The selected notes do not cover the transfer amount.')

                    const recipientOwnerPub = await ownerPubFromDeliveryPoint(parseDeliveryPoint(recipientDeliveryPoint))
                    const change = outSum - transferAmount
                    const half = change / 2n

                    outNotes = [
                        { value: transferAmount, ownerPub: recipientOwnerPub, rho: await rnd(), r: await rnd() },
                        await selfNote(change - half),
                        await selfNote(half),
                    ]
                } else {
                    /* The 3-out demo's 40/30/30 split (the note-management shape). */
                    const out0 = outSum * 2n / 5n
                    const out1 = outSum * 3n / 10n

                    outNotes = [await selfNote(out0), await selfNote(out1), await selfNote(outSum - out0 - out1)]
                }
            } else if (action === 'transfer') {
                if (outSum < transferAmount) throw new Error('The selected notes do not cover the transfer amount.')

                const recipientOwnerPub = await ownerPubFromDeliveryPoint(parseDeliveryPoint(recipientDeliveryPoint))

                outNotes = [
                    { value: transferAmount, ownerPub: recipientOwnerPub, rho: await rnd(), r: await rnd() },
                    await selfNote(outSum - transferAmount),
                ]
            } else if (action === 'shield') {
                outNotes = [await selfNote(outSum), await selfNote(0n)]
            } else {
                outNotes = [await selfNote(outSum), await selfNote(0n)]
            }

            /* ── THE V4H (the C architecture) PATH — the holdings pipeline ── */
            if (isV4H) {
                /* The witness binds the HELD asset (the real PUSD — the circuit's
                   category witness; the check-6 lesson). */
                const { input, cm, newMerkleRoot, nf } = await buildPoolWitnessV3({
                    inNotes: action === 'deposit' ? null : inNotes,
                    outNotes: outNotes.map(({ value, ownerPub, rho, r }) => ({ value, ownerPub, rho, r })),
                    leaves,
                    publicValueAbs: shield,
                    publicValueSign: sign,
                    assetCategory: BigInt('0x' + pool.heldCategory),
                    isDeposit: action === 'deposit',
                })

                const { proof, publicSignals } = await generateProof(input, PROVING_WASM_V3_URL, PROVING_ZKEY_V3_URL)

                const carrier = encodeRole2Carrier({
                    nf0: nf[0], nf1: nf[1], cm0: cm[0], cm1: cm[1], cm2: cm[2],
                    newRoot: newMerkleRoot, pv: shield, sign,
                }, 3)

                /* The walk data: the SCAN's spent-key set + this action's keys. */
                const leHexOf = (value) => {
                    const bytes = new Uint8Array(32)
                    let x = BigInt(value)
                    for (let i = 0; i < 32; i += 1) { bytes[i] = Number(x & 0xffn); x >>= 8n }
                    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
                }
                const walk = nullifierWalkData({
                    spentKeys: scanned.scan.spentKeys || [],
                    kA: leHexOf(nf[0]),
                    kB: leHexOf(nf[1]),
                })

                /* The balance: the scan's VALIDATED chain (the state NFT is
                   FT-less in v4h — the authenticated balance is the
                   commitment's third field, which the scan re-derived). */
                const priorActions = scanned.scan.actions || []
                const balance = priorActions.length ? priorActions[priorActions.length - 1].newBalance : 0n
                const newBalance = balance + shield - 2n * sign * shield

                const scenarioArgs = {
                    sc: { nf0: nf[0], nf1: nf[1], cm0: cm[0], cm1: cm[1], cm2: cm[2], newRoot: newMerkleRoot, pv: shield, sign },
                    n0: BigInt(publicSignals[0]),
                    nullSet: walk,
                    balance,
                    categoryDisplay: pool.assetCategory,
                    assetCategoryDisplay: pool.heldCategory,
                }

                const { produceRole2InputsV4h, v4hHUnlocking, v4hHoldingsCovenant } = await import('@/lib/pool/verifier-role2-v4h.js')
                /* The H covenant: rebuilt from the deployed pins + asserted
                   against the registry record (the drift guard). */
                const hc = v4hHoldingsCovenant({
                    progLockingHashHex: pool.program.progLockingHash,
                    walkAHashHex: pool.program.walkPins[0],
                    walkBHashHex: pool.program.walkPins[1],
                })
                if (hc.lockingHex !== pool.program.hLockingHex) throw new Error('pool: the H covenant drifted from the deployed record')
                const hUnlocking = v4hHUnlocking({
                    progLockingHashHex: pool.program.progLockingHash,
                    walkAHashHex: pool.program.walkPins[0],
                    walkBHashHex: pool.program.walkPins[1],
                })

                const { unlockings, walkUnlockings } = produceRole2InputsV4h({
                    proof,
                    publicSignals,
                    categoryOnChain: pool.categoryOnChain,
                    assetCategoryOnChain: pool.assetCategoryOnChain,
                    walkAHash: pool.program.walkPins[0],
                    walkBHash: pool.program.walkPins[1],
                    hScript: hc.script,
                    hLocking: hexToBytes(hc.lockingHex),
                    scenarioArgs,
                })

                /* The 96-B commitment: LE32(newRoot) ‖ finalNullRoot ‖ LE32(newBalance). */
                const rootLE = new Uint8Array(32)
                let rootValue = newMerkleRoot
                for (let i = 0; i < 32; i += 1) { rootLE[i] = Number(rootValue & 0xffn); rootValue >>= 8n }
                const bal32 = new Uint8Array(32)
                let balValue = newBalance
                for (let i = 0; i < 32; i += 1) { bal32[i] = Number(balValue & 0xffn); balValue >>= 8n }

                return {
                    carrier,
                    unlockings,
                    walkUnlockings,
                    hUnlocking,
                    newRoot: rootLE,
                    finalNullRoot: hexToBytes(walk.finalNullRoot),
                    newBalance,
                    outNotes,
                }
            }

            /* ── THE V3 (pool4) PATH — the walk-data pipeline ── */
            if (isV3) {
                const { input, cm, newMerkleRoot, nf } = await buildPoolWitnessV3({
                    /* a DEPOSIT spends NO in-notes (the phantom path — the
                       empty-genesis onboarding); transfer/unshield select the
                       same pair as the 3-out flow. */
                    inNotes: action === 'deposit' ? null : inNotes,
                    outNotes: outNotes.map(({ value, ownerPub, rho, r }) => ({ value, ownerPub, rho, r })),
                    leaves,
                    publicValueAbs: shield,
                    publicValueSign: sign,
                    assetCategory: BigInt('0x' + pool.assetCategory),
                    isDeposit: action === 'deposit',
                })

                const { proof, publicSignals } = await generateProof(input, PROVING_WASM_V3_URL, PROVING_ZKEY_V3_URL)

                const carrier = encodeRole2Carrier({
                    nf0: nf[0], nf1: nf[1], cm0: cm[0], cm1: cm[1], cm2: cm[2],
                    newRoot: newMerkleRoot, pv: shield, sign,
                }, 3)

                /* The walk data: the SCAN's reconstructed spent-key set +
                   THIS action's two keys (the SMT anchors at the live state
                   commitment's second half; a replay THROWS here). */
                const leHexOf = (value) => {
                    const bytes = new Uint8Array(32)
                    let x = BigInt(value)
                    for (let i = 0; i < 32; i += 1) { bytes[i] = Number(x & 0xffn); x >>= 8n }
                    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
                }
                const walk = nullifierWalkData({
                    spentKeys: scanned.scan.spentKeys || [],
                    kA: leHexOf(nf[0]),
                    kB: leHexOf(nf[1]),
                })

                const balance = BigInt(stateUtxo.token.amount)
                const scenarioArgs = {
                    sc: { nf0: nf[0], nf1: nf[1], cm0: cm[0], cm1: cm[1], cm2: cm[2], newRoot: newMerkleRoot, pv: shield, sign },
                    n0: BigInt(publicSignals[0]),
                    nullSet: walk,
                    balance,
                    categoryDisplay: stateUtxo.token.category,
                }

                const { produceRole2InputsV3 } = await import('@/lib/pool/verifier-role2-v3.js')
                /* The walk unlockings come WITH the transaction build (the
                   scripts ride as the redeem pushes — v3.1; the P2SH32 wraps
                   are the on-chain lockings). */
                const { unlockings, walkUnlockings } = produceRole2InputsV3({
                    proof,
                    publicSignals,
                    categoryOnChain: pool.categoryOnChain,
                    walkAHash: pool.program.walkPins[0],
                    walkBHash: pool.program.walkPins[1],
                    scenarioArgs,
                })

                const newBalance = balance + shield - 2n * sign * shield
                const rootLE = new Uint8Array(32)
                let rootValue = newMerkleRoot
                for (let i = 0; i < 32; i += 1) { rootLE[i] = Number(rootValue & 0xffn); rootValue >>= 8n }

                return {
                    carrier,
                    unlockings,
                    walkUnlockings,
                    newRoot: rootLE,
                    finalNullRoot: hexToBytes(walk.finalNullRoot),
                    newBalance,
                    outNotes,
                }
            }

            const witness = outs === 3
                ? await buildPoolWitness3out({
                    inNotes,
                    outNotes: outNotes.map(({ value, ownerPub, rho, r }) => ({ value, ownerPub, rho, r })),
                    leaves,
                    publicValueAbs: shield,
                    publicValueSign: sign,
                    assetCategory: BigInt('0x' + pool.assetCategory),
                })
                : await buildPoolWitness({
                    inNotes,
                    outNotes: outNotes.map(({ value, ownerPub, rho, r }) => ({ value, ownerPub, rho, r })),
                    leaves,
                    publicValueAbs: shield,
                    publicValueSign: sign,
                    assetCategory: BigInt('0x' + pool.assetCategory),
                })

            /* The Worker-mirrored proving assets (the 97 MB zkey cannot ship
               on Pages; the relative defaults are local-dev only). */
            const { proof, publicSignals } = await generateProof(witness, outs === 3 ? PROVING_WASM_3OUT_URL : PROVING_WASM_URL, outs === 3 ? PROVING_ZKEY_3OUT_URL : PROVING_ZKEY_URL)
            const commitment = String(stateUtxo.token.nft.commitment || '')
            const oldNull = hexToBytes(commitment).slice(32)
            const newRoot = BigInt(witness.newMerkleRoot)
            const nf0 = BigInt(witness.nf[0])
            const nf1 = BigInt(witness.nf[1])
            const cm0 = BigInt(witness.cm[0])
            const cm1 = BigInt(witness.cm[1])
            const cm2 = outs === 3 ? BigInt(witness.cm[2]) : undefined
            const carrier = encodeRole2Carrier({ nf0, nf1, cm0, cm1, ...(outs === 3 ? { cm2 } : {}), newRoot: BigInt(newRoot), pv: shield, sign }, outs)
            const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
            /* The new nullifier set: SHA256(oldNull ‖ nf0 ‖ nf1) with nf0/nf1
               in the carrier's LE byte order — the program recomputes it from
               exactly those bytes (the pool-hook's check 7). */
            const newNull = await sha256(new Uint8Array([...oldNull, ...carrier.slice(0, 64)]))
            const scenarioArgs = {
                sc: { nf0, nf1, cm0, cm1, ...(outs === 3 ? { cm2 } : {}), newRoot: BigInt(newRoot), pv: shield, sign },
                n0: BigInt(publicSignals[0]),
                balance: BigInt(stateUtxo.token.amount),
                oldNull,
                categoryDisplay: stateUtxo.token.category,
            }
            const unlockings = outs === 3
                ? (await import('@/lib/pool/verifier-role2-3out.js')).produceRole2Inputs3out({ proof, publicSignals, categoryOnChain: pool.categoryOnChain, scenarioArgs })
                : (await import('@/lib/pool/verifier-role2.js')).produceRole2Inputs({ proof, publicSignals, scenarioArgs })
            const newBalance = BigInt(stateUtxo.token.amount) + shield - 2n * sign * shield

            /* The state NFT commitment carries the 32-byte LE root. */
            const rootLE = new Uint8Array(32)
            let rootValue = newRoot
            for (let i = 0; i < 32; i += 1) { rootLE[i] = Number(rootValue & 0xffn); rootValue >>= 8n }

            return { carrier, unlockings, newRoot: rootLE, newNull, newBalance, outNotes }
        }

        console.log('submit: the payoutAddress', payoutAddress, '— the orchestrator starting…') // eslint-disable-line no-console
        let result
        try {
            const submit = async (lib, extra = {}) => lib({
                pool,
                state: stateUtxo,
                /* The standing-fuel path passes the TWO fuel UTXOs and builds
                   NO fresh lock (no blanks/funding/supply/P2PKH key). */
                ...(standingFuel
                    ? (isV3
                        /* The v3 standing lock: the fuel pair AND the walk pair
                           (the sweep tool supplies both). */
                        ? { standing: { fuel: standingFuel, walk: standingWalk } }
                        : isV4H
                            /* The v4h standing lock: fuel + walks + the H
                               pair (holdings + slot — the sweep tool). */
                            ? { standing: { fuel: standingFuel, walk: standingWalk, holdings: standingHoldings, slot: standingSlot } }
                            : { standingFuel })
                    : {
                    blanks: lockSet.blanks,
                    funding: lockSet.funding,
                    supply: lockSet.supply,
                    /* v4h: the holdings line (the prior action's out2) + the
                       genesis flag (the first action's lock funds in5). */
                    ...(isV4H ? { holdings, isGenesis: genesisNow } : {}),
                }),
                /* The lock's DEPOSIT (a shield/deposit only) — the public
                   value rides the proof/carrier separately. */
                shield: (action === 'shield' || action === 'deposit') ? shield : 0n,
                ...(standingFuel ? {} : {
                    changeAddress: lockSet.address,
                    privateKey: lockKey.privateKey,
                }),
                prove,
                broadcast: (hex) => {
                    /* Acceptance debug: the harness evaluates the captured tx on
                       the BCH-2026 VM when a broadcast is rejected. */
                    if (typeof window !== 'undefined') window.__lastBroadcastHex = hex
                    return cluster.broadcast(hex)
                },
                onStage,
                saveNotes: async (notes) => {
                    await dispatch('recordRole2Notes', {
                        ...notes,
                        leafIndexBase: (pool.genesisLeafCount || (pool.genesisLeaves || []).length) + scanned.scan.actions.length * outs,
                    })
                },
                payoutAddress,
                ...extra,
            })

            result = isV4H
                ? await submit(submitRole2ActionV4HLib)
                : isV3
                    ? await submit(submitRole2ActionV3Lib)
                    : await submit(submitRole2ActionLib)
        } catch (error) {
            dispatch('displayError', error, { root: true })
            throw error
        }

        /* B3 — the off-chain note delivery: a TRANSFER's recipient out-note
           is encrypted (the NP01 packet) + published to the note mailbox.
           GUARDED: the action is ALREADY on-chain — a mailbox failure must
           never fail the submit (the outbox entry is committed BEFORE the
           publish and re-delivers on every scan until receipted). */
        if (action === 'transfer' && recipientDeliveryPoint && result && Array.isArray(result.outNotes) && result.outNotes.length > 0) {
            try {
                const delivery = await dispatch('deliverTransferNote', { result, recipientDeliveryPoint, network: rootGetters['profile/getNetwork'] })

                dispatch('displayNotification', delivery && delivery.delivered
                    ? 'Transfer broadcast — the recipient note is delivered.'
                    : 'Transfer broadcast — the recipient note is queued for delivery.', { root: true })
            } catch (err) {
                console.error('note-mailbox delivery failed:', err) // eslint-disable-line no-console

                dispatch('displayNotification', 'Transfer broadcast — the recipient note will be re-delivered on your next scan.', { root: true })
            }
        }

        dispatch('displayNotification', 'Role-2 action broadcast!', { root: true })
        return result
    },
    /* v8 ignore stop */

    /*
     * Derive the seal key from the wallet entropy and decrypt the persisted
     * ciphertext into the runtime-only `notes` mirror. No-op (returns false)
     * when no seed is set yet; returns whether the store is unlocked.
     */
    async unlockPool({ commit, state, dispatch, rootGetters }) {
        const entropyHex = rootGetters['profile/getMasterSeed']

        if (!entropyHex) {
            return false
        }

        _sealKey = await deriveSealKey(entropyHex)

        if (state.sealed) {
            const notes = await unsealJSON(state.sealed, _sealKey)

            commit('SET_NOTES', { notes })
        }

        /* B3 — re-publish any pending outbox notes at boot (fire-and-forget:
           relays dedupe by event id; unlockPool must not block on them). */
        if ((state.outbox || []).length > 0) {
            dispatch('republishOutbox').catch((err) => {
                console.error('note-mailbox boot republish failed:', err) // eslint-disable-line no-console
            })
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

        /* Reset the (B3) transfer outbox — a destroyed wallet's undelivered
           packets are undeliverable (the recipient's receipt can never clear
           them) and the entries carry delivery metadata. */
        state.outbox = []
    },

    SET_SCAN(state, { height, txid, actionCount }) {
        state.scan = { height, txid, actionCount }
    },

    /* B3 — replace the whole outbox (the scan's receipt sweep + the
       delivery appends both rewrite it wholesale). */
    SET_OUTBOX(state, { outbox }) {
        state.outbox = outbox || []
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
