// apps/web/scripts/pool-accept.mjs
//
// The BLOCKER-3 ACCEPTANCE HARNESS — byte-compares the wallet's verifier-step
// port (src/lib/pool/verifier.js, parameterized by the DEPLOYED program in
// src/lib/pool/verifier-program.js) against a LIVE deployed-pool action under
// a candidate verifying key.
//
// GATE: registry.js `walletProverCompatible` may flip to true for a pool ONLY
// once this harness reports all five verifier inputs BYTE-EXACT (AGENTS.md
// blocker-3/blocker-4 sections). The deployed pools' TRUE vkey was recovered
// 2026-11-22 (tests/fixtures/pool/deployed-vkey.json — the apecsdev VM
// ~/zkb/pusd-shielded-pool/build/ pair; its IC points are embedded in the
// on-chain program and its vk_x reproduces the live witnesses) — but the
// runner's witness-ENCODING generator (a different MSM build than the public
// bench main) is still missing, so the harness currently reports the layout
// deltas per input: the live push-0 carries the same 14 fields in NATURAL
// order, LITTLE-ENDIAN (the port emits a reordered, big-endian layout), and
// the live fields[4]/[5] DO contain the recovered key's vk_x.
//
// Run (from apps/web/, plain node — the wallet's cluster is NOT used; a
// single Electrum server is queried read-only):
//   node scripts/pool-accept.mjs --pool gate3
//   node scripts/pool-accept.mjs --pool mainnet --txid 4fda8a8b
//   node scripts/pool-accept.mjs --pool gate3 --vkey path/to/other-vkey.json
//   node scripts/pool-accept.mjs --pool role2
//
// Options:
//   --pool <gate3|mainnet|role2>   the registry pool to test (default gate3)
//   --txid <prefix>          a specific live action txid prefix (default:
//                            the pool's first decodable action in history)
//   --vkey <path>            candidate vkey in snarkjs JSON shape (default:
//                            tests/fixtures/pool/deployed-vkey.json)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bn254 } from '@noble/curves/bn254.js'
import { binToHex, decodeTransaction, hexToBin, sha256 } from '@bitauth/libauth'
import { ElectrumClient } from '@electrum-cash/network'

import { produceVerifierInputs } from '../src/lib/pool/verifier.js'
import { DEPLOYED_PROGRAM } from '../src/lib/pool/verifier-program.js'
import { produceRole2Inputs } from '../src/lib/pool/verifier-role2.js'
import { produceRole2Inputs3out, ROLE2_3OUT_CATEGORY_ONCHAIN } from '../src/lib/pool/verifier-role2-3out.js'

/* ---- args ---- */
const args = process.argv.slice(2)
const argOf = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : null
}
const POOL = argOf('--pool') || 'gate3'
const TXID_PREFIX = argOf('--txid')
const VKEY_PATH = argOf('--vkey') || fileURLToPath(new URL('../tests/fixtures/pool/deployed-vkey.json', import.meta.url))

/* The registry pool locking bytecodes (apps/web/src/lib/pool/registry.js) +
   one Electrum server per network (read-only diagnostic — the app's quorum
   cluster is not needed here). */
const POOLS = {
    gate3: {
        network: 'chipnet',
        locking: 'aa207c0c15fbdc14dda43fb0540846e065a1bbd4076e7ab64720e64c3ecd3515208087',
        server: { host: 'chipnet.bch.ninja', port: 50004 },
    },
    mainnet: {
        network: 'mainnet',
        locking: 'aa20a8d375c44dfa07ab5b3a7773e69e608fc307d188be00f5308813ef80989a47b987',
        server: { host: 'bch.imaginary.cash', port: 50004 },
    },
    role2: {
        network: 'chipnet',
        locking: 'aa203e40b64cff154d4b3305e8c8cc4e3174bc595ad74342a8445a9a7798b7be3a2987',
        server: { host: 'chipnet.bch.ninja', port: 50004 },
    },
    'role2-3out': {
        network: 'chipnet',
        locking: 'aa204a6ce339fb62b7b2ebb502c9bf642d3221620e6f5ded619ce8a39110e35182ea87',
        server: { host: 'chipnet.bch.ninja', port: 50004 },
    },
}
const pool = POOLS[POOL]
if (!pool) throw new Error(`unknown pool '${POOL}' (gate3 | mainnet | role2 | role2-3out)`)

/* ---- the candidate vkey (snarkjs shape) -> bench shape (actions.js toBenchVk) ---- */
const g1 = (p) => ({ x: p[0], y: p[1] })
const g2 = (p) => ({ x: { c0: p[0][0], c1: p[0][1] }, y: { c0: p[1][0], c1: p[1][1] } })
const vkeyJson = JSON.parse(readFileSync(VKEY_PATH, 'utf8'))
const vk = {
    alpha: g1(vkeyJson.vk_alpha_1),
    beta: g2(vkeyJson.vk_beta_2),
    gamma: g2(vkeyJson.vk_gamma_2),
    delta: g2(vkeyJson.vk_delta_2),
    ic: vkeyJson.IC.map(g1),
}

/* ---- decode primitives (src/lib/pool/decode.js ports; plain-node copies) ---- */
const PROVEN_N0_OFFSET = 1825
const PROVEN_N1_OFFSET = 1792
const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n
const modP = (v) => ((v % P) + P) % P
const leToBig = (bytes) => (bytes && bytes.length) ? BigInt('0x' + binToHex(new Uint8Array(bytes).reverse())) : 0n
const le32Big = (bytes) => { let n = 0n; for (let i = bytes.length - 1; i >= 0; i -= 1) n = (n << 8n) | BigInt(bytes[i]); return n }
const be32Big = (bytes) => { let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b); return n }
const hexBE64 = (v) => BigInt(v).toString(16).padStart(64, '0')
const hexLE64 = (v) => hexBE64(v).match(/../g).reverse().join('')
const onCurveG1 = (x, y) => modP(y * y - (x * x * x + 3n)) === 0n

function scriptPushes(bytecode) {
    const items = []
    let i = 0
    while (i < bytecode.length) {
        const op = bytecode[i]
        i += 1
        let len
        if (op === 0) { items.push(new Uint8Array(0)); continue }
        else if (op <= 0x4b) { len = op }
        else if (op === 0x4c) { len = bytecode[i]; i += 1 }
        else if (op === 0x4d) { len = bytecode[i] | (bytecode[i + 1] << 8); i += 2 }
        else if (op >= 0x51 && op <= 0x60) { items.push(new Uint8Array([op - 0x50])); continue }
        else { items.push(null); continue }
        items.push(bytecode.slice(i, i + len))
        i += len
    }
    return items
}

function findVerifierGenesisIndex(tx) {
    return tx.inputs.findIndex((input) =>
        input.unlockingBytecode.length > PROVEN_N0_OFFSET + 32 &&
        input.unlockingBytecode[PROVEN_N1_OFFSET - 1] === 0x20 &&
        input.unlockingBytecode[PROVEN_N0_OFFSET - 1] === 0x20)
}

/* ---- fetch the live action ---- */
const scripthash = binToHex(new Uint8Array(sha256.hash(hexToBin(pool.locking))).reverse())
const client = new ElectrumClient('nito.cash', '1.5', pool.server.host, { port: pool.server.port, encrypted: true })
await client.connect()
const history = (await client.request('blockchain.scripthash.get_history', scripthash)).filter((h) => h.height > 0).sort((a, b) => a.height - b.height)

let txid = TXID_PREFIX
    ? history.find((h) => h.tx_hash.startsWith(TXID_PREFIX))?.tx_hash
    : null

let raw = null
if (txid) {
    raw = await client.request('blockchain.transaction.get', txid)
} else {
    for (const entry of history) {
        const candidate = await client.request('blockchain.transaction.get', entry.tx_hash)
        const tx = decodeTransaction(hexToBin(candidate))
        if (typeof tx !== 'string' && findVerifierGenesisIndex(tx) !== -1) {
            txid = entry.tx_hash
            raw = candidate
            break
        }
    }
}
try { await client.disconnect(true) } catch {}
if (!raw) throw new Error('no live pool action found')

const tx = decodeTransaction(hexToBin(raw))
if (typeof tx === 'string') throw new Error('undecodable tx: ' + tx)

/* ─── role-2 (3-input bn-native-sound) branch ───
   The live state input (input 2) carries [DG] [STMT] [S_2] [HAND_2] [DS_2]
   [FILL_2] [WQ] [R]; STMT is the 642-byte push with the proof A/B/C + n0/n1.
   The generator is verifier-role2.js (the Hush bn-native-sound unlockingsFor). */
if (POOL === 'role2-3out') {
    const STMT_SIZE = 642
    const stmtPush = (unlocking) => scriptPushes(unlocking).find((p) => p && p.length === STMT_SIZE)
    const stmt = stmtPush(tx.inputs[2].unlockingBytecode)
    if (!stmt) throw new Error('role2-3out: no 642-byte STMT in the state input')
    const le = (bytes) => { let n = 0n; for (let i = bytes.length - 1; i >= 0; i -= 1) n = (n << 8n) | BigInt(bytes[i]); return n }
    const proof = {
        pi_a: [le(stmt.slice(0, 32)).toString(), le(stmt.slice(32, 64)).toString(), '1'],
        pi_b: [[le(stmt.slice(64, 96)).toString(), le(stmt.slice(96, 128)).toString()], [le(stmt.slice(128, 160)).toString(), le(stmt.slice(160, 192)).toString()], ['1', '0']],
        pi_c: [le(stmt.slice(192, 224)).toString(), le(stmt.slice(224, 256)).toString(), '1'],
    }
    const publicSignals = [le(stmt.slice(256, 288)), le(stmt.slice(288, 320))]
    console.log(`pool=role2-3out txid=${txid}`)
    console.log(`live inputs: ${tx.inputs.map((i, idx) => idx + ':' + i.unlockingBytecode.length).join('  ')}`)
    console.log(`publicSignals n0=0x${publicSignals[0].toString(16)}`)
    console.log(`               n1=0x${publicSignals[1].toString(16)}`)

    const carrier = tx.outputs[0].lockingBytecode.slice(3)
    if (carrier.length !== 201) throw new Error(`role2-3out: carrier is ${carrier.length}B, expected 201`)
    const sc = {
        nf0: le(carrier.slice(0, 32)), nf1: le(carrier.slice(32, 64)),
        cm0: le(carrier.slice(64, 96)), cm1: le(carrier.slice(96, 128)),
        cm2: le(carrier.slice(128, 160)), newRoot: le(carrier.slice(160, 192)),
        pv: le(carrier.slice(192, 200)), sign: BigInt(carrier[200]),
    }
    const stateInput = tx.inputs[2]
    const prevTxid = binToHex(stateInput.outpointTransactionHash)
    const prevClient = new ElectrumClient('nito.cash', '1.5', pool.server.host, { port: pool.server.port, encrypted: true })
    await prevClient.connect()
    const prevRaw = await prevClient.request('blockchain.transaction.get', prevTxid)
    try { await prevClient.disconnect(true) } catch {}
    const prevTx = decodeTransaction(hexToBin(prevRaw))
    if (typeof prevTx === 'string') throw new Error('role2-3out: undecodable state prevout ' + prevTxid)
    const statePrev = prevTx.outputs[stateInput.outpointIndex]
    const stateToken = statePrev.token
    if (!stateToken?.nft?.commitment || stateToken.nft.commitment.length !== 64) throw new Error('role2-3out: state prevout has no 64-B commitment')
    const scenarioArgs = {
        sc,
        n0: publicSignals[0],
        balance: stateToken.amount,
        oldNull: stateToken.nft.commitment.slice(32),
        categoryDisplay: tx.outputs[1].token.category,
    }
    console.log(`state prevout ${prevTxid}:${stateInput.outpointIndex} balance=${scenarioArgs.balance} oldNull=${binToHex(scenarioArgs.oldNull).slice(0, 16)}…`)

    const produced = produceRole2Inputs3out({ proof, publicSignals, categoryOnChain: ROLE2_3OUT_CATEGORY_ONCHAIN, scenarioArgs })
    const names = ['fuel0', 'fuel1', 'state']
    let allPass = true
    for (let i = 0; i < 3; i++) {
        const live = tx.inputs[i].unlockingBytecode
        const mine = new Uint8Array(produced[i])
        if (binToHex(live) === binToHex(mine)) {
            console.log(`  ${names[i]} (in[${i}]): *** BYTE-EXACT ***`)
            continue
        }
        allPass = false
        console.log(`  ${names[i]} (in[${i}]): MISMATCH (live ${live.length}B vs port ${mine.length}B)`)
    }
    console.log('')
    console.log(allPass
        ? 'ACCEPTANCE: PASS — the wallet 3-out port regenerates the deployed witness byte-exactly'
        : 'ACCEPTANCE: FAIL — the 3-out witness layout differs')
    process.exit(allPass ? 0 : 1)
}

if (POOL === 'role2') {
    const STMT_SIZE = 642
    const stmtPush = (unlocking) => scriptPushes(unlocking).find((p) => p && p.length === STMT_SIZE)
    const stmt = stmtPush(tx.inputs[2].unlockingBytecode)
    if (!stmt) throw new Error('role2: no 642-byte STMT in the state input')
    const le = (bytes) => { let n = 0n; for (let i = bytes.length - 1; i >= 0; i -= 1) n = (n << 8n) | BigInt(bytes[i]); return n }
    const proof = {
        pi_a: [le(stmt.slice(0, 32)).toString(), le(stmt.slice(32, 64)).toString(), '1'],
        pi_b: [[le(stmt.slice(64, 96)).toString(), le(stmt.slice(96, 128)).toString()], [le(stmt.slice(128, 160)).toString(), le(stmt.slice(160, 192)).toString()], ['1', '0']],
        pi_c: [le(stmt.slice(192, 224)).toString(), le(stmt.slice(224, 256)).toString(), '1'],
    }
    const publicSignals = [le(stmt.slice(256, 288)), le(stmt.slice(288, 320))]
    console.log(`pool=role2 txid=${txid}`)
    console.log(`live inputs: ${tx.inputs.map((i, idx) => idx + ':' + i.unlockingBytecode.length).join('  ')}`)
    console.log(`publicSignals n0=0x${publicSignals[0].toString(16)}`)
    console.log(`               n1=0x${publicSignals[1].toString(16)}`)

    /* The pool shape for the fill sizer: the carrier (out0) + the state prevout
       (the source token amount + the old nullifier) + the new-state category.
       The state input reads the outputs, so the stock sizer leaves FILL_2 short. */
    const carrier = tx.outputs[0].lockingBytecode.slice(3)
    if (carrier.length !== 169) throw new Error(`role2: carrier is ${carrier.length}B, expected 169`)
    const sc = {
        nf0: le(carrier.slice(0, 32)), nf1: le(carrier.slice(32, 64)),
        cm0: le(carrier.slice(64, 96)), cm1: le(carrier.slice(96, 128)),
        newRoot: le(carrier.slice(128, 160)), pv: le(carrier.slice(160, 168)), sign: BigInt(carrier[168]),
    }
    const stateInput = tx.inputs[2]
    const prevTxid = binToHex(stateInput.outpointTransactionHash)
    /* the harness disconnected the read client above; reconnect for the prevout */
    const prevClient = new ElectrumClient('nito.cash', '1.5', pool.server.host, { port: pool.server.port, encrypted: true })
    await prevClient.connect()
    const prevRaw = await prevClient.request('blockchain.transaction.get', prevTxid)
    try { await prevClient.disconnect(true) } catch {}
    const prevTx = decodeTransaction(hexToBin(prevRaw))
    if (typeof prevTx === 'string') throw new Error('role2: undecodable state prevout ' + prevTxid)
    const statePrev = prevTx.outputs[stateInput.outpointIndex]
    const stateToken = statePrev.token
    if (!stateToken?.nft?.commitment || stateToken.nft.commitment.length !== 64) throw new Error('role2: state prevout has no 64-B commitment')
    const scenarioArgs = {
        sc,
        n0: publicSignals[0],
        balance: stateToken.amount,
        oldNull: stateToken.nft.commitment.slice(32),
        categoryDisplay: tx.outputs[1].token.category,
    }
    console.log(`state prevout ${prevTxid}:${stateInput.outpointIndex} balance=${scenarioArgs.balance} oldNull=${binToHex(scenarioArgs.oldNull).slice(0, 16)}…`)

    const produced = produceRole2Inputs({ proof, publicSignals, scenarioArgs })
    const names = ['fuel0', 'fuel1', 'state']
    let allPass = true
    for (let i = 0; i < 3; i++) {
        const live = tx.inputs[i].unlockingBytecode
        const mine = new Uint8Array(produced[i])
        if (binToHex(live) === binToHex(mine)) {
            console.log(`  ${names[i]} (in[${i}]): *** BYTE-EXACT ***`)
            continue
        }
        allPass = false
        console.log(`  ${names[i]} (in[${i}]): MISMATCH (live ${live.length}B vs port ${mine.length}B)`)
    }
    console.log('')
    console.log(allPass
        ? 'ACCEPTANCE: PASS — the wallet role-2 port regenerates the deployed witness byte-exactly'
        : 'ACCEPTANCE: FAIL — the role-2 witness layout differs')
    process.exit(allPass ? 0 : 1)
}

console.log(`pool=${POOL} txid=${txid}`)
console.log(`live inputs: ${tx.inputs.map((i, idx) => idx + ':' + i.unlockingBytecode.length).join('  ')}`)

/* ---- the live genesis witness ---- */
const gi = findVerifierGenesisIndex(tx)
if (gi === -1) throw new Error('no verifier genesis input found')
const unlocking = tx.inputs[gi].unlockingBytecode
const n0 = leToBig(unlocking.slice(PROVEN_N0_OFFSET, PROVEN_N0_OFFSET + 32))
const n1 = leToBig(unlocking.slice(PROVEN_N1_OFFSET, PROVEN_N1_OFFSET + 32))
const p0 = scriptPushes(unlocking)[0]
const f = (i) => le32Big(p0.slice(i * 32, (i + 1) * 32))

console.log(`genesis in[${gi}] (${unlocking.length}B)  push-0 ${p0.length}B = ${p0.length / 32} x 32B fields (natural order, little-endian)`)
console.log(`publicSignals n0=0x${n0.toString(16)}`)
console.log(`               n1=0x${n1.toString(16)}`)

/* ---- vk_x binding check (fields 4/5, LE) ---- */
const G1c = bn254.G1
const point = (p) => G1c.Point.fromAffine({ x: BigInt(p.x), y: BigInt(p.y) })
let vkx = point(vk.ic[0])
if (n0 !== 0n) vkx = vkx.add(point(vk.ic[1]).multiply(n0))
if (n1 !== 0n) vkx = vkx.add(point(vk.ic[2]).multiply(n1))
const vp = vkx.toAffine()
const vkxMatch = vp.x === f(4) && vp.y === f(5)
console.log(`vk_x binding (candidate key vs live fields 4/5, LE): ${vkxMatch ? '*** MATCH ***' : 'no match'}`)

if (!vkxMatch) {
    console.log('ACCEPTANCE: FAIL at the vk_x binding — this vkey is NOT the pool\'s key.')
    process.exit(1)
}

/* ---- reconstruct the live proof from the LE fields (both a.y signs) ---- */
let produced = null
for (const ay of [modP(-f(3)), modP(f(3))]) {
    if (!onCurveG1(f(2), ay)) continue
    if (!onCurveG1(f(6), f(7))) continue
    const proof = {
        pi_a: [f(2).toString(), ay.toString(), '1'],
        pi_b: [[f(8).toString(), f(9).toString()], [f(10).toString(), f(11).toString()], ['1', '0']],
        pi_c: [f(6).toString(), f(7).toString(), '1'],
    }
    try {
        produced = produceVerifierInputs({ vk, proof, publicSignals: [n0, n1], program: DEPLOYED_PROGRAM })
        break
    } catch (e) {
        console.log(`port run with pi_a.y=0x${ay.toString(16).slice(0, 12)}…: ${e.message}`)
    }
}

if (!produced) {
    console.log('ACCEPTANCE: FAIL — the port\'s pairing sanity check rejects the live proof under this key')
    console.log('           (the runner\'s witness-generation revision — a different MSM build than the')
    console.log('            public bench main — is still required; see AGENTS.md blocker-3).')
    process.exit(1)
}

/* ---- the byte comparison (step order [exec0, exec1, exec2, genesis, terminal] <-> in[1..5]) ---- */
const stepIdx = [1, 2, 3, 4, 5]
const names = ['exec0', 'exec1', 'exec2', 'genesis', 'terminal']
let allPass = true
for (let i = 0; i < 5; i++) {
    const live = tx.inputs[stepIdx[i]].unlockingBytecode
    const mine = new Uint8Array(produced[i])
    const liveHex = binToHex(live)
    const mineHex = binToHex(mine)

    if (liveHex === mineHex) {
        console.log(`  ${names[i]} (in[${stepIdx[i]}]): *** BYTE-EXACT ***`)
        continue
    }

    allPass = false

    /* Structural delta: how many of the port's 32B values appear in the live
       input (either endianness) — values match, layout differs. */
    let found = 0
    let total = 0
    for (const pushBytes of scriptPushes(mine)) {
        if (!pushBytes || pushBytes.length < 32) continue
        for (let off = 0; off + 32 <= pushBytes.length; off += 32) {
            total += 1
            const v = be32Big(pushBytes.slice(off, off + 32))
            if (liveHex.includes(hexBE64(v)) || liveHex.includes(hexLE64(v))) found += 1
        }
    }

    const livePushSizes = scriptPushes(live).filter(Boolean).map((p) => p.length)
    const minePushSizes = scriptPushes(mine).filter(Boolean).map((p) => p.length)

    console.log(`  ${names[i]} (in[${stepIdx[i]}]): MISMATCH (live ${live.length}B/${livePushSizes.length}p vs port ${mine.length}B/${minePushSizes.length}p; port values found in live: ${found}/${total})`)
}

console.log('')
console.log(allPass
    ? 'ACCEPTANCE: PASS — the wallet port regenerates the deployed pool witness byte-exactly under this key'
    : 'ACCEPTANCE: FAIL — same underlying values, different witness layout: the runner\'s encoding revision is still required (AGENTS.md blocker-3)')
process.exit(allPass ? 0 : 1)
