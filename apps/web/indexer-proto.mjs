// indexer-proto.mjs — verify the pool note-indexer data path against the LIVE
// chipnet pool. For each spend tx (SHIELD/TRANSFER/UNSHIELD), decode the pool
// covenant input's unlocking bytecode, extract (nf0,nf1,cm0,cm1,newMerkleRoot,
// publicValueAbs,isUnshield), and recompute the actionHash — it MUST match the
// documented on-chain actionHash (proving the extraction + arg order + the
// Option-F SHA256 binding are all consistent with what the covenant enforced).
import { decodeTransaction, hexToBin, binToHex, sha256 } from '@bitauth/libauth'

const TXS = {
    T1: { txid: '3a8b9287ea97c050b0110522afa84daf0de90984ef3266db4062768d19adf8a5', actionHash: '4261255591739942988380960310842541626307877897755389090012830740782359021384' },
    U1: { txid: 'c8d4c6e67859602a700b36ed33c6d90f0bf0ecb43c2e58b87041f845d4cc214a', actionHash: '13109222487455492990002112920267863123858488928455615422294205180256861739436' },
}
// The live pool's PUSD stand-in CashToken category (= the TX-P3 genesis txid).
// NOTE: CHIPNET.md's intro shows a stale earlier mint (479aeebabc…); the DEPLOYED
// pool uses 8c73ff150f… — verified by reading output[0].tokenCategory on-chain.
const CATEGORY = 0x8c73ff150fbc5d1599d2de187c3382c5926cc5c9c2621cdc2cac1fc14cd93144n

function rpc(ws, id, method, params) {
    return new Promise((res, rej) => { const f = ev => { const m = JSON.parse(ev.data); if (m.id !== id) return; ws.removeEventListener('message', f); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) }; ws.addEventListener('message', f); ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params })) })
}
function pushes(bc) { const it = []; let i = 0; while (i < bc.length) { const op = bc[i++]; let len; if (op === 0) { it.push(new Uint8Array(0)); continue } else if (op <= 0x4b) len = op; else if (op === 0x4c) len = bc[i++]; else if (op === 0x4d) { len = bc[i] | (bc[i + 1] << 8); i += 2 } else if (op >= 0x51 && op <= 0x60) { it.push(new Uint8Array([op - 0x50])); continue } else { it.push(null); continue } it.push(bc.slice(i, i + len)); i += len } return it }
const leToBig = b => (b && b.length) ? BigInt('0x' + binToHex(new Uint8Array(b).reverse())) : 0n

/* Option-F actionHash: SHA256 over the 8 fields as 32-byte BIG-ENDIAN, top 3 bits cleared. */
function actionHash({ nf0, nf1, cm0, cm1, publicValueAbs, publicValueSign, assetCategory, newMerkleRoot }) {
    const fields = [nf0, nf1, cm0, cm1, publicValueAbs, publicValueSign, assetCategory, newMerkleRoot]
    const pre = new Uint8Array(8 * 32)
    fields.forEach((f, i) => { const hex = BigInt(f).toString(16).padStart(64, '0'); for (let b = 0; b < 32; b++) pre[i * 32 + b] = parseInt(hex.slice(b * 2, b * 2 + 2), 16) })
    const d = sha256.hash(pre); d[0] &= 0x1f
    return d.reduce((acc, b) => (acc << 8n) | BigInt(b), 0n)
}

const ws = new WebSocket('wss://chipnet.imaginary.cash:50004')
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
await rpc(ws, 0, 'server.version', ['indexer-proto', '1.5'])

for (const [label, { txid, actionHash: expectedAH }] of Object.entries(TXS)) {
    const tx = decodeTransaction(hexToBin(await rpc(ws, 1, 'blockchain.transaction.get', [txid, false])))
    // covenant input: the one whose unlocking bytecode ends in the ~347-byte redeem script
    const idx = tx.inputs.findIndex(inp => { const p = pushes(inp.unlockingBytecode); return p.length >= 8 && p[p.length - 1] && p[p.length - 1].length > 200 && p[p.length - 1].length < 400 })
    const p = pushes(tx.inputs[idx].unlockingBytecode)
    // unlocking (left->right) = [isUnshield, publicValueAbs, newMerkleRoot, cm1, cm0, nf1, nf0, <pad>, redeem]
    const args = {
        isUnshield: leToBig(p[0]),
        publicValueAbs: leToBig(p[1]),
        newMerkleRoot: leToBig(p[2]),
        cm1: leToBig(p[3]), cm0: leToBig(p[4]),
        nf1: leToBig(p[5]), nf0: leToBig(p[6]),
    }
    const ah = actionHash({ ...args, publicValueSign: args.isUnshield, assetCategory: CATEGORY })
    console.log(`${label}: covenantInput=${idx} pvAbs=${args.publicValueAbs} isUnshield=${args.isUnshield}`)
    console.log(`  recomputed actionHash = ${ah}`)
    console.log(`  documented actionHash = ${expectedAH}`)
    console.log(`  MATCH = ${ah.toString() === expectedAH}`)
}
ws.close()
