/* Unit tests for the note-detection scan (lib/pool/scan.js + decode.js +
 * registry.js) — blocker #2 of the shielded-transfer wiring.
 *
 * Builds a SYNTHETIC three-action pool chain (encoded with the wallet's own
 * libauth encoder, decoded back through decode.js) against the REAL gate3
 * registry entry:
 *   action A — no carrier (plain append),
 *   action B — SAME BLOCK as A (proves outpoint-chained ordering, which
 *              height alone cannot resolve) and carries an encrypted note
 *              delivered to a second wallet (the carrier e2e),
 *   action C — spends that delivered note (nf0 = its nullifier).
 *
 * The chain is validated the way the scan does on live data: recomputed
 * Option-F actionHash must equal the proven n1, and the proven n0 chain must
 * run genesis-root -> A -> B -> C.
 */

import { beforeAll, describe, expect, it } from 'vitest'

/* Import libauth helpers (incl. the raw tx encoder the builders use). */
import { binToHex, cashAddressToLockingBytecode, encodeTransactionBCH, hexToBin } from '@bitauth/libauth'

/* Import pool lib. */
import { actionHash, actionHash3out, deriveSpendKey, noteCommitment, nullifier, getPoseidon } from '@/lib/pool/notes'
import { computeRoot } from '@/lib/pool/merkle'
import { deriveDeliveryPoint, encryptNote, ownerPubFromDeliveryPoint } from '@/lib/pool/carrier'
import { decodePoolAction, leToBig, scriptPushes } from '@/lib/pool/decode'
import { detectReceived, detectSpent, scanPool, scanPoolActions } from '@/lib/pool/scan'
import { getDefaultPool, getPools, poolAddress, poolScripthash, poolLockingBytecode } from '@/lib/pool/registry'
import { nullifierWalkData } from '@/lib/pool/smt'

/* The REAL chipnet registry entry (gate3-demo-pool). */
/* Pinned to the GATE3 entry explicitly — the chipnet array gains the new
   wallet-committed pool (which becomes getDefaultPool) and these gate3
   ground-truth assertions must keep testing gate3. */
const POOL = getPools('chipnet').find((p) => p.id === 'gate3-demo-pool')
const CATEGORY = BigInt('0x' + POOL.assetCategory)

/* The recipient wallet (test entropy — no real value). */
const RECIPIENT_ENTROPY = Uint8Array.from({ length: 32 }, () => 0xcd)

const DEPLOY_TXID = 'f5927a0bb67d4688976f98483828259057bd399522a587e66e3b1099a2ab7426' /* any non-action txid */

/* The mock chain's display txids — MUST be valid hex (they are byte-decoded
   when crafting each action's covenant-input outpoint). */
const TXID_A = 'aa' + '00'.repeat(30) + '01'
const TXID_B = 'aa' + '00'.repeat(30) + '02'
const TXID_C = 'aa' + '00'.repeat(30) + '03'

/* ---- byte / push helpers (mirror the covenant's unlocker encoding) ---- */

/* BigInt -> minimal LE VM-number bytes. */
const leNumBytes = (n) => {
    let v = BigInt(n)

    if (v === 0n) return new Uint8Array(0)

    const bytes = []

    while (v > 0n) {
        bytes.push(Number(v & 0xffn))
        v >>= 8n
    }

    return Uint8Array.from(bytes)
}

/* BigInt -> exactly 32 LE bytes. */
const le32 = (n) => {
    const hex = BigInt(n).toString(16).padStart(64, '0')

    return hexToBin(hex).reverse()
}

/* Data push (opcode + bytes) for lengths <= 75 (all our covenant args) —
   EXCEPT the redeem, handled below. */
const pushBytes = (bytes) => {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)

    const out = new Uint8Array(b.length + 1)

    out[0] = b.length
    out.set(b, 1)

    return out
}

/* A ~250-byte redeem-script push (the covenant-input profile: >200, <400). */
const REDEEM = new Uint8Array(250).fill(0xab)

const pushRedeem = () => new Uint8Array([0x4c, REDEEM.length, ...REDEEM])

const concatBytes = (...arrays) => {
    const total = arrays.reduce((sum, a) => sum + a.length, 0)
    const out = new Uint8Array(total)

    let offset = 0

    for (const a of arrays) {
        out.set(a, offset)
        offset += a.length
    }

    return out
}

/* The verifier genesis witness: n0/n1 markers at the fixed offsets. */
const genesisUnlocking = (n0, n1) => {
    const unlocking = new Uint8Array(1900)

    unlocking[1791] = 0x20
    unlocking.set(le32(n1), 1792)
    unlocking[1824] = 0x20
    unlocking.set(le32(n0), 1825)

    return unlocking
}

/* Build one action tx (raw hex) with the empirical unlocker layout:
   [isUnshield, publicValueAbs, newMerkleRoot, cm1, cm0, nf1, nf0, pad, redeem]. */
const buildActionTx = ({ prevoutTxid, args, n0, n1, carrierPacket }) => {
    const unlocking = concatBytes(
        pushBytes(leNumBytes(args.isUnshield)),
        pushBytes(leNumBytes(args.publicValueAbs)),
        pushBytes(le32(args.newMerkleRoot)),
        pushBytes(le32(args.cm1)),
        pushBytes(le32(args.cm0)),
        pushBytes(le32(args.nf1)),
        pushBytes(le32(args.nf0)),
        pushBytes(new Uint8Array(0)), /* the <pad> push (OP_0) */
        pushRedeem(),
    )

    const dummyInput = (hashByte) => ({
        outpointIndex: 0,
        outpointTransactionHash: new Uint8Array(32).fill(hashByte),
        sequenceNumber: 0xffffffff,
        unlockingBytecode: new Uint8Array([0x00]),
    })

    /* The 5 verifier inputs live at indexes 0-4 (the genesis step at 3),
       the covenant input rides last — mirroring the live 6/7-input shapes. */
    const inputs = [
        dummyInput(0xa1),
        dummyInput(0xa2),
        dummyInput(0xa3),
        { ...dummyInput(0xa4), unlockingBytecode: genesisUnlocking(n0, n1) },
        dummyInput(0xa5),
        {
            outpointIndex: 0,
            /* libauth stores the outpoint hash in DISPLAY order (verified
               live against chipnet txs — decode.js txidHexOf). */
            outpointTransactionHash: hexToBin(prevoutTxid),
            sequenceNumber: 0xffffffff,
            unlockingBytecode: unlocking,
        },
    ]

    const outputs = [
        { lockingBytecode: poolLockingBytecode(POOL), valueSatoshis: 1000n },
    ]

    if (carrierPacket) {
        outputs.push({ lockingBytecode: carrierPacket, valueSatoshis: 0n })
    }

    const tx = { version: 2, inputs, outputs, locktime: 0 }

    return binToHex(encodeTransactionBCH(tx))
}

/* Registry LE-hex root -> BigInt (the scan's leHexToBig). */
const leHexToBig = (hex) => leToBig(hexToBin(hex))

/* ---- the synthetic chain (built once in beforeAll) ---- */

let recipientKey
let recipientPoint
let deliveredNote
let deliveredCm
let deliveredNf
let carrierLocking
let chainA, chainB, chainC
let cluster
let scanResult

describe('pool note-detection scan', () => {
    beforeAll(async () => {
        /* Warm up the poseidon wasm singleton (noteCommitment/nullifier). */
        await getPoseidon()

        /* The recipient's identity + the delivered note + its carrier. */
        recipientKey = deriveSpendKey(RECIPIENT_ENTROPY)
        recipientPoint = await deriveDeliveryPoint(recipientKey)
        const ownerPub = await ownerPubFromDeliveryPoint(recipientPoint)

        deliveredNote = { value: 100n, ownerPub, rho: 777001n, r: 888001n }
        deliveredCm = await noteCommitment(
            deliveredNote.value, deliveredNote.ownerPub, deliveredNote.rho, deliveredNote.r)
        deliveredNf = await nullifier(recipientKey, deliveredNote.rho)

        const packet = await encryptNote(deliveredNote, recipientPoint)
        carrierLocking = new Uint8Array([
            0x6a, 0x4c, packet.length, ...packet,
        ])

        /* Action A — plain append, no carrier (genesis root as its n0). */
        const argsA = {
            isUnshield: 0n,
            publicValueAbs: 1000000n,
            newMerkleRoot: 1111111111111111111111111111111111111111111111111111111111111111111n,
            cm0: 101n,
            cm1: 102n,
            nf0: 201n,
            nf1: 202n,
        }
        const n0A = leHexToBig(POOL.genesisRootLE)
        const n1A = actionHash({ ...argsA, publicValueSign: argsA.isUnshield, assetCategory: CATEGORY })

        chainA = buildActionTx({
            prevoutTxid: DEPLOY_TXID,
            args: argsA,
            n0: n0A,
            n1: n1A,
        })

        /* The mock history's txids are arbitrary display forms — the chain
           is closed via the covenant inputs' OUTPOINTS (each action's prevout
           names the previous action's txid), not via txid hashing. */
        const txidOfA = TXID_A
        const txidOfB = TXID_B

        /* Action B — SAME height as A (outpoint chaining must order it after
           A) and delivers the recipient's note as cm0 with its carrier. */
        const argsB = {
            isUnshield: 0n,
            publicValueAbs: 0n,
            newMerkleRoot: 2222222222222222222222222222222222222222222222222222222222222222222n,
            cm0: deliveredCm,
            cm1: 104n,
            nf0: 203n,
            nf1: 204n,
        }
        const n1B = actionHash({ ...argsB, publicValueSign: argsB.isUnshield, assetCategory: CATEGORY })

        chainB = buildActionTx({
            prevoutTxid: txidOfA,
            args: argsB,
            n0: argsA.newMerkleRoot,
            n1: n1B,
            carrierPacket: carrierLocking,
        })

        /* Action C — spends the delivered note (nf0 = its nullifier). */
        const argsC = {
            isUnshield: 0n,
            publicValueAbs: 0n,
            newMerkleRoot: 3333333333333333333333333333333333333333333333333333333333333333333n,
            cm0: 105n,
            cm1: 106n,
            nf0: deliveredNf,
            nf1: 205n,
        }
        const n1C = actionHash({ ...argsC, publicValueSign: argsC.isUnshield, assetCategory: CATEGORY })

        chainC = buildActionTx({
            prevoutTxid: txidOfB,
            args: argsC,
            n0: argsB.newMerkleRoot,
            n1: n1C,
        })

        /* The mock cluster: covenant SCRIPTHASH history (B at the SAME height
           as A), raw txs by txid. The scripthash form is what Fulcrum
           accepts (registry.js poolScripthash — the address form is
           rejected with "Invalid address"). */
        const txs = { [txidOfA]: chainA, [txidOfB]: chainB, [TXID_C]: chainC }

        cluster = {
            getScripthashHistory: async (scripthash) => {
                cluster.lastScripthash = scripthash

                return [
                    { tx_hash: txidOfB, height: 330438 },
                    { tx_hash: TXID_C, height: 330439 },
                    { tx_hash: txidOfA, height: 330438 },
                ]
            },
            getTransaction: async (txid) => txs[txid],
        }

        scanResult = null /* filled by the tests via scanPoolActions */
    }, 120000)

    it('derives the gate3 covenant address (registry -> libauth round-trip)', () => {
        const address = poolAddress(POOL, 'chipnet')

        expect(address).toEqual('bchtest:pd7qc90mms2dmfplkp2qs3hqvksmh4q8deatv3equexranf4z5sgqkpahan65')

        const decoded = cashAddressToLockingBytecode(address)

        expect(typeof decoded).not.toEqual('string')
        expect(new Uint8Array(decoded.bytecode)).toEqual(poolLockingBytecode(POOL))
    })

    it('derives the gate3 SCRIPTHASH (the Fulcrum-queryable form — live-verified)', () => {
        /* Fulcrum REJECTS the hashType-bit address form with "Invalid
           address" (verified on mainnet + chipnet 2026-11-22) — the
           scripthash is the only working query form. This value was
           verified against the live chipnet servers. */
        expect(poolScripthash(POOL)).toEqual('438d21423bca86765a2c401823e565b73538bbed5c182763408285408ad21191')
    })

    it('decodes a synthetic action: args, carriers, proven n0/n1', () => {
        const decoded = decodePoolAction(chainB)

        expect(decoded).not.toBeNull()
        expect(decoded.covenantInputIndex).toEqual(5)
        expect(decoded.prevoutTxid).toEqual(TXID_A)
        expect(decoded.args.isUnshield).toEqual(0n)
        expect(decoded.args.cm0).toEqual(deliveredCm)
        expect(decoded.args.newMerkleRoot).toEqual(2222222222222222222222222222222222222222222222222222222222222222222n)
        expect(decoded.carriers.length).toEqual(1)
        expect(decoded.proven.merkleRoot).toEqual(1111111111111111111111111111111111111111111111111111111111111111111n)
    })

    it('scans the chain: outpoint order (same-block), leaf bases, tip', async () => {
        scanResult = await scanPoolActions({ cluster, pool: POOL, networkId: 'chipnet' })

        /* The pool's SCRIPTHASH (from the registry) is what was queried —
           live-verified gate3 scripthash (2026-11-22). */
        expect(cluster.lastScripthash).toEqual('438d21423bca86765a2c401823e565b73538bbed5c182763408285408ad21191')

        /* Outpoint-chained order — NOT the history's shuffled order. */
        expect(scanResult.actions.map((a) => a.txid)).toEqual([TXID_A, TXID_B, TXID_C])

        /* Global leaf indices: genesis seeded 2 leaves (registry). */
        expect(scanResult.actions[0].leafIndexBase).toEqual(2)
        expect(scanResult.actions[1].leafIndexBase).toEqual(4)
        expect(scanResult.actions[2].leafIndexBase).toEqual(6)

        expect(scanResult.tipHeight).toEqual(330439)
        expect(scanResult.tipTxid).toEqual(TXID_C)
    })

    it('detects the received note (carrier -> trial-decrypt -> cm0 match)', async () => {
        const received = await detectReceived({
            actions: scanResult.actions,
            spendKey: recipientKey,
            genesisLeafCount: POOL.genesisLeafCount,
        })

        expect(received.length).toEqual(1)

        const note = received[0]

        expect(note.cm).toEqual(deliveredCm)
        expect(note.value).toEqual(deliveredNote.value)
        expect(note.rho).toEqual(deliveredNote.rho)
        expect(note.r).toEqual(deliveredNote.r)
        expect(note.ownerPub).toEqual(deliveredNote.ownerPub)
        /* cm0 of action B = global leaf 4 (genesis 2 + action A's 2). */
        expect(note.leafIndex).toEqual(4)
        expect(note.txid).toEqual(TXID_B)

        /* The nullifier key model: nf matches nullifier(spendKey, rho). */
        expect(note.nf).toEqual(deliveredNf)
    })

    it('detects the on-chain spend of the received note', async () => {
        const received = await detectReceived({
            actions: scanResult.actions,
            spendKey: recipientKey,
            genesisLeafCount: POOL.genesisLeafCount,
        })

        const spent = await detectSpent({ actions: scanResult.actions, notes: received })

        expect(spent).toEqual([deliveredNf.toString(10)])
    })

    it('scanPool orchestrator: received + spent in one pass', async () => {
        const result = await scanPool({
            cluster,
            pool: POOL,
            networkId: 'chipnet',
            spendKey: recipientKey,
            notes: [],
        })

        expect(result.received.length).toEqual(1)
        expect(result.received[0].leafIndex).toEqual(4)
        expect(result.actions.length).toEqual(3)
    })

    it('B3 — the note-mailbox seam: an off-chain packet delivers the IDENTICAL note', async () => {
        /* A variant action B WITHOUT the on-chain carrier output — the
           note's ONLY delivery channel is the mailbox packet. Same args as
           the fixture's B (the actionHash/carrier are unrelated). */
        const argsBv = {
            isUnshield: 0n,
            publicValueAbs: 0n,
            newMerkleRoot: 2222222222222222222222222222222222222222222222222222222222222222222n,
            cm0: deliveredCm,
            cm1: 104n,
            nf0: 203n,
            nf1: 204n,
        }

        const chainBv = buildActionTx({
            prevoutTxid: TXID_A,
            args: argsBv,
            n0: 1111111111111111111111111111111111111111111111111111111111111111111n,
            n1: actionHash({ ...argsBv, publicValueSign: argsBv.isUnshield, assetCategory: CATEGORY }),
        })

        const txsVariant = { [TXID_A]: chainA, [TXID_B]: chainBv, [TXID_C]: chainC }
        const clusterVariant = {
            getScripthashHistory: cluster.getScripthashHistory,
            getTransaction: async (txid) => txsVariant[txid],
        }

        /* The packet (a REAL NP01 ciphertext for the recipient). */
        const packet = await encryptNote(deliveredNote, recipientPoint)

        /* The RIGHT action txid: the packet attaches + the note lands with
           the SAME leaf index + nullifier as the on-chain-carrier path. */
        const good = await scanPool({
            cluster: clusterVariant,
            pool: POOL,
            networkId: 'chipnet',
            spendKey: recipientKey,
            notes: [],
            mailboxPackets: [{ packet, actionTxid: TXID_B }],
        })

        expect(good.received).toHaveLength(1)
        expect(good.received[0].cm).toEqual(deliveredCm)
        expect(good.received[0].value).toEqual(100n)
        expect(good.received[0].leafIndex).toEqual(4)
        expect(good.received[0].nf).toEqual(deliveredNf)

        /* The WRONG action txid: the packet is not attached -> the scan
           sees no delivery (the recipient's later re-scan of the SAME event
           still works — the real mailbox event's action tag comes from the
           SENDER's submit, so it always matches a real action). */
        const bad = await scanPool({
            cluster: clusterVariant,
            pool: POOL,
            networkId: 'chipnet',
            spendKey: recipientKey,
            notes: [],
            mailboxPackets: [{ packet, actionTxid: 'ff'.repeat(32) }],
        })

        expect(bad.received).toHaveLength(0)
    })

    it('throws on an actionHash mismatch (a tampered action)', async () => {
        /* Rebuild action B with a WRONG proven n1 — the recomputed actionHash
           no longer matches, exactly like a forged/faulty chain would. */
        const badB = buildActionTx({
            prevoutTxid: TXID_A,
            args: {
                isUnshield: 0n,
                publicValueAbs: 0n,
                newMerkleRoot: 2222222222222222222222222222222222222222222222222222222222222222222n,
                cm0: deliveredCm,
                cm1: 104n,
                nf0: 203n,
                nf1: 204n,
            },
            n0: 1111111111111111111111111111111111111111111111111111111111111111111n,
            n1: 987654321n, /* wrong */
            carrierPacket: carrierLocking,
        })

        const badCluster = {
            getScripthashHistory: async () => [{ tx_hash: TXID_A, height: 1 }, { tx_hash: TXID_B, height: 2 }],
            getTransaction: async (txid) => ({ [TXID_A]: chainA, [TXID_B]: badB })[txid],
        }

        await expect(scanPoolActions({ cluster: badCluster, pool: POOL, networkId: 'chipnet' }))
            .rejects.toThrow('actionHash mismatch')
    })

    it('throws on a root-continuity break (a gapped history)', async () => {
        /* Action C whose n0 does not follow B's newMerkleRoot. */
        const badC = buildActionTx({
            prevoutTxid: TXID_B,
            args: {
                isUnshield: 0n,
                publicValueAbs: 0n,
                newMerkleRoot: 3333333333333333333333333333333333333333333333333333333333333333333n,
                cm0: 105n,
                cm1: 106n,
                nf0: deliveredNf,
                nf1: 205n,
            },
            n0: 55555n, /* wrong: not B's newMerkleRoot */
            n1: actionHash({
                nf0: deliveredNf, nf1: 205n, cm0: 105n, cm1: 106n,
                publicValueAbs: 0n, publicValueSign: 0n, assetCategory: CATEGORY,
                newMerkleRoot: 3333333333333333333333333333333333333333333333333333333333333333333n,
            }),
        })

        const badCluster = {
            getScripthashHistory: async () => [{ tx_hash: TXID_A, height: 1 }, { tx_hash: TXID_B, height: 2 }, { tx_hash: TXID_C, height: 3 }],
            getTransaction: async (txid) => ({ [TXID_A]: chainA, [TXID_B]: chainB, [TXID_C]: badC })[txid],
        }

        await expect(scanPoolActions({ cluster: badCluster, pool: POOL, networkId: 'chipnet' }))
            .rejects.toThrow('root-continuity break')
    })

    it('scriptPushes parses OP_0, direct, PUSHDATA1/2 and small-int pushes', () => {
        const pushes = scriptPushes(new Uint8Array([
            0x00,             /* OP_0 — empty push */
            0x02, 0xaa, 0xbb, /* direct 2-byte push */
            0x4c, 0x03, 0x01, 0x02, 0x03, /* PUSHDATA1 */
            0x51,             /* OP_1 — small-int push */
        ]))

        expect(pushes.length).toEqual(4)
        expect(pushes[0].length).toEqual(0)
        expect(Array.from(pushes[1])).toEqual([0xaa, 0xbb])
        expect(Array.from(pushes[2])).toEqual([0x01, 0x02, 0x03])
        expect(Array.from(pushes[3])).toEqual([1])
    })
})

/* ---- edge + guard-path coverage (each named for the line it covers) ---- */

describe('pool scan edge + guard paths', () => {
    beforeAll(async () => {
        await getPoseidon()
    }, 60000)

    it('scriptPushes: PUSHDATA2 (0x4d) and non-push opcodes', () => {
        const pushes = scriptPushes(new Uint8Array([
            0x4d, 0x03, 0x00, 0x01, 0x02, 0x03, /* PUSHDATA2 len=3 (LE16) */
            0x94, /* OP_DROP-ish non-push -> null item, consumed */
            0x52, /* OP_2 */
        ]))

        expect(Array.from(pushes[0])).toEqual([0x01, 0x02, 0x03])
        expect(pushes[1]).toBeNull()
        expect(Array.from(pushes[2])).toEqual([2])
    })

    it('leToBig: empty bytes are the VM number 0', () => {
        expect(leToBig(new Uint8Array(0))).toEqual(0n)
        expect(leToBig(null)).toEqual(0n)
    })

    it('decodePoolAction throws on undecodable bytes', () => {
        expect(() => decodePoolAction('deadbeef')).toThrow('not a transaction')
    })

    it('decodePoolAction returns null for a non-action tx (no covenant input)', () => {
        const tx = {
            version: 2,
            inputs: [{ outpointIndex: 0, outpointTransactionHash: new Uint8Array(32), sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array([0x51]) }],
            outputs: [{ lockingBytecode: new Uint8Array(35), valueSatoshis: 546n }],
            locktime: 0,
        }

        expect(decodePoolAction(binToHex(encodeTransactionBCH(tx)))).toBeNull()
    })

    it('decodePoolAction throws when no verifier genesis marker exists', () => {
        /* A covenant-shaped input but NO genesis witness anywhere. */
        const unlocking = concatBytes(
            pushBytes(leNumBytes(0n)),
            pushBytes(leNumBytes(250n)),
            pushBytes(le32(1111111111111111111111111111111111111111111111111111111111111111111n)),
            pushBytes(le32(102n)),
            pushBytes(le32(101n)),
            pushBytes(le32(202n)),
            pushBytes(le32(201n)),
            pushBytes(new Uint8Array(0)),
            pushRedeem(),
        )

        const tx = {
            version: 2,
            inputs: [{ outpointIndex: 0, outpointTransactionHash: new Uint8Array(32), sequenceNumber: 0xffffffff, unlockingBytecode: unlocking }],
            outputs: [{ lockingBytecode: new Uint8Array(35), valueSatoshis: 546n }],
            locktime: 0,
        }

        expect(() => decodePoolAction(binToHex(encodeTransactionBCH(tx)))).toThrow('no verifier genesis input')
    })

    it('registry: getPools/getDefaultPool lookups + malformed pool throws', () => {
        /* the mainnet list: the legacy demo pool + the v4h Preview v0 pool. */
        expect(getPools('mainnet').length).toEqual(2)
        expect(getDefaultPool('mainnet').id).toEqual('mainnet-role2-pool4-v4h')
        expect(getPools('nonexistent-network')).toEqual([])
        expect(getDefaultPool('nonexistent-network')).toBeNull()

        expect(() => poolAddress({ id: 'bogus', lockingBytecode: 'deadbeef' }, 'chipnet'))
            .toThrow('cannot encode')
    })

    it('scan: empty history -> zero actions, null tip', async () => {
        const emptyCluster = { getScripthashHistory: async () => [], getTransaction: async () => { throw new Error('unused') } }

        const result = await scanPoolActions({ cluster: emptyCluster, pool: POOL, networkId: 'chipnet' })

        expect(result.actions).toEqual([])
        expect(result.tipHeight).toEqual(0)
        expect(result.tipTxid).toBeNull()
    })

    it('scan: two chain heads (forked history) -> throws', async () => {
        /* Both actions spend non-action prevouts -> two heads. */
        const makeArgs = (seed) => ({
            isUnshield: 0n, publicValueAbs: 0n,
            newMerkleRoot: BigInt(seed) * 1000000n + 7n,
            cm0: BigInt(seed), cm1: BigInt(seed) + 1n,
            nf0: BigInt(seed) + 2n, nf1: BigInt(seed) + 3n,
        })

        const mk = (seed, prevout, n0) => {
            const args = makeArgs(seed)
            const n1 = actionHash({ ...args, publicValueSign: 0n, assetCategory: CATEGORY })
            return buildActionTx({ prevoutTxid: prevout, args, n0, n1 })
        }

        const forkCluster = {
            getScripthashHistory: async () => [{ tx_hash: TXID_A, height: 1 }, { tx_hash: TXID_B, height: 2 }],
            getTransaction: async (txid) => ({ [TXID_A]: mk(11n, DEPLOY_TXID, leHexToBig(POOL.genesisRootLE)), [TXID_B]: mk(22n, DEPLOY_TXID, leHexToBig(POOL.genesisRootLE)) })[txid],
        }

        await expect(scanPoolActions({ cluster: forkCluster, pool: POOL, networkId: 'chipnet' }))
            .rejects.toThrow('chain head')
    })

    it('scan: orphan action (history gap) -> throws', async () => {
        const makeArgs = (seed) => ({
            isUnshield: 0n, publicValueAbs: 0n,
            newMerkleRoot: BigInt(seed) * 1000000n + 7n,
            cm0: BigInt(seed), cm1: BigInt(seed) + 1n,
            nf0: BigInt(seed) + 2n, nf1: BigInt(seed) + 3n,
        })

        const mk = (seed, prevout, n0) => {
            const args = makeArgs(seed)
            const n1 = actionHash({ ...args, publicValueSign: 0n, assetCategory: CATEGORY })
            return buildActionTx({ prevoutTxid: prevout, args, n0, n1 })
        }

        const genesisRoot = leHexToBig(POOL.genesisRootLE)

        const orphanCluster = {
            getScripthashHistory: async () => [{ tx_hash: TXID_A, height: 1 }, { tx_hash: TXID_B, height: 2 }, { tx_hash: TXID_C, height: 3 }],
            getTransaction: async (txid) => ({
                [TXID_A]: mk(11n, DEPLOY_TXID, genesisRoot),
                /* B forks off A too (same prevout) -> the chain map keeps
                   only ONE child of A; the OTHER becomes the orphan. */
                [TXID_B]: mk(22n, TXID_A, 1100007n),
                [TXID_C]: mk(33n, TXID_A, 1100007n),
            })[txid],
        }

        await expect(scanPoolActions({ cluster: orphanCluster, pool: POOL, networkId: 'chipnet' }))
            .rejects.toThrow('broken action chain')
    })

    it('detectReceived maps a cm1 delivery to leafIndex base + 1', async () => {
        const recipientKey2 = deriveSpendKey(Uint8Array.from({ length: 32 }, () => 0xcd))
        const recipientPoint2 = await deriveDeliveryPoint(recipientKey2)
        const ownerPub2 = await ownerPubFromDeliveryPoint(recipientPoint2)

        const note2 = { value: 55n, ownerPub: ownerPub2, rho: 999001n, r: 999002n }
        const cm2 = await noteCommitment(55n, ownerPub2, 999001n, 999002n)

        const packet2 = await encryptNote(note2, recipientPoint2)
        const carrier2 = new Uint8Array([0x6a, 0x4c, packet2.length, ...packet2])

        const args = {
            isUnshield: 0n, publicValueAbs: 0n,
            newMerkleRoot: 4444444444444444444444444444444444444444444444444444444444444444n,
            cm0: 999n, cm1: cm2, /* delivered as cm1 this time */
            nf0: 1n, nf1: 2n,
        }

        const n1 = actionHash({ ...args, publicValueSign: 0n, assetCategory: CATEGORY })

        const actionTx = buildActionTx({ prevoutTxid: DEPLOY_TXID, args, n0: leHexToBig(POOL.genesisRootLE), n1, carrierPacket: carrier2 })

        const decoded = decodePoolAction(actionTx)

        const actions = [{ txid: TXID_A, height: 1, leafIndexBase: 2, ...decoded }]

        const received = await detectReceived({ actions, spendKey: recipientKey2, genesisLeafCount: 2 })

        expect(received.length).toEqual(1)
        expect(received[0].cm).toEqual(cm2)
        expect(received[0].leafIndex).toEqual(3) /* base 2 + cm1 offset 1 */
    })

    it('detectSpent skips already-spent and incomplete notes', async () => {
        const actions = [{ args: { nf0: 5n, nf1: 6n } }]

        const spent = await detectSpent({
            actions,
            notes: [
                { spent: true, nk: 1n, rho: 1n }, /* skipped: already spent */
                { nk: undefined, rho: 1n },        /* skipped: incomplete */
            ],
        })

        expect(spent).toEqual([])
    })

    it('scan: creation txs (no covenant input) are collected, not actions', async () => {
        /* The DEPLOY-shaped tx: touches the covenant address but has no
           covenant input -> a state CREATION, recorded as such, and the tip. */
        const creationTx = binToHex(encodeTransactionBCH({
            version: 2,
            inputs: [{ outpointIndex: 0, outpointTransactionHash: new Uint8Array(32), sequenceNumber: 0xffffffff, unlockingBytecode: new Uint8Array([0x51]) }],
            outputs: [{ lockingBytecode: poolLockingBytecode(POOL), valueSatoshis: 1000n }],
            locktime: 0,
        }))

        const creationCluster = {
            getScripthashHistory: async () => [{ tx_hash: DEPLOY_TXID, height: 330400 }],
            getTransaction: async () => creationTx,
        }

        const result = await scanPoolActions({ cluster: creationCluster, pool: POOL, networkId: 'chipnet' })

        expect(result.actions).toEqual([])
        expect(result.creationTxids).toEqual([DEPLOY_TXID])
        expect(result.tipTxid).toEqual(DEPLOY_TXID)
        expect(result.tipHeight).toEqual(330400)
    })

    it('scan: a height regression along the chain -> throws', async () => {
        const makeArgs = (seed) => ({
            isUnshield: 0n, publicValueAbs: 0n,
            newMerkleRoot: BigInt(seed) * 1000000n + 7n,
            cm0: BigInt(seed), cm1: BigInt(seed) + 1n,
            nf0: BigInt(seed) + 2n, nf1: BigInt(seed) + 3n,
        })

        const mk = (seed, prevout, n0) => {
            const args = makeArgs(seed)
            const n1 = actionHash({ ...args, publicValueSign: 0n, assetCategory: CATEGORY })
            return buildActionTx({ prevoutTxid: prevout, args, n0, n1 })
        }

        const genesisRoot = leHexToBig(POOL.genesisRootLE)

        const regressionCluster = {
            /* B spends A's output but claims an EARLIER height. */
            getScripthashHistory: async () => [{ tx_hash: TXID_B, height: 1 }, { tx_hash: TXID_A, height: 2 }],
            getTransaction: async (txid) => ({
                [TXID_A]: mk(11n, DEPLOY_TXID, genesisRoot),
                [TXID_B]: mk(22n, TXID_A, 1100007n),
            })[txid],
        }

        await expect(scanPoolActions({ cluster: regressionCluster, pool: POOL, networkId: 'chipnet' }))
            .rejects.toThrow('precedes its prevout')
    })

    it('detectReceived: a carrier addressed to another wallet is skipped', async () => {
        const otherKey = deriveSpendKey(Uint8Array.from({ length: 32 }, () => 0x5a))
        const otherPoint = await deriveDeliveryPoint(otherKey)
        const otherOwnerPub = await ownerPubFromDeliveryPoint(otherPoint)

        const otherPacket = await encryptNote(
            { value: 9n, ownerPub: otherOwnerPub, rho: 1n, r: 2n }, otherPoint)
        const otherCarrier = new Uint8Array([0x6a, 0x4c, otherPacket.length, ...otherPacket])

        const args = {
            isUnshield: 0n, publicValueAbs: 0n,
            newMerkleRoot: 5555555555555555555555555555555555555555555555555555555555555555n,
            cm0: 900n, cm1: 901n,
            nf0: 1n, nf1: 2n,
        }

        const n1 = actionHash({ ...args, publicValueSign: 0n, assetCategory: CATEGORY })

        const actionTx = buildActionTx({
            prevoutTxid: DEPLOY_TXID, args, n0: leHexToBig(POOL.genesisRootLE), n1,
            carrierPacket: otherCarrier,
        })

        const actions = [{ txid: TXID_A, height: 1, leafIndexBase: 2, ...decodePoolAction(actionTx) }]

        /* Trial-decrypting with the RECIPIENT test key: no match -> []. */
        const received = await detectReceived({
            actions,
            spendKey: deriveSpendKey(Uint8Array.from({ length: 32 }, () => 0xcd)),
            genesisLeafCount: 2,
        })

        expect(received).toEqual([])
    })
})

/* ── the R3 append-recompute stopgap (2026-11-27) ─────────────────────────
 *
 * scan.js gained the APPEND RECOMPUTE: on pools whose full leaf list is
 * reconstructible (published genesisLeaves), each action's carrier
 * newMerkleRoot must equal computeRoot(leaves ‖ its own cms) — the exact
 * witness formula in prover.js buildPoolWitness*. A planted root (the
 * R3-FREE-NEWROOT drain, hushyourmoney/docs/POOL-UPDATE-NITO-2026-11-27.md
 * §1 — an honest actionHash over a FAKE tree) now HALTS the scan.
 *
 * The gate3 entry (POOL above) publishes NO genesisLeaves — its scan keeps
 * the check disabled (the HOLES path), which is why the arbitrary-root chain
 * in the describes above still passes. This pool entry ARMS the check. */
describe('pool scan — the R3 append-recompute stopgap', () => {
    const SEED_G0 = 900001n
    const SEED_G1 = 900002n
    const CM0 = 1111111301n
    const CM1 = 1111111307n

    /* A pool entry WITH published seed leaves (same category + locking as
       gate3, so buildActionTx/poolLockingBytecode keep working). */
    const SEEDED_POOL = {
        ...POOL,
        id: 'r3-seeded-test-pool',
        genesisLeaves: [SEED_G0.toString(), SEED_G1.toString()],
        genesisLeafCount: 2,
    }

    let honestArgs
    let honestChain
    let plantedChain
    let plantedRoot

    const oneActionCluster = (txid, hex) => ({
        getScripthashHistory: async () => [{ tx_hash: txid, height: 330438 }],
        getTransaction: async (id) => (id === txid ? hex : undefined),
    })

    beforeAll(async () => {
        /* Warm the poseidon singleton (computeRoot needs it). */
        await getPoseidon()

        /* The HONEST action: newMerkleRoot = the real append. */
        honestArgs = {
            isUnshield: 0n,
            publicValueAbs: 0n,
            cm0: CM0,
            cm1: CM1,
            nf0: 2222222303n,
            nf1: 2222222309n,
            newMerkleRoot: await computeRoot([SEED_G0, SEED_G1, CM0, CM1]),
        }

        const n0 = leHexToBig(SEEDED_POOL.genesisRootLE)
        const n1 = actionHash({ ...honestArgs, publicValueSign: honestArgs.isUnshield, assetCategory: CATEGORY })

        honestChain = buildActionTx({ prevoutTxid: DEPLOY_TXID, args: honestArgs, n0, n1 })

        /* The PLANT (R3 "action A"): the REAL leaves + the action's own
           commitments + TWO FABRICATED NOTES (one carrying the pool's
           entire balance — the drain's forged note), with an HONEST
           actionHash over the fake tree. Continuity + actionHash BOTH pass
           for this action; only the append recompute catches it. */
        plantedRoot = await computeRoot([SEED_G0, SEED_G1, CM0, CM1, 3333333301n, 3333333307n])

        const plantedArgs = { ...honestArgs, newMerkleRoot: plantedRoot }
        const n1Planted = actionHash({ ...plantedArgs, publicValueSign: plantedArgs.isUnshield, assetCategory: CATEGORY })

        plantedChain = buildActionTx({ prevoutTxid: DEPLOY_TXID, args: plantedArgs, n0, n1: n1Planted })
    }, 120000)

    it('accepts an HONEST action — the recomputed append matches the carrier root', async () => {
        const cluster = oneActionCluster(TXID_A, honestChain)
        const result = await scanPoolActions({ cluster, pool: SEEDED_POOL, networkId: 'chipnet' })

        expect(result.actions).toHaveLength(1)
        expect(result.actions[0].txid).toEqual(TXID_A)
        expect(result.actions[0].leafIndexBase).toEqual(2)
        expect(result.actions[0].args.newMerkleRoot).toEqual(honestArgs.newMerkleRoot)
    })

    it('REJECTS a planted root (R3-FREE-NEWROOT) and HALTS the scan', async () => {
        const cluster = oneActionCluster(TXID_A, plantedChain)

        /* The plant satisfies actionHash + continuity — the append
           recompute is the only check that fires. */
        await expect(scanPoolActions({ cluster, pool: SEEDED_POOL, networkId: 'chipnet' }))
            .rejects.toThrow(/APPEND mismatch .* R3-FREE-NEWROOT/)
    })

    it('keeps the check DISABLED for pools with unpublished seed leaves (the legacy holes path)', async () => {
        /* The SAME planted root against the gate3 entry (no genesisLeaves):
           the holes disable the append recompute, and the scan still
           completes (the pre-stopgap behavior — note detection only). */
        const cluster = oneActionCluster(TXID_A, plantedChain)
        const result = await scanPoolActions({ cluster, pool: POOL, networkId: 'chipnet' })

        expect(result.actions).toHaveLength(1)
        expect(result.actions[0].args.newMerkleRoot).toEqual(plantedRoot)
    })
})

/* ---- the v3 (pool4) SMT reconstruction (the scan contract §6 steps 4–6) ---- */

describe('pool scan — the v3 nullifier-SMT reconstruction', () => {
    const V3POOL = getPools('chipnet').find((p) => p.variant === 'v3')

    /* The 642-B STMT (the state input's push): n0 at 256, n1 at 288 — the
       fields are CONTIGUOUS raw LE bytes (no markers between; decode slices
       them at the fixed offsets). */
    const stmtOf = (n0, n1) => {
        const stmt = new Uint8Array(642)
        stmt.set(le32(n0), 256)
        stmt.set(le32(n1), 288)
        return stmt
    }

    /* The 201-B carrier payload: nf0|nf1|cm0|cm1|cm2|newRoot|pv(8LE)|sign. */
    const carrierOf = (args) => concatBytes(
        le32(args.nf0), le32(args.nf1), le32(args.cm0), le32(args.cm1), le32(args.cm2),
        le32(args.newMerkleRoot), le32(args.publicValueAbs).slice(0, 8), new Uint8Array([Number(args.isUnshield)]),
    )

    /* One v3 action tx (raw hex): 5 inputs (fuel/fuel/STATE-STMT/walkA/walkB),
       out0 the 201-B carrier, out1 the new state NFT (64-B commitment + FT). */
    const buildV3ActionTx = ({ txid, prevoutTxid, args, n0, n1, stateCommitment, balance }) => {
        const dummy = (hashByte) => ({
            outpointIndex: 0,
            outpointTransactionHash: new Uint8Array(32).fill(hashByte),
            sequenceNumber: 0xffffffff,
            unlockingBytecode: new Uint8Array([0x00]),
        })
        const stmt = stmtOf(n0, n1)
        const stmtPush = new Uint8Array([0x4d, 0x82, 0x02, ...stmt]) /* PUSHDATA2 <642 LE> */

        const inputs = [
            dummy(0xa1),
            dummy(0xa2),
            { outpointIndex: 0, outpointTransactionHash: hexToBin(txid === prevoutTxid ? '00'.repeat(32) : txid), sequenceNumber: 0xffffffff, unlockingBytecode: stmtPush },
            dummy(0xa3),
            dummy(0xa4),
        ]
        /* The state input's PREVOUT drives the chain order (display order). */
        inputs[2] = { ...inputs[2], outpointTransactionHash: hexToBin(prevoutTxid === DEPLOY_TXID ? DEPLOY_TXID : prevoutTxid) }

        const payload = carrierOf(args)
        const outputs = [
            { lockingBytecode: new Uint8Array([0x6a, 0x4c, payload.length, ...payload]), valueSatoshis: 0n },
            {
                lockingBytecode: poolLockingBytecode(V3POOL),
                valueSatoshis: 10000n,
                token: { category: hexToBin(V3POOL.assetCategory), amount: BigInt(balance), nft: { capability: 'mutable', commitment: hexToBin(stateCommitment) } },
            },
        ]

        return binToHex(encodeTransactionBCH({ version: 2, inputs, outputs, locktime: 0 }))
    }

    /* The honest 2-action chain: a DEPOSIT 1,000 (the empty genesis → 3
       fresh cms; the walk inserts nf0/nf1 from the EMPTY set) → a TRANSFER. */
    const mkArgs = async (leaves, nf0, nf1, pv, sign, out) => {
        const cm = out /* the three out-cms ARE the leaves appended */
        return {
            nf0, nf1,
            cm0: cm[0], cm1: cm[1], cm2: cm[2],
            newMerkleRoot: await computeRoot([...leaves, ...cm]),
            publicValueAbs: pv, isUnshield: sign,
        }
    }

    const v3Cluster = (hexes) => ({
        getScripthashHistory: async () => hexes.map((_, i) => ({ tx_hash: TXIDS[i], height: 349150 + i })),
        getTransaction: async (id) => hexes[TXIDS.indexOf(id)],
    })

    const TXIDS = ['bb' + '00'.repeat(30) + '01', 'bb' + '00'.repeat(30) + '02', 'bb' + '00'.repeat(30) + '03']

    beforeAll(async () => {
        await getPoseidon()
    })

    it('VERIFIES the honest v3 chain end-to-end (the SMT steps 4–6 + the balance)', async () => {
        /* action 1 — DEPOSIT 1,000 from the EMPTY genesis. */
        const cmA = [9100001n, 9100002n, 9100003n]
        const argsA = await mkArgs([], 9001001n, 9001002n, 1000n, 0n, cmA)
        const cat = BigInt('0x' + V3POOL.assetCategory)
        const n1A = actionHash3out({ ...argsA, publicValueSign: 0n, assetCategory: cat, newMerkleRoot: argsA.newMerkleRoot })
        const n0A = leHexToBig(V3POOL.genesisRootLE)
        const walkA1 = nullifierWalkData({ spentKeys: [], kA: binToHex(le32(argsA.nf0)), kB: binToHex(le32(argsA.nf1)) })
        const commitA = binToHex(le32(argsA.newMerkleRoot)) + walkA1.finalNullRoot

        /* action 2 — TRANSFER (spends notes; appends 3 more). */
        const cmB = [9200001n, 9200002n, 9200003n]
        const argsB = await mkArgs(cmA, 9002001n, 9002002n, 0n, 0n, cmB)
        const n1B = actionHash3out({ ...argsB, publicValueSign: 0n, assetCategory: cat, newMerkleRoot: argsB.newMerkleRoot })
        const walkB1 = nullifierWalkData({ spentKeys: [binToHex(le32(argsA.nf0)), binToHex(le32(argsA.nf1))], kA: binToHex(le32(argsB.nf0)), kB: binToHex(le32(argsB.nf1)) })
        const commitB = binToHex(le32(argsB.newMerkleRoot)) + walkB1.finalNullRoot

        const hexA = buildV3ActionTx({ txid: TXIDS[0], prevoutTxid: DEPLOY_TXID, args: argsA, n0: n0A, n1: n1A, stateCommitment: commitA, balance: 1000n })
        const hexB = buildV3ActionTx({ txid: TXIDS[1], prevoutTxid: TXIDS[0], args: argsB, n0: argsA.newMerkleRoot, n1: n1B, stateCommitment: commitB, balance: 1000n })

        const result = await scanPoolActions({ cluster: v3Cluster([hexA, hexB]), pool: V3POOL, networkId: 'chipnet' })

        expect(result.actions).toHaveLength(2)
        expect(result.actions[0].leafIndexBase).toBe(0)
        expect(result.actions[1].leafIndexBase).toBe(3)
        expect(result.actions[0].stateCommitment).toBe(commitA)
    })

    it('REJECTS a state commitment whose nullSetRoot half is not the walked finalNullRoot', async () => {
        const cmA = [9100001n, 9100002n, 9100003n]
        const argsA = await mkArgs([], 9001001n, 9001002n, 1000n, 0n, cmA)
        const cat = BigInt('0x' + V3POOL.assetCategory)
        const n1A = actionHash3out({ ...argsA, publicValueSign: 0n, assetCategory: cat, newMerkleRoot: argsA.newMerkleRoot })
        const n0A = leHexToBig(V3POOL.genesisRootLE)
        /* the FORGED second half — not the walked root */
        const badCommit = binToHex(le32(argsA.newMerkleRoot)) + 'ee'.repeat(32)
        const hexA = buildV3ActionTx({ txid: TXIDS[0], prevoutTxid: DEPLOY_TXID, args: argsA, n0: n0A, n1: n1A, stateCommitment: badCommit, balance: 1000n })

        await expect(scanPoolActions({ cluster: v3Cluster([hexA]), pool: V3POOL, networkId: 'chipnet' }))
            .rejects.toThrow(/SMT mismatch .* second half/)
    })

    it("REJECTS a replayed nullifier (the walk 0-walk guard, client-side)", async () => {
        const cmA = [9100001n, 9100002n, 9100003n]
        const argsA = await mkArgs([], 9001001n, 9001002n, 1000n, 0n, cmA)
        const cat = BigInt('0x' + V3POOL.assetCategory)
        const n1A = actionHash3out({ ...argsA, publicValueSign: 0n, assetCategory: cat, newMerkleRoot: argsA.newMerkleRoot })
        const n0A = leHexToBig(V3POOL.genesisRootLE)
        const walkA1 = nullifierWalkData({ spentKeys: [], kA: binToHex(le32(argsA.nf0)), kB: binToHex(le32(argsA.nf1)) })
        const commitA = binToHex(le32(argsA.newMerkleRoot)) + walkA1.finalNullRoot
        const hexA = buildV3ActionTx({ txid: TXIDS[0], prevoutTxid: DEPLOY_TXID, args: argsA, n0: n0A, n1: n1A, stateCommitment: commitA, balance: 1000n })

        /* action 2 REPLAYS action 1's nf0 — a fresh cm set + honest hash, but
           the walk throws before anything else. */
        const cmB = [9200001n, 9200002n, 9200003n]
        const argsB = await mkArgs(cmA, argsA.nf0, 9002002n, 0n, 0n, cmB)
        const n1B = actionHash3out({ ...argsB, publicValueSign: 0n, assetCategory: cat, newMerkleRoot: argsB.newMerkleRoot })
        const hexB = buildV3ActionTx({ txid: TXIDS[1], prevoutTxid: TXIDS[0], args: argsB, n0: argsA.newMerkleRoot, n1: n1B, stateCommitment: commitA, balance: 1000n })

        await expect(scanPoolActions({ cluster: v3Cluster([hexA, hexB]), pool: V3POOL, networkId: 'chipnet' }))
            .rejects.toThrow(/already spent/)
    })

    it('REJECTS a balance that does not follow balance + pv − 2·sign·pv', async () => {
        const cmA = [9100001n, 9100002n, 9100003n]
        const argsA = await mkArgs([], 9001001n, 9001002n, 1000n, 0n, cmA)
        const cat = BigInt('0x' + V3POOL.assetCategory)
        const n1A = actionHash3out({ ...argsA, publicValueSign: 0n, assetCategory: cat, newMerkleRoot: argsA.newMerkleRoot })
        const n0A = leHexToBig(V3POOL.genesisRootLE)
        const walkA1 = nullifierWalkData({ spentKeys: [], kA: binToHex(le32(argsA.nf0)), kB: binToHex(le32(argsA.nf1)) })
        const commitA = binToHex(le32(argsA.newMerkleRoot)) + walkA1.finalNullRoot
        /* out1 carries 777 FT — the deposit says 1,000 */
        const hexA = buildV3ActionTx({ txid: TXIDS[0], prevoutTxid: DEPLOY_TXID, args: argsA, n0: n0A, n1: n1A, stateCommitment: commitA, balance: 777n })

        await expect(scanPoolActions({ cluster: v3Cluster([hexA]), pool: V3POOL, networkId: 'chipnet' }))
            .rejects.toThrow(/balance mismatch/)
    })
})

describe('pool scan — the v4h nullifier-SMT + balance-chain reconstruction (the C architecture)', () => {
    const V4HPOOL = getPools('mainnet').find((p) => p.variant === 'v4h')

    /* One v4h action tx (7 inputs — the H pair at 5/6 carries the bare redeem
       push; the scan only reads the STMT at 2, the carrier, out1's 96-B
       commitment and out2's holdings FT). */
    const buildV4HActionTx = ({ txid, prevoutTxid, args, n0, n1, commitment, balance }) => {
        const dummy = (hashByte) => ({
            outpointIndex: 0,
            outpointTransactionHash: new Uint8Array(32).fill(hashByte),
            sequenceNumber: 0xffffffff,
            unlockingBytecode: new Uint8Array([0x00]),
        })
        const stmt = new Uint8Array(642)
        stmt.set(le32(n0), 256)
        stmt.set(le32(n1), 288)
        const stmtPush = new Uint8Array([0x4d, 0x82, 0x02, ...stmt])

        const inputs = [
            dummy(0xa1), dummy(0xa2),
            { outpointIndex: 0, outpointTransactionHash: hexToBin(prevoutTxid), sequenceNumber: 0xffffffff, unlockingBytecode: stmtPush },
            dummy(0xa3), dummy(0xa4), dummy(0xa5), dummy(0xa6),
        ]
        const payload = concatBytes(
            le32(args.nf0), le32(args.nf1), le32(args.cm0), le32(args.cm1), le32(args.cm2),
            le32(args.newMerkleRoot), le32(args.publicValueAbs).slice(0, 8), new Uint8Array([Number(args.isUnshield)]),
        )
        const outputs = [
            { lockingBytecode: new Uint8Array([0x6a, 0x4c, payload.length, ...payload]), valueSatoshis: 0n },
            /* out1 — the new state: the POOL category, NFT-only, 96-B commitment. */
            {
                lockingBytecode: poolLockingBytecode(V4HPOOL),
                valueSatoshis: 10000n,
                token: { category: hexToBin(V4HPOOL.assetCategory), amount: 0n, nft: { capability: 'mutable', commitment: hexToBin(commitment) } },
            },
            /* out2 — the new holdings: the ASSET FT == the balance at H. */
            {
                lockingBytecode: hexToBin(V4HPOOL.program.hLockingHex),
                valueSatoshis: 1000n,
                token: { category: hexToBin(V4HPOOL.heldCategory), amount: BigInt(balance), nft: undefined },
            },
        ]
        return binToHex(encodeTransactionBCH({ version: 2, inputs, outputs, locktime: 0 }))
    }

    const mkArgs = async (leaves, nf0, nf1, pv, sign, out) => ({
        nf0, nf1,
        cm0: out[0], cm1: out[1], cm2: out[2],
        newMerkleRoot: await computeRoot([...leaves, ...out]),
        publicValueAbs: pv, isUnshield: sign,
    })

    const v4hCluster = (hexes, txids) => ({
        getScripthashHistory: async () => hexes.map((_, i) => ({ tx_hash: txids[i], height: 979220 + i })),
        getTransaction: async (id) => hexes[txids.indexOf(id)],
    })

    const V4H_DEPLOY = '61022b8b46087f2a5c5b49ae9782d05a316807726cc078995b2291e500efc944'
    const TXIDS = ['cc' + '00'.repeat(30) + '01', 'cc' + '00'.repeat(30) + '02']

    beforeAll(async () => {
        await getPoseidon()
    })

    it('VERIFIES the honest v4h chain (the 96-B commitment halves + the out2 cross-check + the balance chain)', async () => {
        /* action 1 — a DEPOSIT 1,000 from the EMPTY genesis (the balance 0 → 1,000). */
        const cmA = [9100001n, 9100002n, 9100003n]
        const argsA = await mkArgs([], 9001001n, 9001002n, 1000n, 0n, cmA)
        const cat = BigInt('0x' + V4HPOOL.heldCategory) /* the ASSET — the circuit witness binds it */
        const n1A = actionHash3out({ ...argsA, publicValueSign: 0n, assetCategory: cat, newMerkleRoot: argsA.newMerkleRoot })
        const n0A = leHexToBig(V4HPOOL.genesisRootLE)
        const walkA1 = nullifierWalkData({ spentKeys: [], kA: binToHex(le32(argsA.nf0)), kB: binToHex(le32(argsA.nf1)) })
        /* the 96-B commitment: LE32(root) ‖ finalNullRoot ‖ LE32(balance) */
        const commitA = binToHex(le32(argsA.newMerkleRoot)) + walkA1.finalNullRoot + binToHex(le32(1000n))

        /* action 2 — an UNSHIELD 300 (the balance 1,000 → 700). */
        const cmB = [9200001n, 9200002n, 9200003n]
        const argsB = await mkArgs(cmA, 9002001n, 9002002n, 300n, 1n, cmB)
        const n1B = actionHash3out({ ...argsB, publicValueSign: 1n, assetCategory: cat, newMerkleRoot: argsB.newMerkleRoot })
        const walkB1 = nullifierWalkData({ spentKeys: [binToHex(le32(argsA.nf0)), binToHex(le32(argsA.nf1))], kA: binToHex(le32(argsB.nf0)), kB: binToHex(le32(argsB.nf1)) })
        const commitB = binToHex(le32(argsB.newMerkleRoot)) + walkB1.finalNullRoot + binToHex(le32(700n))

        const hexA = buildV4HActionTx({ txid: TXIDS[0], prevoutTxid: V4H_DEPLOY, args: argsA, n0: n0A, n1: n1A, commitment: commitA, balance: 1000n })
        const hexB = buildV4HActionTx({ txid: TXIDS[1], prevoutTxid: TXIDS[0], args: argsB, n0: argsA.newMerkleRoot, n1: n1B, commitment: commitB, balance: 700n })

        const result = await scanPoolActions({ cluster: v4hCluster([hexA, hexB], TXIDS), pool: V4HPOOL, networkId: 'mainnet' })

        expect(result.actions).toHaveLength(2)
        expect(result.actions[0].stateCommitment).toBe(commitA)
        expect(result.actions[0].newBalance).toBe(1000n)
        expect(result.actions[0].holdingsAmount).toBe(1000n)
        expect(result.actions[1].newBalance).toBe(700n)
        expect(result.spentKeys).toHaveLength(4)
    })

    it('REJECTS a holdings line (out2) that does not match the committed balance', async () => {
        const cmA = [9100001n, 9100002n, 9100003n]
        const argsA = await mkArgs([], 9001001n, 9001002n, 1000n, 0n, cmA)
        const cat = BigInt('0x' + V4HPOOL.heldCategory)
        const n1A = actionHash3out({ ...argsA, publicValueSign: 0n, assetCategory: cat, newMerkleRoot: argsA.newMerkleRoot })
        const n0A = leHexToBig(V4HPOOL.genesisRootLE)
        const walkA1 = nullifierWalkData({ spentKeys: [], kA: binToHex(le32(argsA.nf0)), kB: binToHex(le32(argsA.nf1)) })
        const commitA = binToHex(le32(argsA.newMerkleRoot)) + walkA1.finalNullRoot + binToHex(le32(1000n))
        /* out2 carries 777 — the commitment says 1,000 */
        const hexA = buildV4HActionTx({ txid: TXIDS[0], prevoutTxid: V4H_DEPLOY, args: argsA, n0: n0A, n1: n1A, commitment: commitA, balance: 777n })

        await expect(scanPoolActions({ cluster: v4hCluster([hexA], TXIDS), pool: V4HPOOL, networkId: 'mainnet' }))
            .rejects.toThrow(/holdings line at out2/)
    })

    it('REJECTS a v4h pool whose genesis commitment is not rootLE ‖ EMPTY_NULL_ROOT ‖ balance', async () => {
        const badPool = { ...V4HPOOL, genesisStateCommitment: V4HPOOL.genesisStateCommitment.slice(0, 64) + 'ee'.repeat(32) + '00'.repeat(32) }
        /* any action hex would do — the genesis check fires FIRST. */
        await expect(scanPoolActions({ cluster: v4hCluster([], []), pool: badPool, networkId: 'mainnet' }))
            .rejects.toThrow(/genesis commitment/)
    })

    it('REJECTS a forged balance in the 96-B commitment (the balance chain)', async () => {
        const cmA = [9100001n, 9100002n, 9100003n]
        const argsA = await mkArgs([], 9001001n, 9001002n, 1000n, 0n, cmA)
        const cat = BigInt('0x' + V4HPOOL.heldCategory)
        const n1A = actionHash3out({ ...argsA, publicValueSign: 0n, assetCategory: cat, newMerkleRoot: argsA.newMerkleRoot })
        const n0A = leHexToBig(V4HPOOL.genesisRootLE)
        const walkA1 = nullifierWalkData({ spentKeys: [], kA: binToHex(le32(argsA.nf0)), kB: binToHex(le32(argsA.nf1)) })
        /* the THIRD field lies: 777 instead of 1,000 */
        const commitA = binToHex(le32(argsA.newMerkleRoot)) + walkA1.finalNullRoot + binToHex(le32(777n))
        const hexA = buildV4HActionTx({ txid: TXIDS[0], prevoutTxid: V4H_DEPLOY, args: argsA, n0: n0A, n1: n1A, commitment: commitA, balance: 777n })

        await expect(scanPoolActions({ cluster: v4hCluster([hexA], TXIDS), pool: V4HPOOL, networkId: 'mainnet' }))
            .rejects.toThrow(/balance mismatch/)
    })
})
