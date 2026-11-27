// apps/web/scripts/role2-sweep-standing.mjs
//
// The B2 STANDING-FUEL acceptance harness — two modes against the LIVE chipnet
// role-2 pool (default: the 3-out v3, where wallet A holds the blanks, the
// imported notes and the supply FT):
//
//   make-standing — prove an action, build its lock, and broadcast ONLY the
//     lock (the "action never broadcast" failure mode that strands fuel at
//     the program). Writes a standing record JSON: the fuel outpoints, the
//     deposit tag, and the intended in-note leaf indices. The action's proof
//     is discarded on purpose — that is the failure being simulated.
//
//   sweep — the STANDING-FUEL recovery: load the standing fuel (from the
//     make-standing record, or --fuel txid:vout,txid:vout), match the in-note
//     pair the fuel's deposit tag binds (matchStandingFuelNotes), re-prove
//     with fresh out-notes, and run the ORCHESTRATOR's standing-fuel path
//     (lib/pool/role2-actions.js submitRole2Action with standingFuel): ONE
//     action broadcast, NO fresh lock. The broadcast hook VM-gates every
//     input on the BCH-2026 VM (consensus + standard, the pool-op-role2.mjs
//     acceptance) BEFORE anything leaves — nothing goes out unless the
//     program accepts.
//
// Usage (the apecsdev VM — the proving host; plain node, a single Electrum
// server queried read-only except the broadcasts):
//   node scripts/role2-sweep-standing.mjs make-standing [--amount 112] [--dry]
//   node scripts/role2-sweep-standing.mjs sweep [--record <file> | --fuel txid:vout,txid:vout] [--dry]
//
// Options:
//   --pool <id>      the registry pool (default chipnet-pusd-role2-3out)
//   --amount <n>     the FT deposit riding fuel0 (default 112)
//   --key <path>     the wallet key file (default wallet A's .secrets copy)
//   --notes <path>   the wallet's role-2 notes JSON (the recordNote shape)
//   --record <path>  the standing record (written by make-standing, read by sweep)
//   --out <path>     the sweep's out-notes JSON (the recordNote import shape)
//   --fuel <a,b>     the standing fuel as txid:vout,txid:vout (no record)
//   --assets <dir>   local proving assets (pool3_final.zkey + pool3.wasm or
//                    pool3_js/pool3.wasm) — sha256-VERIFIED against the
//                    role2-proving-assets-3out-v1 hashes before proving;
//                    default: the prover.nito.cash/assets/ mirror URLs
//   --dry            build + VM-gate only — nothing is broadcast

import { accessSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { binToHex, cashAddressToLockingBytecode, decodeTransaction, hash256, hexToBin, instantiateSha256 } from '@bitauth/libauth'
import { ElectrumClient } from '@electrum-cash/network'

import { getPools } from '../src/lib/pool/registry.js'
import { scanPoolActions } from '../src/lib/pool/scan.js'
import { assembleLeaves } from '../src/lib/pool/actions.js'
import { noteCommitment, nullifier } from '../src/lib/pool/notes.js'
import { buildPoolWitness3out, generateProof, PROVING_WASM_3OUT_URL, PROVING_ZKEY_3OUT_URL } from '../src/lib/pool/prover.js'
import { encodeRole2Carrier, depositTag } from '../src/lib/pool/role2-carrier.js'
import { produceRole2Inputs3out, ROLE2_3OUT_CATEGORY_ONCHAIN } from '../src/lib/pool/verifier-role2-3out.js'
import { buildRole2Lock } from '../src/lib/pool/role2-lock.js'
import { submitRole2Action, matchStandingFuelNotes } from '../src/lib/pool/role2-actions.js'
import { selectBlanks } from '../src/lib/pool/blanks.js'
import { VMS } from '../src/lib/pool/role2-3out/vm.mjs'

/* ---- args ---- */
const argOf = (name, fallback = null) => {
    const i = process.argv.indexOf(name)
    return i >= 0 ? process.argv[i + 1] : fallback
}

const MODE = process.argv[2]
if (MODE !== 'make-standing' && MODE !== 'sweep') {
    console.error('usage: node scripts/role2-sweep-standing.mjs make-standing|sweep [options] — see the header')
    process.exit(1)
}

const POOL_ID = argOf('--pool', 'chipnet-pusd-role2-3out')
const AMOUNT = BigInt(argOf('--amount', '112'))
const KEY_PATH = argOf('--key', '/Workspace/apecsdev/.secrets/wallet-a-role2-demo.json')
const NOTES_PATH = argOf('--notes', '/tmp/r2-pool3-notes.json')
const RECORD_PATH = argOf('--record', '/tmp/r2-standing-record.json')
const OUT_PATH = argOf('--out', '/tmp/r2-sweep-out-notes.json')
const FUEL_ARG = argOf('--fuel')
const ASSETS_DIR = argOf('--assets')
const DRY = process.argv.includes('--dry')

const pool = getPools('chipnet').find((p) => p.id === POOL_ID)
if (!pool) throw new Error(`unknown pool '${POOL_ID}'`)
if (pool.outputs !== 3 && pool.carrierBytes !== 201) throw new Error('this harness drives the 3-out v3 pool shape')

/* The known proving-asset hashes (the role2-proving-assets-3out-v1 release,
   mirrored at prover.nito.cash/assets/) — the B4 pin applied to any LOCAL
   asset dir, so a stale or wrong zkey can never prove. */
const POOL3_WASM_SHA256 = 'c806e561d9466ec25f437d6dfe659ce97e73a3f65359449bcc35deb9c81910fb'
const POOL3_ZKEY_SHA256 = 'b0177dbe5bb1bf7e9122a00953a2facd3d05b0405fee6c1a59d0da55cfb81659'

let provingWasm = PROVING_WASM_3OUT_URL
let provingZkey = PROVING_ZKEY_3OUT_URL

if (ASSETS_DIR) {
    const exists = (path) => { try { accessSync(path); return true } catch { return false } }
    const sha256OfFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
    const wasmPath = [`${ASSETS_DIR}/pool3.wasm`, `${ASSETS_DIR}/pool3_js/pool3.wasm`].find(exists)
    const zkeyPath = `${ASSETS_DIR}/pool3_final.zkey`

    if (!wasmPath || !exists(zkeyPath)) throw new Error(`--assets: pool3.wasm (+ pool3_js/) and pool3_final.zkey not found under ${ASSETS_DIR}`)

    const wasmSha = sha256OfFile(wasmPath)
    const zkeySha = sha256OfFile(zkeyPath)

    if (wasmSha !== POOL3_WASM_SHA256) throw new Error(`--assets: pool3.wasm sha256 ${wasmSha} != the pinned ${POOL3_WASM_SHA256}`)
    if (zkeySha !== POOL3_ZKEY_SHA256) throw new Error(`--assets: pool3_final.zkey sha256 ${zkeySha} != the pinned ${POOL3_ZKEY_SHA256}`)

    provingWasm = wasmPath
    provingZkey = zkeyPath
    console.log(`proving assets: LOCAL (sha256-verified) ${wasmPath}`)
} else {
    console.log(`proving assets: the mirror URLs ${provingWasm}`)
}

/* ---- the wallet key + notes ---- */
const keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf8'))
const privateKey = hexToBin(String(keyFile.privateKeyHex).replace(/^0x/, ''))
const address = keyFile.address
const walletLocking = cashAddressToLockingBytecode(address).bytecode
const ownNotes = JSON.parse(readFileSync(NOTES_PATH, 'utf8'))

/* ---- electrum (read-only except the broadcasts) ---- */
const client = new ElectrumClient('nito-sweep', '1.5', 'chipnet.bch.ninja', { port: 50004, encrypted: true })
await client.connect()

const getUtxos = async (addr) => {
    /* The prove can idle the socket for ~25 s between the scan and this call;
     * a stale connection can resolve a JSON-RPC error object instead of the
     * array — diagnose + reconnect once before failing. */
    let result = await client.request('blockchain.address.listunspent', addr, 'include_tokens')

    if (!Array.isArray(result)) {
        console.log('listunspent returned ' + JSON.stringify(result)?.slice(0, 200) + ' — reconnecting once…')

        try { await client.disconnect(true) } catch {}
        await client.connect()

        result = await client.request('blockchain.address.listunspent', addr, 'include_tokens')
    }

    if (!Array.isArray(result)) throw new Error('listunspent failed twice: ' + JSON.stringify(result).slice(0, 300))

    return result
}
const txOf = async (txid) => {
    const tx = decodeTransaction(hexToBin(await client.request('blockchain.transaction.get', txid)))
    if (typeof tx === 'string') throw new Error(`undecodable tx ${txid}: ${tx}`)
    return tx
}

/* Broadcast with a stale-socket retry: the ~25-s prove can idle the TLS
   connection, and a dead socket resolves an error STRING (not a throw) that
   must never be mistaken for a txid. Reconnect once, retry, and verify the
   response IS the locally-computed txid (a tx that already reached the
   mempool is confirmed via transaction.get, not re-broadcast). */
const sha256Hash = await instantiateSha256()
const expectedTxidOf = (hex) => binToHex(new Uint8Array(hash256(hexToBin(hex), sha256Hash)).reverse())
const isValidTxid = (txid) => typeof txid === 'string' && /^[0-9a-f]{64}$/.test(txid)

const broadcastValidated = async (hex, label) => {
    const expected = expectedTxidOf(hex)

    let txid
    try {
        txid = await client.request('blockchain.transaction.broadcast', hex)
    } catch {
        txid = null
    }

    if (!isValidTxid(txid)) {
        console.log(`${label} broadcast returned ${JSON.stringify(txid)} — reconnecting once…`)

        try { await client.disconnect(true) } catch {}
        await client.connect()

        try {
            txid = await client.request('blockchain.transaction.broadcast', hex)
        } catch {
            txid = null
        }
    }

    if (!isValidTxid(txid)) {
        /* The first attempt may have REACHED the server before the socket died:
           an "already have" answer means the tx IS in the mempool. */
        try {
            const raw = await client.request('blockchain.transaction.get', expected)
            if (raw === hex) {
                console.log(`${label} broadcast: already in the mempool as ${expected}`)
                return expected
            }
        } catch { /* not in the mempool — the broadcast really failed */ }

        throw new Error(`${label} broadcast failed twice: ${JSON.stringify(txid)}`)
    }

    if (txid !== expected) throw new Error(`${label} broadcast returned ${txid} but the built tx is ${expected}`)

    console.log(`${label.toUpperCase()} BROADCAST: ${txid}`)

    return txid
}

/* The minimal cluster adapter scanPoolActions needs. */
const cluster = {
    getScripthashHistory: (scripthash) => client.request('blockchain.scripthash.get_history', scripthash),
    getTransaction: (txid) => client.request('blockchain.transaction.get', txid),
}

/* ---- the scan (the action chain + the state tip) ---- */
console.log(`scanning ${pool.id}…`)
const scan = await scanPoolActions({ cluster, pool, networkId: 'chipnet' })
const tip = scan.actions[scan.actions.length - 1]
if (!tip) throw new Error('the pool has no actions yet — nothing to sweep against')

const tipTx = await txOf(tip.txid)
const stateOut = tipTx.outputs[1]
if (!stateOut?.token?.nft?.commitment) throw new Error(`the tip ${tip.txid} out1 is not a state NFT`)
const stateUtxo = {
    txid: tip.txid,
    vout: 1,
    sats: stateOut.valueSatoshis,
    token: {
        category: binToHex(stateOut.token.category),
        amount: stateOut.token.amount,
        nft: { capability: stateOut.token.nft.capability, commitment: binToHex(stateOut.token.nft.commitment) },
    },
}
console.log(`state ${tip.txid.slice(0, 16)}…:1 · balance ${stateOut.token.amount} FT · ${scan.actions.length} actions`)

const leaves = assembleLeaves(scan, pool)
const outs = 3

/* ---- the VM gate (consensus + standard, every input) — pool-op-role2.mjs ---- */
const sha256Of = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))

const vmGate = async (label, hex, sources) => {
    const tx = decodeTransaction(hexToBin(hex))
    if (typeof tx === 'string') throw new Error(`${label} does not decode: ${tx}`)

    for (const mode of ['consensus', 'standard']) {
        for (let i = 0; i < tx.inputs.length; i += 1) {
            const st = VMS[mode].evaluate({ inputIndex: i, sourceOutputs: sources, transaction: tx })
            const top = st.stack?.[st.stack.length - 1]
            const ok = st.error === undefined && st.stack.length === 1 && top?.length === 1 && top[0] === 1
            if (!ok) throw new Error(`${label} ${mode} REJECTED input ${i}: ${st.error ?? 'final stack ' + st.stack.length}`)
        }
        console.log(`${label}: ${mode} — all ${tx.inputs.length} inputs ACCEPT`)
    }
}

/* The REAL source outputs of an ACTION: the two tagged fuel prevouts (hook
   4c/4g read their category + commitment; fuel0 carries the FT deposit) and
   the state prevout (category + balance + commitment).

   libauth's token.category is DISPLAY-order and the VM's token-category
   opcodes reverse it to push the WIRE bytes (bch-2023-tokens.js
   pushTokenExtendedCategory) — the sources carry the decoded (display)
   categories exactly as the real chain would present them. */
const actionSources = async (fuel) => {
    const programLocking = hexToBin(pool.program.lockingBytecode)

    const sources = []
    for (const utxo of fuel) {
        const parent = await txOf(utxo.txid)
        const out = parent.outputs[utxo.vout]
        sources.push({
            lockingBytecode: programLocking,
            valueSatoshis: out.valueSatoshis,
            token: {
                category: out.token.category,
                amount: out.token?.amount ?? 0n,
                nft: { capability: 'mutable', commitment: out.token.nft.commitment },
            },
        })
    }

    sources.push({
        lockingBytecode: programLocking,
        valueSatoshis: stateOut.valueSatoshis,
        token: {
            category: stateOut.token.category,
            amount: stateOut.token.amount,
            nft: { capability: 'mutable', commitment: stateOut.token.nft.commitment },
        },
    })

    return sources
}

/* ---- the prove closure (mirrors the store's 3-out branch) ---- */
const buildProve = ({ inNotes, pv }) => {
    return async () => {
        /* Fresh out-note secrets (the nk · G convention — spendable later). */
        const { buildBabyjub } = await import('circomlibjs')
        const bbj = await buildBabyjub()
        const F = bbj.F
        const modr = (x) => ((x % F.p) + F.p) % F.p
        const pubOf = (nk) => { const p = bbj.mulPointEscalar(bbj.Base8, nk); const x = BigInt(F.toObject(p[0])); if (x >= F.p) throw new Error('out-note ownerPub out of range'); return x }
        const rnd = async () => {
            const bytes = new Uint8Array(32)
            crypto.getRandomValues(bytes)
            return modr(BigInt('0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')))
        }
        const selfNote = async (value) => {
            const nk = await rnd()
            return { value, ownerPub: pubOf(nk), rho: await rnd(), r: await rnd(), nk }
        }

        /* A sweep is a SHIELD-like action (sign 0): outSum = inSum + pv, the
           3-out demo's 40/30/30 split. */
        const inSum = inNotes.reduce((sum, n) => sum + n.note.value, 0n)
        const outSum = inSum + pv
        const out0 = outSum * 2n / 5n
        const out1 = outSum * 3n / 10n
        const outNotes = [await selfNote(out0), await selfNote(out1), await selfNote(outSum - out0 - out1)]

        const witness = await buildPoolWitness3out({
            inNotes,
            outNotes: outNotes.map(({ value, ownerPub, rho, r }) => ({ value, ownerPub, rho, r })),
            leaves,
            publicValueAbs: pv,
            publicValueSign: 0n,
            assetCategory: BigInt('0x' + pool.assetCategory),
        })

        console.log(`proving (pv ${pv}, inSum ${inSum} → outSum ${outSum})…`)
        /* B4: generateProof refuses UNPINNED locations — the harness's --assets
           mode already sha256-verifies these LOCAL files against the SAME
           pins (the check at startup), so the pre-verified bytes pass through
           with allowUnpinned; the mirror-URL default path stays pinned. */
        const { proof, publicSignals } = await generateProof(witness, provingWasm, provingZkey, { allowUnpinned: true })

        const carrier = encodeRole2Carrier({
            nf0: BigInt(witness.nf[0]),
            nf1: BigInt(witness.nf[1]),
            cm0: BigInt(witness.cm[0]),
            cm1: BigInt(witness.cm[1]),
            cm2: BigInt(witness.cm[2]),
            newRoot: BigInt(witness.newMerkleRoot),
            pv,
            sign: 0n,
        }, outs)

        const oldNull = hexToBin(stateUtxo.token.nft.commitment).slice(32)
        const newNull = await sha256Of(new Uint8Array([...oldNull, ...carrier.slice(0, 64)]))

        const scenarioArgs = {
            sc: {
                nf0: BigInt(witness.nf[0]),
                nf1: BigInt(witness.nf[1]),
                cm0: BigInt(witness.cm[0]),
                cm1: BigInt(witness.cm[1]),
                cm2: BigInt(witness.cm[2]),
                newRoot: BigInt(witness.newMerkleRoot),
                pv,
                sign: 0n,
            },
            n0: BigInt(publicSignals[0]),
            balance: BigInt(stateUtxo.token.amount),
            oldNull,
            /* display-order bytes — the actionHash preimage's category. */
            categoryDisplay: hexToBin(pool.assetCategory),
        }
        const unlockings = produceRole2Inputs3out({ proof, publicSignals, categoryOnChain: ROLE2_3OUT_CATEGORY_ONCHAIN, scenarioArgs })

        const newBalance = BigInt(stateUtxo.token.amount) + pv

        /* The state NFT commitment carries the 32-byte LE root. */
        const rootLE = new Uint8Array(32)
        let rootValue = BigInt(witness.newMerkleRoot)
        for (let i = 0; i < 32; i += 1) { rootLE[i] = Number(rootValue & 0xffn); rootValue >>= 8n }

        /* The OLD root (n0 = witness.merkleRoot, LE) MUST equal the root
           stored in the state commitment — the program's check 5. A mismatch
           means the leaf assembly or the scan drifted; fail BEFORE proving
           wastes the broadcast. */
        const oldRootLE = new Uint8Array(32)
        let oldValue = BigInt(witness.merkleRoot)
        for (let i = 0; i < 32; i += 1) { oldRootLE[i] = Number(oldValue & 0xffn); oldValue >>= 8n }
        const storedRoot = hexToBin(stateUtxo.token.nft.commitment).slice(0, 32)
        if (binToHex(storedRoot) !== binToHex(oldRootLE)) {
            throw new Error(`the witness old root ${binToHex(oldRootLE).slice(0, 16)}… != the stored state root ${binToHex(storedRoot).slice(0, 16)}…`)
        }

        return { carrier, unlockings, newRoot: rootLE, newNull, newBalance, outNotes }
    }
}

/* ────────────────────────── make-standing ────────────────────────── */
if (MODE === 'make-standing') {
    /* In-notes: the wallet's TWO LARGEST unspent notes (the selectInNotes
       order) — the lock's tag will bind exactly this pair. */
    const unspent = ownNotes
        .filter((n) => !n.spent)
        .map((n) => ({
            note: { value: BigInt(n.value), ownerPub: BigInt(n.ownerPub), rho: BigInt(n.rho), r: BigInt(n.r) },
            nk: BigInt(n.nk),
            index: n.leafIndex,
        }))
        .sort((a, b) => (a.note.value < b.note.value ? 1 : -1))

    const inNotes = unspent.slice(0, 2)
    if (inNotes.length !== 2) throw new Error('the wallet needs at least two unspent notes for a standing lock')

    const prove = buildProve({ inNotes, pv: AMOUNT })
    const proof = await prove()
    const tag = binToHex(depositTag(proof.carrier))
    console.log(`carrier ${proof.carrier.length}B · tag ${tag.slice(0, 16)}…`)

    /* The wallet's lock material: 2 blanks + plain funding + the supply FT —
       all at wallet A's address (the lock signs every input with ONE key). */
    const utxos = await getUtxos(address)
    const normalize = (u) => ({
        txid: u.tx_hash,
        vout: u.tx_pos,
        sats: BigInt(u.value),
        token: u.token_data ? {
            category: u.token_data.category,
            amount: BigInt(u.token_data.amount),
            ...(u.token_data.nft ? { nft: { capability: u.token_data.nft.capability, commitment: u.token_data.nft.commitment || '' } } : {}),
        } : undefined,
    })
    const walletUtxos = utxos.map(normalize)

    const blanks = selectBlanks(walletUtxos, pool.assetCategory)
    if (!blanks) throw new Error('wallet A needs TWO blanks (the 3-out category) for the lock')

    const funding = []
    let fundTotal = 0n
    for (const u of walletUtxos.filter((c) => !c.token).sort((a, b) => (a.sats < b.sats ? 1 : -1))) {
        funding.push(u)
        fundTotal += u.sats
        if (fundTotal >= 32000n) break
    }
    if (fundTotal < 30000n) throw new Error(`wallet A needs 30,000+ plain sats for the fuel (has ${fundTotal})`)

    const supply = AMOUNT > 0n
        ? walletUtxos.find((u) => u.token && u.token.category === pool.assetCategory && !u.token.nft && u.token.amount >= AMOUNT)
        : null
    if (AMOUNT > 0n && !supply) throw new Error(`wallet A needs a ${pool.assetCategory.slice(0, 8)}… FT UTXO covering the ${AMOUNT} deposit`)

    const lock = await buildRole2Lock({
        pool,
        tag: depositTag(proof.carrier),
        shield: AMOUNT,
        fundingUtxo: funding,
        blanks,
        supplyUtxo: supply,
        changeAddress: address,
        privateKey,
    })
    console.log(`lock ${lock.txid} · ${lock.hex.length / 2}B · fee ${lock.fee} · fuel ${lock.fuelOutpoints.map((f) => f.txid.slice(0, 8) + ':' + f.vout).join(', ')}`)

    /* VM-gate the lock (plain P2PKH + tokens — every input). */
    const lockSources = [
        ...funding.map((u) => ({ lockingBytecode: walletLocking, valueSatoshis: u.sats })),
        ...blanks.map((u) => ({
            lockingBytecode: walletLocking,
            valueSatoshis: u.sats,
            token: { category: hexToBin(pool.assetCategory), amount: 0n, nft: { capability: 'mutable', commitment: new Uint8Array(0) } },
        })),
        ...(supply ? [{
            lockingBytecode: walletLocking,
            valueSatoshis: supply.sats,
            token: { category: hexToBin(pool.assetCategory), amount: supply.token.amount },
        }] : []),
    ]
    await vmGate('lock', lock.hex, lockSources)

    if (DRY) {
        console.log('--dry — the lock was built and VM-accepted, nothing broadcast.')
        process.exit(0)
    }

    const lockTxid = await broadcastValidated(lock.hex, 'lock')
    if (lockTxid !== lock.txid) throw new Error(`broadcast returned ${lockTxid} but the built lock is ${lock.txid}`)

    /* The standing record — the fuel this lock created, stranded on purpose. */
    const record = {
        lockTxid,
        pool: pool.id,
        tag,
        amount: AMOUNT.toString(),
        inNoteIndices: inNotes.map((n) => n.index),
        fuel: lock.fuelOutpoints,
        createdAt: new Date().toISOString(),
    }
    writeFileSync(RECORD_PATH, JSON.stringify(record, null, 2) + '\n')
    console.log(`standing record → ${RECORD_PATH}`)
    console.log('NOW run: node scripts/role2-sweep-standing.mjs sweep --record ' + RECORD_PATH)
    process.exit(0)
}

/* ────────────────────────────── sweep ────────────────────────────── */
{
    /* The standing fuel: from the record, or explicit outpoints. */
    let fuelSpecs
    if (FUEL_ARG) {
        fuelSpecs = FUEL_ARG.split(',').map((s) => {
            const [txid, vout] = s.split(':')
            return { txid, vout: Number(vout) }
        })
    } else {
        const record = JSON.parse(readFileSync(RECORD_PATH, 'utf8'))
        if (record.pool !== pool.id) throw new Error(`the record is for pool ${record.pool}, not ${pool.id}`)
        fuelSpecs = record.fuel.map((f) => ({ txid: f.txid, vout: f.vout }))
    }
    if (fuelSpecs.length !== 2) throw new Error('exactly TWO fuel UTXOs are required')

    /* Fetch the fuel from the chain (the record is informational; the chain
       wins): sats + the tag commitment + the FT on fuel0. */
    const fuel = []
    for (const spec of fuelSpecs) {
        const parent = await txOf(spec.txid)
        const out = parent.outputs[spec.vout]
        if (!out?.token?.nft?.commitment) throw new Error(`fuel ${spec.txid.slice(0, 16)}…:${spec.vout} is not a tagged NFT`)
        fuel.push({
            txid: spec.txid,
            vout: spec.vout,
            sats: out.valueSatoshis,
            token: {
                category: binToHex(out.token.category),
                amount: out.token.amount,
                nft: { capability: out.token.nft.capability, commitment: binToHex(out.token.nft.commitment) },
            },
        })
    }
    const tag = fuel[0].token.nft.commitment
    if (fuel[1].token.nft.commitment !== tag) throw new Error('the two fuel UTXOs carry different tags')
    console.log(`standing fuel ${fuelSpecs[0].txid.slice(0, 16)}…:${fuel[0].vout} + :${fuel[1].vout} · tag ${tag.slice(0, 16)}… · fuel0 FT ${fuel[0].token.amount}`)

    /* Is the fuel still standing? (spent fuel cannot fund the action) */
    const programScripthash = binToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', hexToBin(pool.program.lockingBytecode))).reverse())
    const standing = await client.request('blockchain.scripthash.listunspent', programScripthash)
    for (const f of fuel) {
        if (!standing.some((u) => u.tx_hash === f.txid && u.tx_pos === f.vout)) {
            throw new Error(`fuel ${f.txid.slice(0, 16)}…:${f.vout} is NOT standing at the program anymore`)
        }
    }

    /* The in-note pair the tag binds — the whole point of the recovery. */
    const inNotes = await matchStandingFuelNotes({ commitment: tag, ownNotes, bootstrapNotes: pool.bootstrapNotes })
    if (!inNotes) throw new Error('no in-note pair (own notes or the bootstrap pair) matches the standing fuel tag')
    console.log(`tag-matched in-notes: leaf indices ${inNotes.map((n) => n.index).join(' + ')} · values ${inNotes.map((n) => n.note.value).join(' + ')}`)

    const sources = await actionSources(fuel)

    let savedNotes = null
    let result

    try {
        result = await submitRole2Action({
            pool,
            state: stateUtxo,
            standingFuel: fuel,
            prove: buildProve({ inNotes, pv: fuel[0].token.amount }),
            broadcast: async (hex, label) => {
                await vmGate(label, hex, sources)
                if (DRY) throw new Error(`--dry — ${label} VM-accepted; refusing to broadcast`)
                return broadcastValidated(hex, label)
            },
            saveNotes: async (notes) => { savedNotes = notes },
        })
    } catch (err) {
        if (DRY && String(err?.message || '').includes('--dry')) {
            console.log('--dry — the action was built and VM-accepted, nothing broadcast.')
            process.exit(0)
        }
        throw err
    }

    /* The action txid must be real before any out-note handoff is written —
       the notes are only spendable if THIS action landed. */
    if (!isValidTxid(result.actionTxid)) throw new Error('the orchestrator returned no valid action txid: ' + result.actionTxid)

    /* The out-notes in the recordNote import shape (cm/nf computed, global
       leaf indices assigned after every scanned action). */
    const leafIndexBase = (pool.genesisLeafCount || (pool.genesisLeaves || []).length) + scan.actions.length * outs
    const outNotes = []
    for (const [index, n] of (savedNotes?.outNotes || []).entries()) {
        if (n.nk === undefined || n.nk === null) continue
        const cm = await noteCommitment(BigInt(n.value), BigInt(n.ownerPub), BigInt(n.rho), BigInt(n.r))
        outNotes.push({
            value: String(n.value),
            ownerPub: String(n.ownerPub),
            rho: String(n.rho),
            r: String(n.r),
            nk: String(n.nk),
            cm: String(cm),
            nf: String(await nullifier(BigInt(n.nk), BigInt(n.rho))),
            leafIndex: leafIndexBase + index,
            spent: false,
        })
    }
    writeFileSync(OUT_PATH, JSON.stringify(outNotes, null, 2) + '\n')

    console.log('')
    console.log(`SWEEP ${result.actionTxid}`)
    console.log(`  state ${stateUtxo.token.amount} → ${BigInt(stateUtxo.token.amount) + fuel[0].token.amount} FT (deposit ${fuel[0].token.amount})`)
    console.log(`  fee ${result.fee} sats · fuel spent: ${fuelSpecs[0].txid.slice(0, 16)}…:${fuel[0].vout}/:${fuel[1].vout}`)
    console.log(`  out-notes → ${OUT_PATH} (${outNotes.length} notes, leaf indices ${leafIndexBase}..${leafIndexBase + outNotes.length - 1})`)
    process.exit(0)
}
