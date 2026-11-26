// src/lib/cashshuffle/protocol.js
//
// CashShuffle-over-Nostr — the protocol core (design: docs/CASHSHUFFLE-NOSTR-DESIGN.md).
//
// This module is transport-free: it owns the round state machine, the
// deterministic coordinator, the phase progression, the blame tally, and the
// abort rules. The Nostr transport (NIP-59 gift wrap + NIP-44 v2) is a separate
// layer that only carries these messages.
//
// Phases (the classic CashShuffle order):
//   REGISTER → POOL → ANNOUNCEMENT → SHUFFLE → SIGNING → BROADCAST → (BLAME)
//
// The coordinator is the LOWEST ephemeral pubkey in the pool (deterministic, so
// every peer computes the same one). The coordinator never holds keys or funds;
// it only relays. A round aborts before broadcast on a failed blame tally.

export const PHASES = Object.freeze([
    'REGISTER',
    'POOL',
    'ANNOUNCEMENT',
    'SHUFFLE',
    'VERIFY',
    'SIGNING',
    'BROADCAST',
])

export const DEFAULT_POOL_SIZE = 5
export const BLAME_THRESHOLD = (poolSize) => Math.max(1, poolSize - 1)

/* Deterministic coordinator: the lexicographically lowest ephemeral pubkey. */
export function coordinatorOf(pubkeys) {
    const keys = (pubkeys || []).map((key) => String(key).toLowerCase())
    if (keys.length === 0) return null
    return keys.slice().sort()[0]
}

/* The phase after a completed one (BROADCAST is terminal; BLAME is a side state). */
export function nextPhase(phase) {
    const index = PHASES.indexOf(phase)
    if (index < 0) throw new Error(`cashshuffle: unknown phase ${phase}`)
    return index === PHASES.length - 1 ? null : PHASES[index + 1]
}

/*
 * createRound — a fresh round.
 * @param {object} opts
 * @param {string} opts.roundId   the out-of-band round id
 * @param {string} opts.relay     the relay URL
 * @param {number} [opts.poolSize] the fixed N (default 5)
 * @param {string} [opts.coordinator] an explicit coordinator (defaults to the
 *                                    lowest key once the pool is full)
 */
export function createRound({ roundId, relay, poolSize = DEFAULT_POOL_SIZE, coordinator = null }) {
    if (!roundId) throw new Error('cashshuffle: roundId is required')
    if (!relay) throw new Error('cashshuffle: relay is required')
    if (!Number.isInteger(poolSize) || poolSize < 2) throw new Error('cashshuffle: poolSize must be >= 2')
    return {
        roundId,
        relay,
        poolSize,
        phase: 'REGISTER',
        coordinator,
        players: [],
        blames: {},
        aborted: false,
        txid: null,
        log: [],
    }
}

/*
 * register — add a player (idempotent by key). The pool advances to POOL once
 * the first player registers; the coordinator is computed when the pool fills.
 */
export function register(round, { key, amount, version = 1 }) {
    if (round.aborted) throw new Error('cashshuffle: round aborted')
    if (!key) throw new Error('cashshuffle: player key is required')
    const normalized = String(key).toLowerCase()
    if (!round.players.some((player) => player.key === normalized)) {
        round.players.push({ key: normalized, amount: BigInt(amount ?? 0), version, number: round.players.length })
        round.log.push({ type: 'register', key: normalized })
    }
    if (round.phase === 'REGISTER') round.phase = 'POOL'
    if (round.players.length === round.poolSize) {
        round.coordinator = round.coordinator || coordinatorOf(round.players.map((player) => player.key))
        round.phase = 'ANNOUNCEMENT'
        round.log.push({ type: 'pool-full', coordinator: round.coordinator })
    }
    return round
}

/* announcement — the coordinator opens the shuffle phase. */
export function announcement(round, { from }) {
    assertCoordinator(round, from)
    requirePhase(round, 'ANNOUNCEMENT')
    round.phase = 'SHUFFLE'
    round.log.push({ type: 'announcement', from: String(from).toLowerCase() })
    return round
}

/* shuffle — a player contributes its onion-wrapped output list. */
export function shuffle(round, { from, onion }) {
    requirePhase(round, 'SHUFFLE')
    if (!onion) throw new Error('cashshuffle: a shuffle packet needs an onion')
    round.log.push({ type: 'shuffle', from: String(from).toLowerCase(), onion })
    return round
}

/*
 * verify — check the assembled transaction BEFORE anyone signs.
 *
 * The classic CashShuffle VERIFY phase: every peer checks the output set it
 * expected, conservation (sumOut <= sumIn), and the fee bound
 * (fee <= estBytes * 5 sat/B). A failure aborts the round; nothing is signed.
 */
export function verify(round, { from, transaction, expectedOutputs = null, ownOutput = null }) {
    requirePhase(round, 'VERIFY')
    if (!transaction || !Array.isArray(transaction.inputs) || !Array.isArray(transaction.outputs)) {
        throw new Error('cashshuffle: a VERIFY packet needs a transaction')
    }
    const sumIn = transaction.inputs.reduce((sum, input) => sum + BigInt(input.value ?? input.satoshis ?? 0), 0n)
    const sumOut = transaction.outputs.reduce((sum, output) => sum + BigInt(output.value ?? output.satoshis ?? 0), 0n)
    if (sumOut > sumIn) throw new Error('cashshuffle: sumOut exceeds sumIn')
    const fee = sumIn - sumOut
    const estBytes = BigInt(transaction.estBytes ?? 0)
    if (estBytes > 0n && fee > estBytes * 5n) throw new Error('cashshuffle: fee exceeds the 5 sat/B bound')
    if (expectedOutputs && transaction.outputs.length !== expectedOutputs) {
        throw new Error(`cashshuffle: expected ${expectedOutputs} outputs, got ${transaction.outputs.length}`)
    }
    /* The peer's own output must be present EXACTLY ONCE at the expected
       amount/address — a malicious coordinator must not be able to omit or
       duplicate it (the classic CashShuffle VERIFY check). */
    if (ownOutput) {
        const matches = transaction.outputs.filter((output) =>
            output.address === ownOutput.address
            && BigInt(output.value ?? output.satoshis ?? 0) === BigInt(ownOutput.value))
        if (matches.length !== 1) throw new Error(`cashshuffle: own output must appear exactly once (found ${matches.length})`)
    }
    /* No duplicate input outpoints or output addresses (the classic checks). */
    const outpoints = transaction.inputs.map((input) => `${input.txid}:${input.vout}`)
    if (new Set(outpoints).size !== outpoints.length) throw new Error('cashshuffle: duplicate input outpoints')
    const addresses = transaction.outputs.map((output) => output.address)
    if (new Set(addresses).size !== addresses.length) throw new Error('cashshuffle: duplicate output addresses')
    round.log.push({ type: 'verify', from: String(from).toLowerCase(), fee: fee.toString() })
    return round
}

/* signing — a player contributes its Schnorr signature. */
export function signing(round, { from, signature }) {
    requirePhase(round, 'SIGNING')
    if (!signature) throw new Error('cashshuffle: a signing packet needs a signature')
    round.log.push({ type: 'signing', from: String(from).toLowerCase(), signature })
    return round
}

/* broadcast — the coordinator publishes the final txid (terminal). */
export function broadcast(round, { from, txid }) {
    assertCoordinator(round, from)
    requirePhase(round, 'BROADCAST')
    if (!txid) throw new Error('cashshuffle: a broadcast needs a txid')
    round.txid = String(txid)
    round.log.push({ type: 'broadcast', txid: round.txid })
    return round
}

/* advance — move to the next phase (used by the coordinator after a tally). */
export function advance(round) {
    const next = nextPhase(round.phase)
    if (next) {
        round.phase = next
        round.log.push({ type: 'phase', phase: next })
    }
    return round
}

/*
 * blame — tally a blame against a player. N-1 matching blames exclude the
 * accused and abort the round (before any broadcast, so no funds move).
 */
export function blame(round, { from, accused, reason }) {
    if (round.aborted) throw new Error('cashshuffle: round aborted')
    if (!accused) throw new Error('cashshuffle: a blame needs an accused key')
    const accusedKey = String(accused).toLowerCase()
    const fromKey = String(from).toLowerCase()
    if (fromKey === accusedKey) throw new Error('cashshuffle: a player cannot blame itself')
    round.blames[accusedKey] = round.blames[accusedKey] || new Set()
    round.blames[accusedKey].add(fromKey)
    round.log.push({ type: 'blame', from: fromKey, accused: accusedKey, reason: reason || null })
    const tally = round.blames[accusedKey].size
    if (tally >= BLAME_THRESHOLD(round.poolSize)) {
        round.aborted = true
        round.phase = 'BLAME'
        round.log.push({ type: 'abort', accused: accusedKey, tally })
    }
    return round
}

/* The full state snapshot a UI can render. */
export function snapshot(round) {
    return {
        roundId: round.roundId,
        relay: round.relay,
        poolSize: round.poolSize,
        phase: round.phase,
        coordinator: round.coordinator,
        players: round.players.map((player) => ({ key: player.key, number: player.number, amount: player.amount.toString() })),
        blames: Object.fromEntries(Object.entries(round.blames).map(([key, set]) => [key, [...set]])),
        aborted: round.aborted,
        txid: round.txid,
        log: round.log.slice(),
    }
}

function requirePhase(round, phase) {
    if (round.aborted) throw new Error('cashshuffle: round aborted')
    if (round.phase !== phase) throw new Error(`cashshuffle: expected ${phase}, got ${round.phase}`)
}

function assertCoordinator(round, from) {
    const key = String(from || '').toLowerCase()
    if (!round.coordinator) throw new Error('cashshuffle: no coordinator yet')
    if (key !== round.coordinator) throw new Error('cashshuffle: only the coordinator can do that')
}
