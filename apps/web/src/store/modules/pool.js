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
import { getDefaultPool, getProverPool, getPools } from '@/lib/pool/registry.js'
import { deriveSpendKey, noteCommitment, nullifier } from '@/lib/pool/notes.js'

/* Import the end-to-end action orchestrator (blocker #4 wiring — see
   lib/pool/actions.js). */
import { assembleLeaves, parseDeliveryPoint, selectInNotes, submitPoolAction } from '@/lib/pool/actions.js'
import { ownerPubFromDeliveryPoint } from '@/lib/pool/carrier.js'

/* The role-2 (3-input tagged pool) pipeline: the orchestrator, the real prover
   chain, the witness generator, the carrier, and the blank selection. */
import { submitRole2Action as submitRole2ActionLib } from '@/lib/pool/role2-actions.js'
import { PROVING_WASM_URL, PROVING_ZKEY_URL, PROVING_WASM_3OUT_URL, PROVING_ZKEY_3OUT_URL, buildPoolWitness, buildPoolWitness3out, generateProof } from '@/lib/pool/prover.js'
/* verifier-role2 is the node-side witness generator (it reads its fixtures
   with node:fs); the store imports it lazily inside prove(). */
import { encodeRole2Carrier } from '@/lib/pool/role2-carrier.js'
import { selectBlanks } from '@/lib/pool/blanks.js'

/* Import byte helpers + the Fulcrum provider (quorum-verified chain data). */
import { derivePath, hexToBytes, toPrivateKeyBytes, toPublicKeyBytes } from '@/lib/bch/crypto.js'
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
     *   (PUSD base units), recipientDeliveryPoint?: hex (transfer only) }.
     * Requires the role-2 pool to be walletProverCompatible (the registry
     * flag flips only after the web-platform acceptance).
     */
    /* v8 ignore start — the proving half is exercised end-to-end by the
       web-platform chipnet acceptance (scripts/pool-accept.mjs pins the
       witness byte-exactly); the store gates are unit-tested above. */
    async submitRole2Action({ dispatch, state, rootGetters }, { action, amount, recipientDeliveryPoint, onStage, poolId = 'chipnet-pusd-role2' }) {
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

        const scanned = await dispatch('scanPool')

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

        /* The PUBLIC value: the deposit for SHIELD and the payout for
           UNSHIELD (sign=1); a TRANSFER's public value is 0. */
        const shield = action === 'shield' || action === 'unshield' ? BigInt(amount) : 0n
        const transferAmount = action === 'transfer' ? BigInt(amount) : 0n
        const sign = action === 'unshield' ? 1n : 0n
        const outs = pool.outputs === 3 || pool.carrierBytes === 201 ? 3 : 2

        /* The state UTXO is the tip action's out1 (the new state NFT). */
        const tip = scanned.scan.actions[scanned.scan.actions.length - 1]
        const stateUtxo = tip
            ? poolUtxos.find((u) => u.txid === tip.txid && u.vout === 1)
            : null

        if (!stateUtxo || !stateUtxo.token?.nft?.commitment) {
            const error = new Error('The role-2 state UTXO was not found at the pool address.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        /* A plain BCH UTXO funds the lock: 2 x 15,000 fuel sats + the lock fee
           (the blanks and the supply add their own sats to the lock's inputs). */
        const byAddress = new Map()

        for (const utxo of walletUtxos) {
            if (!byAddress.has(utxo.address)) byAddress.set(utxo.address, [])

            byAddress.get(utxo.address).push(utxo)
        }

        let lockSet = null

        for (const [address, utxos] of byAddress) {
            const blanks = selectBlanks(utxos, pool.assetCategory)

            /* Accumulate the plain UTXOs (largest first) until the fuel +
               fee fit — the lock signs every input with the same key. */
            const funding = []
            let fundTotal = 0n

            for (const u of utxos.filter((c) => !c.token).sort((a, b) => (a.sats < b.sats ? 1 : -1))) {
                funding.push(u)
                fundTotal += u.sats
                if (fundTotal >= 32000n) break
            }

            /* Only a SHIELD deposits FT through the lock; an UNSHIELD's
               payout comes from the STATE (a deposit would double the FT and
               break the program's conservation check). */
            const supply = action === 'shield' && shield > 0n
                ? utxos.find((u) => u.token && u.token.category === pool.assetCategory && !u.token.nft && u.token.amount >= shield)
                : null

            if (!blanks) continue

            if (funding.length === 0 || fundTotal < 30000n) continue

            if (action === 'shield' && shield > 0n && !supply) continue

            lockSet = { address, account: funding[0].account, blanks, funding, supply }
            break
        }

        if (!lockSet) {
            const error = new Error(shield > 0n
                ? 'The lock needs ONE wallet address holding 2 blanks + 30,000 sats of plain BCH + a ' + pool.assetCategory.slice(0, 8) + '… FT UTXO covering the deposit.'
                : 'The lock needs ONE wallet address holding 2 blanks + 30,000 sats of plain BCH.')

            dispatch('displayError', error, { root: true })

            throw error
        }

        const { blanks, funding, supply } = lockSet

        /* The lock signs with the selected address's HD key — the pool spend
           key is NOT a BCH key and must never sign P2PKH inputs. */
        const lockPath = lockSet.account.branch === 1
            ? `${accountBase}/1/${lockSet.account.index}`
            : `${derivationPath}/${lockSet.account.index}`
        const lockNode = derivePath(hdNode, lockPath)
        const lockKey = { privateKey: toPrivateKeyBytes(lockNode), publicKey: toPublicKeyBytes(lockNode) }

        const prove = async () => {
            /* The FULL witness tree: the registry genesis leaves followed by
               every action's cm0/cm1 at the scan-assigned global indices. */
            const leaves = assembleLeaves(scanned.scan, pool)

            /* EXACTLY two in-notes: the wallet's own (largest first), filled
               with the pool's published bootstrap notes for a first deposit. */
            const { picked: inNotes } = selectInNotes({
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

            const inSum = inNotes.reduce((sum, n) => sum + n.note.value, 0n)
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

        let result
        try {
            result = await submitRole2ActionLib({
                pool,
                state: stateUtxo,
                blanks,
                funding,
                supply,
                /* The lock's DEPOSIT (a shield only) — the public value rides
                   the proof/carrier separately. */
                shield: action === 'shield' ? shield : 0n,
                changeAddress: lockSet.address,
                privateKey: lockKey.privateKey,
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
            })
        } catch (error) {
            dispatch('displayError', error, { root: true })
            throw error
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
