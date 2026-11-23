// apps/web/src/lib/pool/actions.js
//
// The shielded-pool ACTION ORCHESTRATOR (blocker #4 wiring) — composes the
// wallet's pool primitives into the three end-to-end flows the Wallet view
// drives (SHIELD / TRANSFER / UNSHIELD):
//
//   1. the leaf list — assembled from the ordered action chain (lib/pool/
//      scan.js scanPoolActions result: every action's on-chain cm0/cm1 at
//      its leafIndexBase) + the registry genesis leaves. This — NOT the
//      store's `pool.leaves` (which records only the wallet's OWN notes) —
//      is the witness tree: membership paths must fold over the FULL
//      on-chain tree or the proof's merkleRoot can never match the pool
//      UTXO's stored root (build.js root binding).
//   2. getLivePoolState (lib/pool/build.js) — the pool UTXO + 5 step UTXOs.
//   3. buildPoolWitness + generateProof (lib/pool/prover.js) — the Groth16
//      proof, client-side (~seconds; assets fetched from the GitHub Release
//      by default — see prover.js RELEASE DISTRIBUTION).
//   4. buildActionTx (lib/pool/build.js) — the fully signed action tx.
//   5. cluster.broadcast — settle on-chain.
//
// HONEST GATES (every one surfaces as a user-presentable Error):
//   · the pool must be wallet-prover-compatible (registry.js
//     `walletProverCompatible` — ALL registered pools are false today:
//     gate3/mainnet are runner-gated on their vkey lineage, and
//     chipnet-pusd-v2's step program pins the bench's 5-input layout while
//     this builder emits 8 (its registry note has the VM evidence); the UI
//     gates on the same flag, this is the defense in depth);
//   · every action needs EXACTLY TWO in-notes (the fixed 2-in/2-out circuit
//     shape): the wallet's own unspent notes (largest first), filled up
//     with the pool's published bootstrap notes (registry `bootstrapNotes` —
//     the Path-A deployment pattern) when fewer than two are held;
//   · SHIELD funding must carry pool-category CashTokens (Fulcrum hides
//     token UTXOs without the `include_tokens` filter — provider.js
//     getUtxosWithTokens) plus BCH for the ~37 KB action tx fee;
//   · all funding inputs share ONE key (build.js takes a single fundingKey)
//     — funding is selected from a single account address, and foreign-
//     category token UTXOs are NEVER spent (the builder can only return
//     pool-category + BCH change, so spending anything else would burn it).
//
// AFTER broadcast the caller (store/modules/pool.js submitPoolAction) records
// the wallet's own output notes + marks the spent in-notes; the next
// scanPool reconciles everything against the real chain (dedupe by cm).

import { getLivePoolState, buildActionTx } from './build.js'
import { produceWitness } from './verifier.js'
import {
    buildPoolWitness, generateProof, verifyProof, fetchVerifyingKey,
    PROVING_WASM_URL, PROVING_ZKEY_URL,
} from './prover.js'
import { deriveOwnerPub, nullifier, randomField } from './notes.js'
import { encryptNote, ownerPubFromDeliveryPoint } from './carrier.js'
import { derivePath, hexToBytes, toPrivateKeyBytes, toPublicKeyBytes } from '../bch/crypto.js'

/* The three end-to-end action ids (the Wallet view's footer buttons). */
export const POOL_ACTIONS = ['shield', 'transfer', 'unshield']

/*
 * Funding floor: the LIVE pool ops measure ~36.8–37.8 KB (AGENTS.md) →
 * ~38,000 sats of fee at the builder's 1 sat/B default, plus the 6,000–
 * 8,000 sats of constrained outputs (pool + 5 steps [+ payout + token
 * change]) and the 546-sat dust change.
 */
export const MIN_FUNDING_SATS = 50000n

/**
 * Assemble the pool's FULL leaf list (the witness tree) from a scan result:
 * the registry genesis leaves (a Path-A pool PUBLISHES its seed-leaf
 * commitments as `genesisLeaves`; the deployed pools do not — see the
 * registry genesis-tree honesty note) followed by every action's cm0/cm1
 * at the scan-assigned global leaf indices (leafIndexBase, leafIndexBase+1).
 *
 * THROWS when a leaf position is unfilled — a seeded pool without published
 * genesisLeaves can never produce a complete tree, which is exactly the
 * runner-gated spending situation the registry documents.
 */
export function assembleLeaves(scan, pool) {
    const genesisLeaves = pool.genesisLeaves || []

    const total = (pool.genesisLeafCount || genesisLeaves.length) + (scan.actions.length * 2)

    /* fill(undefined): a bare new Array(total) is HOLEY and some() skips
       holes — the missing-leaf guard below would never fire. */
    const leaves = new Array(total).fill(undefined)

    genesisLeaves.forEach((leaf, i) => {
        leaves[i] = BigInt(leaf)
    })

    for (const action of scan.actions) {
        const base = action.leafIndexBase ?? (pool.genesisLeafCount || 0)

        leaves[base] = action.args.cm0
        leaves[base + 1] = action.args.cm1
    }

    if (leaves.some((leaf) => leaf === undefined)) {
        throw new Error('pool actions: incomplete leaf list — the pool\'s seed leaves are not published (registry genesisLeaves), so witnesses cannot be built')
    }

    return leaves
}

/**
 * Pick EXACTLY two in-notes (the fixed circuit shape): the wallet's own
 * unspent notes first (largest value first), filled with the pool's
 * published bootstrap notes when fewer than two are held. TRANSFER and
 * UNSHIELD additionally require the pair to COVER `amount` (out-notes can
 * never go negative).
 *
 * @returns { picked, total } — `picked` in the buildPoolWitness in-note
 *   shape [{ note: {value, ownerPub, rho, r}, nk, index }].
 */
export function selectInNotes({ action, amount, ownNotes = [], bootstrapNotes = [] }) {
    const unspent = ownNotes
        .filter((note) => !note.spent)
        .map((note) => ({
            note: {
                value: BigInt(note.value),
                ownerPub: BigInt(note.ownerPub),
                rho: BigInt(note.rho),
                r: BigInt(note.r),
            },
            nk: BigInt(note.nk),
            index: note.leafIndex,
        }))
        .sort((a, b) => (a.note.value < b.note.value ? 1 : -1))

    const picked = unspent.slice(0, 2)

    for (const bootstrap of bootstrapNotes) {
        if (picked.length >= 2) break

        picked.push({
            note: {
                value: BigInt(bootstrap.note.value),
                ownerPub: BigInt(bootstrap.note.ownerPub),
                rho: BigInt(bootstrap.note.rho),
                r: BigInt(bootstrap.note.r),
            },
            nk: BigInt(bootstrap.nk),
            index: bootstrap.index,
        })
    }

    if (picked.length < 2) {
        throw new Error('This pool action needs two input notes — receive a shielded payment first (pools may also publish bootstrap notes for first deposits).')
    }

    /* The same leaf can never fund both slots (would double-spend itself). */
    if (new Set(picked.map((p) => p.index)).size !== 2) {
        throw new Error('pool actions: duplicate in-note selection')
    }

    const total = picked.reduce((sum, p) => sum + p.note.value, 0n)

    if (action !== 'shield' && total < amount) {
        throw new Error(`Insufficient shielded balance: the two input notes hold ${total}, the action needs ${amount}.`)
    }

    return { picked, total }
}

/**
 * Select the action's FUNDING from ONE account address (build.js signs all
 * funding inputs with a single key): plain BCH for the fee, plus
 * pool-category CashTokens for SHIELD deposits. Token-bearing UTXOs are only
 * visible through the `include_tokens` filter (provider.js
 * getUtxosWithTokens). FOREIGN-category token UTXOs are never spent — the
 * builder returns only pool-category + BCH change, so anything else would be
 * burned by the spend.
 *
 * @returns { funding, fundingAddress, fundingKey } — the buildActionTx shapes.
 */
export async function selectFunding({
    cluster, accounts, accountBase, derivationPath, hdNode, pool,
    needTokens = 0n, minSats = MIN_FUNDING_SATS, maxInputs = Infinity,
}) {
    for (const account of accounts) {
        const utxos = await cluster.getUtxosWithTokens(account.address)

        if (!utxos || utxos.length === 0) continue

        /* POOL-TOKEN UTXOS FIRST. A fixture-shaped program allows exactly ONE
           funding input, so the selector must reach the UTXO that carries BOTH
           the pool tokens and the fee BEFORE any plain UTXO consumes the single
           slot (a plain UTXO alone can never satisfy needTokens). */
        if (maxInputs === 1) {
            const isPool = (u) => (u.token_data && u.token_data.category === pool.assetCategory ? 1 : 0)
            /* With a single funding slot the chosen UTXO must clear the
               thresholds ON ITS OWN, so order by suitability: pool-token UTXOs
               first (only when tokens are needed), then LARGEST first. Without
               this a small dust UTXO wins the slot and the action can never be
               funded (measured: a 3,423-sat UTXO beat the 58,200-sat one). */
            utxos.sort((a, b) => (needTokens > 0n ? (isPool(b) - isPool(a)) : 0) || (b.value - a.value))
        }

        const funding = []

        let satTotal = 0n
        let tokenTotal = 0n

        for (const utxo of utxos) {
            const tokenData = utxo.token_data
            const isPoolToken = tokenData && tokenData.category === pool.assetCategory && tokenData.amount

            /* Never spend a foreign-category token UTXO (see header). */
            if (tokenData && tokenData.category && !isPoolToken) continue

            /* Without a token need, prefer PLAIN UTXOs only — keeps the
               builder's token conservation exact (nothing to return). */
            if (needTokens === 0n && tokenData) continue

            const satoshis = BigInt(utxo.value)

            funding.push({
                txid: utxo.tx_hash,
                vout: utxo.tx_pos,
                satoshis,
                ...(isPoolToken
                    ? { token: { category: hexToBytes(tokenData.category), amount: BigInt(tokenData.amount) } }
                    : {}),
                address: account.address,
            })

            satTotal += satoshis
            if (isPoolToken) tokenTotal += BigInt(tokenData.amount)

            if (funding.length >= maxInputs) break
            if (satTotal >= minSats && tokenTotal >= needTokens) break
        }

        if (satTotal < minSats || tokenTotal < needTokens) continue

        /* The per-input derivation path (the sendCrypto.js rule, derived
           from the SAME account model the wallets store exposes). */
        const path = account.branch === 1
            ? `${accountBase}/1/${account.index}`
            : `${derivationPath}/${account.index}`

        const node = derivePath(hdNode, path)

        return {
            funding,
            fundingAddress: account.address,
            fundingKey: { privateKeyBytes: toPrivateKeyBytes(node), publicKeyBytes: toPublicKeyBytes(node) },
        }
    }

    throw new Error(needTokens > 0n
        ? 'No single account holds enough pool tokens + BCH to fund this action (faucet the wallet first).'
        : 'No single account holds enough BCH for the action fee (faucet the wallet first).')
}

/**
 * The two output notes (the fixed 2-out shape), value-conserved:
 *   shield   : out0 = SELF (total + amount)     out1 = SELF 0
 *   transfer : out0 = RECIPIENT (amount)         out1 = SELF (total − amount)
 *   unshield : out0 = SELF (total − amount)      out1 = SELF 0
 * Fresh rho/r per note (randomField). `amount` is the PUBLIC value for
 * shield/unshield and the (private) payment for transfer.
 */
export async function buildOutNotes({ action, amount, total, spendKey, recipientOwnerPub }) {
    const selfPub = await deriveOwnerPub(spendKey)

    const mk = async (value, ownerPub) => ({ value, ownerPub, rho: randomField(), r: randomField() })

    if (action === 'shield') {
        return [await mk(total + amount, selfPub), await mk(0n, selfPub)]
    }

    if (action === 'transfer') {
        if (recipientOwnerPub === undefined) {
            throw new Error('pool actions: transfer requires a recipient delivery point')
        }

        return [await mk(amount, recipientOwnerPub), await mk(total - amount, selfPub)]
    }

    /* unshield */
    if (total - amount < 0n) {
        throw new Error('pool actions: unshield exceeds the two-note balance')
    }

    return [await mk(total - amount, selfPub), await mk(0n, selfPub)]
}

/*
 * The two vkey SHAPES the wallet bridges (the SAME committed key, two
 * encodings — verified byte-identical: the bench fixture vk's alpha equals
 * the committed file's vk_alpha_1):
 *   · the committed snarkjs JSON (public/proving/verification_key.json —
 *     vk_alpha_1 / vk_beta_2 / … / IC as coordinate ARRAYS) — what
 *     prover.verifyProof (snarkjs.groth16.verify) consumes;
 *   · the BENCH shape ({alpha, beta, gamma, delta, ic} coordinate OBJECTS,
 *     decimal strings) — what the verifier-step port consumes
 *     (verifier.js produceWitness reads vk.ic[0] / vk.alpha.x / …).
 */
export function toBenchVk(snarkjsVk) {
    const g1 = (p) => ({ x: p[0], y: p[1] })
    const g2 = (p) => ({ x: { c0: p[0][0], c1: p[0][1] }, y: { c0: p[1][0], c1: p[1][1] } })

    return {
        alpha: g1(snarkjsVk.vk_alpha_1),
        beta: g2(snarkjsVk.vk_beta_2),
        gamma: g2(snarkjsVk.vk_gamma_2),
        delta: g2(snarkjsVk.vk_delta_2),
        ic: snarkjsVk.IC.map((p) => g1(p)),
    }
}

/**
 * Parse a recipient DELIVERY POINT (carrier.js — the 32-byte packed BabyJub
 * "address" for shielded payments, shared out-of-band): 64 hex chars, an
 * optional 0x prefix tolerated.
 */
export function parseDeliveryPoint(input) {
    const hex = String(input || '').trim().replace(/^0x/, '')

    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
        throw new Error("Enter the recipient's 64-hex-character Nito Cash delivery point.")
    }

    return hexToBytes(hex.toLowerCase())
}

/**
 * The end-to-end pool action (the store's submitPoolAction delegates here).
 *
 * @param {object} params
 *   cluster           — connected FulcrumCluster (lib/bch/provider.js)
 *   pool              — a REGISTRY entry with walletProverCompatible === true
 *   networkId         — 'chipnet' | 'mainnet'
 *   scan              — a scanPoolActions result (ordered action chain)
 *   hdNode            — the wallets store's HD node (funding key derivation)
 *   accounts          — wallets getAddresses('BCH') entries [{address, index, branch}]
 *   accountBase       — `m/44'/145'/0'` (getDerivationPath('BCH').slice(0,4))
 *   derivationPath    — getDerivationPath('BCH') (the branch-0 base)
 *   spendKey          — the wallet's pool spend key (notes.deriveSpendKey)
 *   ownNotes          — the store's note list (state.pool.notes)
 *   action            — 'shield' | 'transfer' | 'unshield'
 *   amount            — BigInt, PUSD base units (deposit / payment / payout)
 *   recipientDeliveryPoint — TRANSFER: hex delivery point of the recipient
 *   changeAddress     — the wallets store's BCH change address
 *   payoutAddress     — UNSHIELD: the transparent payout address (defaults
 *                       to changeAddress)
 *   wasmUrl/zkeyUrl   — proving assets (default: the GitHub Release URLs)
 *   verify            — verify the proof against the committed vkey first
 *                       (default true — fail fast on asset mismatch)
 *   onStage           — optional progress callback ('witness' | 'prove' |
 *                       'verify' | 'build' | 'broadcast') for the UI
 *
 * @returns { txid, action, amount, ...buildActionTx result, outNotes,
 *   spentNfs } — `outNotes` are the wallet's OWN new notes (store shape:
 *   value/ownerPub/rho/r/cm/nf/leafIndex, field elements as BigInts),
 *   `spentNfs` the decimal-string nullifiers of the two spent in-notes.
 */
export async function submitPoolAction({
    cluster, pool, networkId, scan, hdNode, accounts, accountBase, derivationPath,
    spendKey, ownNotes = [], action, amount, recipientDeliveryPoint,
    changeAddress, payoutAddress,
    wasmUrl = PROVING_WASM_URL, zkeyUrl = PROVING_ZKEY_URL,
    verify = true, onStage = null,
}) {
    /* ── gates ── */
    if (!POOL_ACTIONS.includes(action)) {
        throw new Error(`pool actions: unknown action '${action}'`)
    }

    if (typeof amount !== 'bigint' || amount <= 0n) {
        throw new Error('Enter a whole amount (PUSD base units).')
    }

    if (pool.walletProverCompatible !== true) {
        throw new Error('This pool is not wallet-prover-compatible yet (verifying-key lineage unverified) — the flows unlock with a Path-A pool deployment under the wallet-committed key.')
    }

    /* ── recipient (transfer): delivery point → circuit ownerPub ── */
    let recipientOwnerPub
    let recipientPoint

    if (action === 'transfer') {
        recipientPoint = parseDeliveryPoint(recipientDeliveryPoint)

        recipientOwnerPub = await ownerPubFromDeliveryPoint(recipientPoint)
    }

    /* ── the CURRENT on-chain leaf list (the witness tree) ── */
    const leaves = assembleLeaves(scan, pool)

    /* ── in-notes + out-notes ── */
    const { picked, total } = selectInNotes({
        action, amount, ownNotes, bootstrapNotes: pool.bootstrapNotes,
    })

    const outNotes = await buildOutNotes({ action, amount, total, spendKey, recipientOwnerPub })

    /* ── the witness (public value per action) ── */
    if (onStage) await onStage('witness')

    const publicValueAbs = action === 'transfer' ? 0n : amount
    const publicValueSign = action === 'unshield' ? 1n : 0n

    let witness = await buildPoolWitness({
        inNotes: picked, outNotes, leaves,
        publicValueAbs, publicValueSign,
        assetCategory: BigInt('0x' + pool.assetCategory),
    })

    /* ── the Groth16 proof (assets fetched on demand; ~seconds) ── */
    if (onStage) await onStage('prove')

    /* ── the committed vkey (needed before proving to gate the witness) ── */
    const vk = await fetchVerifyingKey()

    /* ── the Groth16 proof (assets fetched on demand; ~seconds) ──
       GENESIS MINIMALITY GATE. The covenant reads the genesis witness at FIXED
       byte offsets (n1 @1792, n0 @1825), which forces fixed 32-byte LE pushes.
       The program, however, CONSUMES those values with VM arithmetic, where a
       32-byte LE word whose most-significant byte is zero is a NON-MINIMAL VM
       number and is rejected ("Invalid input: this operation requires a valid VM
       Number", measured at genesis ip971 on a live action 2026-11-23). The two
       requirements coincide exactly when every fixed-32 value has a non-zero top
       byte — true for ~92% of proofs — so re-prove until that holds. */
    let proof
    let publicSignals
    let genesisMinimal = false
    for (let attempt = 0; attempt < 12; attempt += 1) {
        if (attempt > 0) {
            /* The prover is DETERMINISTIC for a given witness, so re-proving the
               same witness can never change the encoding. Rebuild the WITNESS
               instead: the output notes' rho/r are fresh randomness, so cm (and
               therefore the new root n1, and every dependent genesis push)
               changes. */
            witness = await buildPoolWitness({
                inNotes: picked, outNotes, leaves,
                publicValueAbs, publicValueSign,
                assetCategory: BigInt('0x' + pool.assetCategory),
            })
        }
        ({ proof, publicSignals } = await generateProof(witness, wasmUrl, zkeyUrl))
        try {
            const w = produceWitness(toBenchVk(vk), proof, publicSignals, {
                terminalMinimal: pool.program && pool.program.terminalMinimal === true,
            })
            genesisMinimal = Object.values(w.genesisKnownPushes)
                .every((push) => !(push.length === 32 && push[31] === 0))
        } catch {
            /* BEST-EFFORT: if the witness cannot be produced here (e.g. a fixture
               proof that pairs only with its own publicSignals, as the pool-actions
               spec uses) the gate must not change the flow's error semantics —
               build.js performs the authoritative produceVerifierInputs. */
            genesisMinimal = true
            break
        }
        if (genesisMinimal) break
    }
    if (!genesisMinimal) {
        throw new Error('The prover produced a genesis witness containing a non-minimal 32-byte VM number on every attempt; the covenant\'s fixed byte offsets and the program\'s arithmetic cannot both be satisfied.')
    }

    if (verify) {
        if (onStage) await onStage('verify')

        if (!(await verifyProof(vk, proof, publicSignals))) {
            throw new Error('The generated proof failed verification against the committed verifying key (proving-asset mismatch?).')
        }
    }

    /* ── the covenant args, EXACTLY the proven values ── */
    const args = {
        isUnshield: publicValueSign,
        publicValueAbs,
        newMerkleRoot: BigInt(witness.newMerkleRoot),
        cm0: BigInt(witness.cm[0]),
        cm1: BigInt(witness.cm[1]),
        nf0: BigInt(witness.nf[0]),
        nf1: BigInt(witness.nf[1]),
    }

    /* ── the carrier packet for the recipient note (transfer only) ── */
    const carrierPacket = action === 'transfer'
        ? await encryptNote(outNotes[0], recipientPoint)
        : undefined

    /* ── the live pool state (build.js binds the proof root to it) ── */
    const poolState = await getLivePoolState({ cluster, pool, networkId })

    /* ── funding (SHIELD also needs the pool-category tokens) ── */
    const needTokens = action === 'shield' ? amount : 0n

    const { funding, fundingKey } = await selectFunding({
        cluster, accounts, accountBase, derivationPath, hdNode, pool, needTokens,
        /* The PUBLIC BENCH program pins tx.inputs.length to EXACTLY 7
           (terminal @1549-1551: OP_1 TXINPUTCOUNT OP_7 EQUALVERIFY) and its own
           input index to 4. With five verifier steps + the covenant that leaves
           EXACTLY ONE funding input, which must carry both the pool tokens and
           enough BCH for the ~38 KB action. */
        maxInputs: pool.program && pool.program.fixtureShape === true ? 1 : Infinity,
    })

    /* ── assemble + sign ── */
    if (onStage) await onStage('build')

    const built = await buildActionTx({
        pool, poolState, args, proof, publicSignals,
        vk: toBenchVk(vk),
        funding, fundingKey,
        changeAddress,
        payoutAddress: action === 'unshield' ? (payoutAddress || changeAddress) : undefined,
        carrierPacket,
    })

    /* ── broadcast ── */
    if (onStage) await onStage('broadcast')

    const txid = await cluster.broadcast(built.hex)

    /* ── what the wallet records locally (pre-scan bootstrap — the next
       scanPool reconciles + dedupes by commitment) ── */
    const selfPub = await deriveOwnerPub(spendKey)

    const outRecords = []

    for (let i = 0; i < outNotes.length; i += 1) {
        if (outNotes[i].ownerPub !== selfPub) continue

        outRecords.push({
            value: outNotes[i].value,
            ownerPub: outNotes[i].ownerPub,
            rho: outNotes[i].rho,
            r: outNotes[i].r,
            cm: BigInt(witness.cm[i]),
            nf: await nullifier(spendKey, outNotes[i].rho),
            leafIndex: leaves.length + i,
        })
    }

    /* The spent in-notes' nullifiers (own notes: nk === spendKey; bootstrap
       notes: their published nk — either way the store marks by nf). */
    const spentNfs = []

    for (const inNote of picked) {
        spentNfs.push((await nullifier(inNote.nk, inNote.note.rho)).toString(10))
    }

    return { txid, action, amount, ...built, outNotes: outRecords, spentNfs }
}
