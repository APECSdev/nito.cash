// src/lib/pool/registry.js
//
// Shielded-pool registry (wallet side).
//
// Mirrors hushyourmoney `pool-registry.json` (version 1, updated 2026-11-20):
// every pool's covenant LOCKING BYTECODE (full P2SH32 script), its asset
// category, and its genesis-tree metadata. The wallet derives the covenant
// CashAddress from the locking bytecode itself (libauth
// `lockingBytecodeToCashAddress`), so the registry is the single source of
// "which pool(s) exist on which network".
//
// GENESIS-TREE HONESTY: some pools are deployed with a SEEDED tree (init()
// pre-inserts the operator's first notes BEFORE any public action). The seed
// LEAF VALUES are not public chain data — for gate3-demo-pool they live in the
// runner's `seed256.json` (contents verified in POOL-DEPLOYMENT.md: c0, c1,
// seededRootLE = 2c0f5336…4525). The registry therefore carries the genesis
// ROOT (verifiable on-chain via the state NFT commitment / the first action's
// proven n0) and the genesis LEAF COUNT (the number of pre-seeded leaves),
// NOT the leaf values. Consequences, by design (see scan.js):
//   - RECEIVED notes are always in the APPENDED (post-genesis) portion of the
//     tree; their commitments are ON-CHAIN in the delivering action's covenant
//     args (cm0/cm1), so detection validates against those — no seed leaves
//     needed.
//   - Building merklePath WITNESSES for appended leaves whose paths cross the
//     seed subtree requires the seed subtree hashes — a later registry
//     extension ("genesisSubtreeHashes"), needed for SPENDING on non-aligned
//     trees, not for detection.

import { lockingBytecodeToCashAddress } from '@bitauth/libauth'

import { getNetwork } from '../bch/networks.js'

/*
 * The pools, keyed by network id ('mainnet' | 'chipnet').
 *
 * `lockingBytecode` — the FULL P2SH32 covenant locking script
 *   (OP_HASH256 OP_PUSHBYTES_32 <32-byte redeem hash> OP_EQUAL), hex.
 *   This is what the covenant-address history is queried against.
 * `covenantRedeem` — the deployed 347 B redeem script (the merged spend()/init()
 *   variant with the category as its embedded constructor arg), hex — extracted
 *   from the live chain (the final push of any action's covenant unlocking).
 *   Required by the tx builder (lib/pool/build.js); the hash256 of this must
 *   equal the 32 bytes inside `lockingBytecode`.
 * `assetCategory` — the pool's pinned CashToken category (display/BE hex),
 *   matching the `tokens` registry in lib/bch/networks.js.
 * `genesisRootLE` — the tree root at pool creation (the state NFT's merkle
 *   half at genesis), 32-byte LE VM-number hex — cross-checks the first
 *   action's proven n0.
 * `genesisLeafCount` — how many notes init() pre-seeded (the global leaf
 *   index OFFSET for every appended note).
 */
const POOLS = {
    mainnet: [
        {
            id: 'mainnet-pusd-pool',
            name: 'Mainnet PUSD pool (demo)',
            lockingBytecode: 'aa20a8d375c44dfa07ab5b3a7773e69e608fc307d188be00f5308813ef80989a47b987',
            assetCategory: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
            genesisRootLE: '49bda9bde7ea07d144ff99d81a0959a112579e98ab4c84dcefb98786ab90830f',
            genesisLeafCount: 2,
            /* NOT wallet-prover-compatible (yet): the vkey lineage vs the
               wallet-committed build256 vkey is UNVERIFIED (see notes) — the
               flag gates the end-to-end action flows (lib/pool/actions.js). */
            walletProverCompatible: false,
            setupGrade: 'demo-solo-1of1',
            notes: 'First mainnet shielded pool op (2026-11-20; PREP dd1e3506…, GENESIS 0a8cb008…, DEPLOY 63ddfdd4…, TRANSFER 4fda8a8b…). NOT production: Gate-7 public ceremony still required; vkey lineage vs the wallet-committed build256 vkey is UNVERIFIED — do not treat as production until verified.',
        },
    ],

    chipnet: [
        {
            id: 'gate3-demo-pool',
            name: 'Gate 3 demo pool',
            lockingBytecode: 'aa207c0c15fbdc14dda43fb0540846e065a1bbd4076e7ab64720e64c3ecd3515208087',
            covenantRedeem: '2053b1852a0311e37849cedf9b7353faff12be4ceba23b6199801a8309ba0d699878009c637b82012088537a82012088547a82012088557a82012088567a82012088c2529dc076ce5779517e8876cf01207f7554ca0221077f7701207f758876cf01207f7778d07c57797e56797ea853797c7e7c5a7993525c79955b7995947600a26900cd537ac78800d15879517e8800d27b8800d39d5879519c6356d156798856d358799d68547abc547abc7e537abc7e7bbc7e547a012080bc7e547a012080bc7e7bbc7e7cbc7ea876517f75011f847c517f777ebc54ca0200077f7701207f758777677c519d7c82012088c2529dc076ce5379517e88203e1f1922dfb671d3f912f7ea461e0a88ee848fdde12b6c18ab1ad2c56ae734212000000000000000000000000000000000000000000000000000000000000000005279cf7b52797e8800cd5279c78800d1547a517e8800d37bd09d00d27b7b7e8768',
            assetCategory: '98690dba09831a8099613ba2eb4cbe12fffa53739bdfce4978e311032a85b153',
            genesisRootLE: '2c0f533600a77df705b7a23481a16bbc2baa9e9abb6a2943857931faa3f44525',
            genesisLeafCount: 2,
            /* NOT wallet-prover-compatible: the deployed program's vkey
               matches NEITHER vkey the wallet holds (the correction in notes
               below). Note DETECTION is unaffected; only shield/transfer/
               unshield are gated (lib/pool/actions.js). */
            walletProverCompatible: false,
            notes: 'Path-A lifecycle proof pool (deployed 2026-11-01, block 330438; first op SHIELD f5927a0b…). VKEY LINEAGE CORRECTION (2026-11-22, from on-chain witness data): the deployed verifier program does NOT verify against the wallet-committed verification_key.json — the live actions’ genesis witness carries a vk_x that matches NEITHER the committed NOR the earlier vkey for their on-chain (n0, n1), and the deployed step redeems/fragments differ from the current bench main (exec2 fragment 561 B vs 559 B, terminal redeem 4158 B vs 4157 B). The pool was built by a runner worktree whose exact revision is not in the public repo (the documented “layout drift”, handoff §4.4). Until the runner’s build256 vkey + worktree are re-verified, treat this pool as NOT wallet-prover-compatible; the note-detection scan is unaffected (it validates against the on-chain n0/n1, not the vkey).',
        },
    ],
}

/* All pools for a network id (empty array if none). */
export function getPools(networkId) {
    return POOLS[networkId] || []
}

/* The DEFAULT pool for a network (first entry; the wallet's scan target). */
export function getDefaultPool(networkId) {
    return (POOLS[networkId] || [])[0] || null
}

/*
 * The first pool on a network the WALLET can PROVE for end-to-end
 * (SHIELD/TRANSFER/UNSHIELD via lib/pool/actions.js): its verifying-key
 * lineage must match the wallet's proving assets (lib/pool/prover.js).
 * Both DEPLOYED pools are flagged false today — gate3's vkey lineage is
 * unverified (the runner correction in its entry) and the mainnet demo
 * pool's lineage is unverified (its entry notes). Returns null when no
 * pool qualifies: the UI must gate the action flows on THIS, never on
 * getPools() — a Path-A deployment under the wallet-committed vkey flips
 * its entry's flag and the flows light up with no further code change.
 */
export function getProverPool(networkId) {
    return (POOLS[networkId] || []).find((pool) => pool.walletProverCompatible === true) || null
}

/* A pool's full covenant locking bytecode as bytes. */
export function poolLockingBytecode(pool) {
    return hexToBytes(pool.lockingBytecode)
}

/*
 * A pool's covenant CashAddress (the P2SH32 address form of the locking
 * bytecode) — the address whose Fulcrum history IS the pool's action chain
 * (every pool action pays output[0] back to the covenant).
 *
 * `lockingBytecodeToCashAddress` returns an error STRING on non-standard
 * patterns; a registry entry is malformed if that happens — throw loudly.
 */
export function poolAddress(pool, networkId) {
    const prefix = getNetwork(networkId).addressPrefix

    const result = lockingBytecodeToCashAddress({
        bytecode: poolLockingBytecode(pool),
        prefix,
    })

    if (typeof result === 'string') {
        throw new Error(`pool registry: cannot encode ${pool.id} covenant address (${result})`)
    }

    return result.address
}

/* ---- local byte helpers (no imports beyond libauth) ---- */

/* Hex string -> bytes (libauth has hexToBin; kept local for symmetry). */
function hexToBytes(hex) {
    const clean = hex.replace(/\s+/g, '')

    const out = new Uint8Array(clean.length / 2)

    for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(clean.substr(i * 2, 2), 16)
    }

    return out
}
