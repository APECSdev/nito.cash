// apps/web/src/lib/bch/external-wallet.js
//
// Helpers for paying FROM an externally-connected WizardConnect wallet.
//
// Flow (hdwalletv1 protocol — see @wizardconnect/dapp DappConnectionManager):
//   1. The wallet shares xpub chains on connect (child 0 = Receive, 1 = Change;
//      child 7 = Cauldron per BCH convention).
//   2. The DAPP derives the wallet's address, fetches its UTXOs over the
//      quorum Fulcrum cluster, builds the FULL unsigned transaction, and
//      submits a SignTransactionRequest with `inputPaths` so the wallet knows
//      which keys sign each input.
//   3. The wallet returns the signed transaction; with `broadcast: true` the
//      WALLET performs the broadcast itself and answers with the txid.
//
// Sighash caveat (discovered during the PUSD pool work — CHIPNET.md): a
// token-bearing source output requires its token prefix covered by the
// sighash; this is why `sourceOutputs` must carry the FULL source
// `Input & Output` (WcSourceOutput), not just outpoints.

import {
    binToHex,
    cashAddressToLockingBytecode,
    decodeCashAddress,
    decodeTransaction,
    deriveHdPublicNode,
    encodeCashAddress,
    hexToBin,
    ripemd160,
    sha256,
} from '@bitauth/libauth'
/* NOTE: keep ALL libauth usage on this STATIC import. A dynamic
   `import('@bitauth/libauth')` inside a function makes the bundler emit a
   side chunk that re-exports libauth AND imports the app entry chunk back —
   a circular chunk init that throws `Cannot access 'o' before
   initialization` (minified TDZ) in the production build, killing the
   WizardConnect pay flow at parseRecipientAddress. */

/* hash160 = ripemd160(sha256(x)) — the P2PKH pubkey hash. */
export function hash160(bytes) {
    return ripemd160.hash(sha256.hash(bytes))
}

/* P2PKH locking bytecode: OP_DUP OP_HASH160 <20B hash> OP_EQUALVERIFY OP_CHECKSIG.
   Built manually (deterministic) instead of via a libauth helper so the
   shape is pinned regardless of libauth helper churn. */
export function p2pkhLockingBytecode(pubkeyHash) {
    const lock = new Uint8Array(25)
    lock[0] = 0x76 // OP_DUP
    lock[1] = 0xa9 // OP_HASH160
    lock[2] = 0x14 // push 20 bytes
    lock.set(pubkeyHash, 3)
    lock[23] = 0x88 // OP_EQUALVERIFY
    lock[24] = 0xac // OP_CHECKSIG
    return lock
}

/* encodeCashAddress across libauth signature variants (positional / object). */
export function encodeCashAddr(prefix, type, hash) {
    try {
        return encodeCashAddress(prefix, type, hash)
    } catch (err) {
        return encodeCashAddress({ prefix, type, payload: hash })
    }
}

/* Derive the address of a wallet chain node (child 0 = receive, 1 = change)
   at `index`. Returns { publicKey, pubkeyHash, lockingBytecode, address }. */
export function deriveChainAddress(chainNode, index, prefix) {
    const child = deriveHdPublicNode(chainNode, { index: BigInt(index) })
    const pubkeyHash = hash160(child.publicKey)
    return {
        publicKey: child.publicKey,
        pubkeyHash,
        lockingBytecode: p2pkhLockingBytecode(pubkeyHash),
        address: encodeCashAddr(prefix, 'p2pkh', pubkeyHash),
    }
}

/* Pick plain-BCH UTXOs (largest first) until `targetSats` is covered.
   Token-bearing UTXOs are skipped (their token prefix must be covered by the
   sighash — keep the judge payment path simple and token-free). */
export function selectCoins(utxos, targetSats) {
    const plain = utxos.filter((u) => !u.token && BigInt(u.value) > 0n)
    const sorted = [...plain].sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0))
    const chosen = []
    let sum = 0n
    for (const u of sorted) {
        if (sum >= targetSats) break
        chosen.push(u)
        sum += BigInt(u.value)
    }
    return { chosen, sum }
}

/* Fetch the FULL source outputs (WcSourceOutput: Input & Output) for the
   chosen UTXOs by pulling each funding transaction and decoding it.
   outpointTransactionHash is passed in display (BE) byte order — libauth
   reverses internally during encode (CHIPNET.md gotcha #3). */
export async function fetchSourceOutputs(cluster, utxos) {
    const sourceOutputs = []

    for (const u of utxos) {
        const res = await cluster.request('blockchain.transaction.get', u.tx_hash, false)
        const raw = typeof res === 'string' ? res : res.hex
        const decoded = decodeTransaction(hexToBin(raw))
        if (typeof decoded === 'string') {
            throw new Error(`Failed to decode funding tx ${u.tx_hash}: ${decoded}`)
        }

        const source = decoded.outputs[u.tx_pos]
        if (!source) {
            throw new Error(`Funding tx ${u.tx_hash} has no output ${u.tx_pos}`)
        }

        sourceOutputs.push({
            outpointTransactionHash: hexToBin(u.tx_hash),
            outpointIndex: u.tx_pos,
            unlockingBytecode: new Uint8Array(0),
            /* libauth 3.x Output shape — valueSatoshis, NOT value (a `value`
               field decodes as undefined and explodes later in BigInt()). */
            valueSatoshis: source.valueSatoshis,
            lockingBytecode: source.lockingBytecode,
        })
    }

    return sourceOutputs
}

/* Fee in satoshis: Fulcrum `estimatefee` (BCH/kB) × rough size model
   (p2pkh input ≈ 148 B, p2pkh output ≈ 34 B, overhead ≈ 10 B), floored at
   200 sats. Falls back to 1,000 sat/kB when estimation is unavailable. */
export async function fetchFeeSats(cluster, numInputs, numOutputs) {
    let rateSatPerKb = 1000n

    try {
        const fee = await cluster.request('blockchain.estimatefee')
        const parsed = BigInt(Math.ceil(Number(fee) * 1e8))
        if (parsed > 0n) {
            rateSatPerKb = parsed
        }
    } catch (err) {
        /* keep the fallback rate */
    }

    const size = numInputs * 148 + numOutputs * 34 + 10
    return (rateSatPerKb * BigInt(size)) / 1000n + 200n
}

/* Parse a user-entered BCH amount (e.g. "0.00005") into exact sats —
   no floats: integer string arithmetic, up to 8 decimal places. */
export function parseBchToSats(input) {
    const cleaned = String(input).trim()
    if (!/^(\d+(\.\d{0,8})?|\.\d{1,8})$/.test(cleaned)) {
        throw new Error(`Invalid BCH amount: ${input}`)
    }

    const [whole = '0', frac = ''] = cleaned.split('.')
    return BigInt(whole) * 100_000_000n + BigInt((frac + '00000000').slice(0, 8) || '0')
}

/* Validate a recipient CashAddress and return its locking bytecode.
   Accepts p2pkh and token-aware p2pkh (payments to either type are fine). */
export async function parseRecipientAddress(address, prefix = 'bitcoincash') {
    const decoded = decodeCashAddress(address)
    if (typeof decoded === 'string') {
        throw new Error(`Invalid recipient address: ${decoded}`)
    }
    if (decoded.prefix !== prefix) {
        throw new Error(`Recipient must be a ${prefix} address (got "${decoded.prefix}").`)
    }
    if (decoded.type !== 'p2pkh' && decoded.type !== 'p2pkhWithTokens') {
        throw new Error(`Unsupported recipient type: ${decoded.type}`)
    }

    const lock = cashAddressToLockingBytecode(address)
    if (typeof lock === 'string') {
        throw new Error(`Invalid recipient address: ${lock}`)
    }

    return { lockingBytecode: lock.bytecode, type: decoded.type }
}

/* txid of a SIGNED transaction hex (double SHA-256, byte-reversed) — used
   when a wallet answers the sign request without signedTransactionHash. */
export function signedTxidFromHex(hex) {
    const bytes = hexToBin(hex)
    const digest = sha256.hash(sha256.hash(bytes))
    return binToHex(digest.reverse())
}

/* Build the unsigned BCH payment transaction (libauth Transaction shape).
   Returns { transaction, change } — the caller wraps it into a
   WcSignTransactionRequest together with the sourceOutputs. */
export function buildPaymentTransaction({ sourceOutputs, recipientLockingBytecode, changeLockingBytecode, amountSats, feeSats }) {
    const total = sourceOutputs.reduce((sum, o) => sum + BigInt(o.valueSatoshis), 0n)
    const change = total - BigInt(amountSats) - BigInt(feeSats)

    if (change < 0n) {
        throw new Error('Insufficient BCH in the connected wallet for this amount + fee.')
    }

    const inputs = sourceOutputs.map((o) => ({
        outpointTransactionHash: o.outpointTransactionHash,
        outpointIndex: o.outpointIndex,
        unlockingBytecode: new Uint8Array(0),
    }))

    /* libauth 3.x Output shape: valueSatoshis (the wallet decodes the
       request's transaction with the same family). */
    const outputs = [{ valueSatoshis: BigInt(amountSats), lockingBytecode: recipientLockingBytecode }]
    if (change > 0n) {
        outputs.push({ valueSatoshis: change, lockingBytecode: changeLockingBytecode })
    }

    return {
        transaction: { version: 2, inputs, outputs, locktime: 0 },
        change,
    }
}
