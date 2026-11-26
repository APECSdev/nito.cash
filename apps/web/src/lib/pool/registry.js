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

import { binToHex, lockingBytecodeToCashAddress, sha256 } from '@bitauth/libauth'

/* The two on-chain verifier programs (verifier-program.js): the deployed pools'
   (found-key) program and the WALLET-COMMITTED program (the new Path-A pool). */
import { DEPLOYED_PROGRAM, STEP_LOCKINGS, WALLET_PROGRAM, WALLET_STEP_LOCKINGS } from './verifier-program.js'
import { GENERALIZED_WALLET_PROGRAM, GENERALIZED_WALLET_STEP_LOCKINGS } from './verifier-program-generalized.js'
import { BENCH_PROGRAM, BENCH_STEP_LOCKINGS } from './verifier-program-bench.js'
import { ROLE2_GUARD, ROLE2_PROGRAM, ROLE2_VENDING } from './verifier-program-role2.js'

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
            stepLockings: STEP_LOCKINGS,
            program: DEPLOYED_PROGRAM,
            setupGrade: 'demo-solo-1of1',
            notes: 'First mainnet shielded pool op (2026-11-20; PREP dd1e3506…, GENESIS 0a8cb008…, DEPLOY 63ddfdd4…, TRANSFER 4fda8a8b…). NOT production: Gate-7 public ceremony still required; vkey lineage vs the wallet-committed build256 vkey is UNVERIFIED — do not treat as production until verified. RECOVERY (2026-11-22): the mainnet pool verifies under the same RECOVERED keypair as gate3 (fixture tests/fixtures/pool/deployed-vkey.json — its IC points are embedded in the deployed program and its vk_x appears byte-exact in the live 4fda8a8b witness). Same remaining gate as gate3 — the runner\'s witness-encoding revision — so walletProverCompatible stays false until scripts/pool-accept.mjs passes byte-exact.',
        },
    ],

    chipnet: [
        {
            id: 'chipnet-pusd-role2',
            name: 'Chipnet PUSD pool — role-2 tagged (permissionless blanks)',
            network: 'chipnet',
            lockingBytecode: 'aa203e40b64cff154d4b3305e8c8cc4e3174bc595ad74342a8445a9a7798b7be3a2987',
            assetCategory: '480e30ff1d3f5f0b6fe9dd2dbe363b1776f61566f29a395628d0b50abd01b9d0',
            genesisRootLE: '551108f63731bcc628dda2697d70219d103a8c1bf203f2d4aaec6bbea5b4510f',
            genesisLeafCount: 2,
            /* THE PROVING ASSETS ARE NOT IN THIS REPO YET (the Hush solo-ceremony
               VK 05250429…, zkey 4a4e2543…, wasm 8595b434…). The flag flips only
               after the handover AND the web-platform chipnet SHIELD → TRANSFER
               → UNSHIELD acceptance run. */
            walletProverCompatible: true,
            status: 'live',
            deployTxid: '2eaeb97f…',
            categoryAnchorTxid: '480e30ff1d3f5f0b6fe9dd2dbe363b1776f61566f29a395628d0b50abd01b9d0',
            mintTxid: '5ea499ff…',
            genesisLeaves: [
                '12351826192886546690885792605915790291283848718645116437899738538537062803555',
                '7398522746693646650328110604928791171707350116246498951314945102068585381447',
            ],
            bootstrapNotes: [
                {
                    note: { value: '0', ownerPub: '5299619240641551281634865583518297030282874472190772894086521144482721001553', rho: '130842949111883530073146641958534655280', r: '153387697958148631644100398335583547244' },
                    nk: '1',
                    index: 0,
                },
                {
                    note: { value: '0', ownerPub: '5299619240641551281634865583518297030282874472190772894086521144482721001553', rho: '130842949111883530073146641958534655281', r: '153387697958149840569920012964758253420' },
                    nk: '1',
                    index: 1,
                },
            ],
            stepLockings: [],
            program: ROLE2_PROGRAM,
            guard: ROLE2_GUARD,
            vending: ROLE2_VENDING,
            shape: 'role2-tagged',
            txInputCount: 3,
            carrierBytes: 169,
            fuelSats: 15000,
            blanksPerLock: 2,
            notes: 'THE ROLE-2 TAGGED POOL — deployed 2026-11-24 (anchor 480e30ff… = the category; mint 5ea499ff…; deploy 2eaeb97f… block 345,467; the minting NFT passed forward into the guard aa2066a2…). 3 inputs (fuel 0, fuel 1, state 2), NO signatures; 169-B OP_RETURN carrier; deposit tags SHA256(nf0_LE ‖ nf1_LE) on both fuel UTXOs; 2 blanks per lock; 15,000 sats per fuel UTXO (1 sat/B). Lifecycle confirmed: SHIELD 9d9aa97a… → TRANSFER 5262417b… → UNSHIELD e54d19fb…. THE WEB-PLATFORM ACCEPTANCE PASSED 2026-11-26 through the browser Wallet view: SHIELD 1ca58773… (348,247) → TRANSFER 50644d00… (348,249) → UNSHIELD f52008f4… (348,253); walletProverCompatible is true and status live. The old v4/v3 are RETIRED and their notes came from a WITHDRAWN verifier — the old notes are ABANDONED (no unshield/re-shield migration).',
        },
        {
            id: "chipnet-pusd-v4",
            name: "Chipnet PUSD pool v4 (bench program, wallet-generated witness)",
            network: "chipnet",
            lockingBytecode: "aa209dd6f6ef70c453134afd0f13f3a1aff6b9507576c97fe1649ba5aaa06abaa15587",
            covenantRedeem: "2064d6421ad330fe0178c9fafb8b003941405215c13a68ea30b855683c75da310d78009c637b82012088537a82012088547a82012088557a82012088567a82012088c2529dc076ce5779517e8876cf01207f7554ca0221077f7701207f758876cf01207f7778d07c57797e56797ea853797c7e7c5a7993525c79955b7995947600a26900cd537ac78800d15879517e8800d27b8800d39d5879519c6356d156798856d358799d68547abc547abc7e537abc7e7bbc7e547a012080bc7e547a012080bc7e7bbc7e7cbc7ea876517f75011f847c517f777ebc54ca0200077f7701207f758777677c519d7c82012088c2529dc076ce5379517e88203e1f1922dfb671d3f912f7ea461e0a88ee848fdde12b6c18ab1ad2c56ae734212000000000000000000000000000000000000000000000000000000000000000005279cf7b52797e8800cd5279c78800d1547a517e8800d37bd09d00d27b7b7e8768",
            assetCategory: "0d31da753c6855b830ea683ac11552404139008bfbfac97801fe30d31a42d664",
            genesisRootLE: "551108f63731bcc628dda2697d70219d103a8c1bf203f2d4aaec6bbea5b4510f",
            genesisLeafCount: 2,
            walletProverCompatible: false,
            deprecated: true,
            deployTxid: "efd3314edb42bddd7f7438be5dfba5ffd3da378ab13082610edd68426f38357c",
            categoryAnchorTxid: "0d31da753c6855b830ea683ac11552404139008bfbfac97801fe30d31a42d664",
            mintTxid: "a5d251e4146dbb887afc185c712007ba578d9766f81b7fd95df406cc1e36a906",
            genesisLeaves: [
                "12351826192886546690885792605915790291283848718645116437899738538537062803555",
                "7398522746693646650328110604928791171707350116246498951314945102068585381447",
            ],
            bootstrapNotes: [
                {
                    note: { value: "0", ownerPub: "5299619240641551281634865583518297030282874472190772894086521144482721001553", rho: "130842949111883530073146641958534655280", r: "153387697958148631644100398335583547244" },
                    nk: "1",
                    index: 0,
                },
                {
                    note: { value: "0", ownerPub: "5299619240641551281634865583518297030282874472190772894086521144482721001553", rho: "130842949111883530073146641958534655281", r: "153387697958149840569920012964758253420" },
                    nk: "1",
                    index: 1,
                },
            ],
            stepLockings: BENCH_STEP_LOCKINGS,
            program: BENCH_PROGRAM,
            notes: "Deployed 2026-11-23 (5th v4 deploy) - THE REQUESTED SHAPE, COMPLETE GENERALIZATION. in0 covenant, in1-3 execs, in4 genesis, in5 terminal, in6 funding (exactly 7); out0 continuity, out1-5 steps IN PROGRAM ORDER. Program = PUBLIC BENCH built with the WALLET-COMMITTED key (vk-specific) and generalized by shifting THREE reference forms +1: (A) literals before input opcodes, (B) literals passed to helper FUNCTIONS that do the INPUTBYTECODE inside their body (exec @27 OP_1->OP_2, @33 OP_2->OP_3) - form B is why a naive literal scan fails, (C) the terminal self-index @3304 OP_4->OP_5.",
        },







        {
            id: 'chipnet-pusd-v3',
            name: 'Chipnet PUSD pool v3 (generalized wallet program)',
            network: 'chipnet',
            lockingBytecode: 'aa20f8b6eb6aee9495d7a8a48f7042e668cb6c307f730408be57b7a3ea15931b2c3387',
            covenantRedeem: '202dce58d9513f4c990752e827fe100174168cd3156dfe76aac0fdcd8cbd60d02278009c637b82012088537a82012088547a82012088557a82012088567a82012088c2529dc076ce5779517e8876cf01207f7554ca0221077f7701207f758876cf01207f7778d07c57797e56797ea853797c7e7c5a7993525c79955b7995947600a26900cd537ac78800d15879517e8800d27b8800d39d5879519c6356d156798856d358799d68547abc547abc7e537abc7e7bbc7e547a012080bc7e547a012080bc7e7bbc7e7cbc7ea876517f75011f847c517f777ebc54ca0200077f7701207f758777677c519d7c82012088c2529dc076ce5379517e88203e1f1922dfb671d3f912f7ea461e0a88ee848fdde12b6c18ab1ad2c56ae734212000000000000000000000000000000000000000000000000000000000000000005279cf7b52797e8800cd5279c78800d1547a517e8800d37bd09d00d27b7b7e8768',
            assetCategory: '22d060bd8ccdfdc0aa76fe6d15d38c16740110fe27e85207994c3f51d958ce2d',
            genesisRootLE: '551108f63731bcc628dda2697d70219d103a8c1bf203f2d4aaec6bbea5b4510f',
            genesisLeafCount: 2,
            /* SPENDABLE. The step program is GENERALIZED_WALLET_PROGRAM: the
               DEPLOYED on-chain LAYOUT (`OP_TXINPUTCOUNT >= 5`, verifier
               genesis at input 4, terminal at input 5) carrying the WALLET's
               bodies — the constants lib/pool/verifier.js reproduces
               byte-exactly per pool-verifier.spec's pinned ground-truth test.
               This is the fix for the v2 five-input fixture layout described
               in the entry below. */
            walletProverCompatible: false,
            deprecated: true,
            deployTxid: '37b26a779c5b26c75197336e2e85633d315480e95e4eae68c7957b724af7f97b',
            categoryAnchorTxid: '22d060bd8ccdfdc0aa76fe6d15d38c16740110fe27e85207994c3f51d958ce2d',
            mintTxid: 'cd4585c142f9a14acdbe38e45b56a6dc013c804666f62183233dace5c6c1c159',
            genesisLeaves: [
                '12351826192886546690885792605915790291283848718645116437899738538537062803555',
                '7398522746693646650328110604928791171707350116246498951314945102068585381447',
            ],
            bootstrapNotes: [
                {
                    note: { value: '0', ownerPub: '5299619240641551281634865583518297030282874472190772894086521144482721001553', rho: '130842949111883530073146641958534655280', r: '153387697958148631644100398335583547244' },
                    nk: '1',
                    index: 0,
                },
                {
                    note: { value: '0', ownerPub: '5299619240641551281634865583518297030282874472190772894086521144482721001553', rho: '130842949111883530073146641958534655281', r: '153387697958149840569920012964758253420' },
                    nk: '1',
                    index: 1,
                },
            ],
            stepLockings: STEP_LOCKINGS,
            program: DEPLOYED_PROGRAM,
            notes: 'Deployed 2026-11-23 from apps/web/scripts/deploy-pool.mjs (anchor 09268d21… = the category, mint 32f84b41…, deploy 56ebf641…). The wallet-committed keypair (GitHub Release proving-assets-v1) + a fresh category, deployed under GENERALIZED_WALLET_PROGRAM (verifier-program-generalized.js). Replaces v2, which is unspendable as deployed — see the v2 notes for the five-input-layout evidence.',
        },
        {
            id: 'chipnet-pusd-v2',
            name: 'Chipnet PUSD pool v2 (wallet-committed key)',
            lockingBytecode: 'aa20e6b3af9822cdaf8d2c0744bdf51e7d61b8edd280820f661b8641d3c9844d585587',
            covenantRedeem: '20a904c558ac7d1c8cbffc39736b59f5143b23fbd87123843e71a7a9be34590b0578009c637b82012088537a82012088547a82012088557a82012088567a82012088c2529dc076ce5779517e8876cf01207f7554ca0221077f7701207f758876cf01207f7778d07c57797e56797ea853797c7e7c5a7993525c79955b7995947600a26900cd537ac78800d15879517e8800d27b8800d39d5879519c6356d156798856d358799d68547abc547abc7e537abc7e7bbc7e547a012080bc7e547a012080bc7e7bbc7e7cbc7ea876517f75011f847c517f777ebc54ca0200077f7701207f758777677c519d7c82012088c2529dc076ce5379517e88203e1f1922dfb671d3f912f7ea461e0a88ee848fdde12b6c18ab1ad2c56ae734212000000000000000000000000000000000000000000000000000000000000000005279cf7b52797e8800cd5279c78800d1547a517e8800d37bd09d00d27b7b7e8768',
            assetCategory: '050b5934bea9a7713e842371d8fb233b14f5596b7339fcbf8c1c7dac58c504a9',
            genesisRootLE: '551108f63731bcc628dda2697d70219d103a8c1bf203f2d4aaec6bbea5b4510f',
            genesisLeafCount: 2,
            /* The runner-independent pool (deployed 2026-11-22): the
               wallet-COMMITTED verifying key (proving-assets-v1 lineage) + a
               FRESH category (anchor 050b5934…, mint a3e90020…, deploy
               53014fd4…; networks.js chipnet PUSD tracks it). genesisLeaves/
               bootstrapNotes are the two PUBLIC dummy seed notes (value 0,
               nk = 1) — any wallet can bootstrap its first action by
               spending them (lib/pool/actions.js selectInNotes).

               NOT SPENDABLE AS DEPLOYED (2026-11-23, VM-verified). The
               step program below is the BENCH's FIVE-INPUT variant: its
               terminal redeem pins `OP_TXINPUTCOUNT == 5` and
               `OP_INPUTINDEX == 4` (WALLET redeems[4] instructions
               1548-1558), and the exec/genesis redeems read INPUT 3 as the
               genesis witness (redeems[0] instruction 33-34:
               `OP_3 OP_INPUTBYTECODE`). The wallet's builder emits EIGHT
               inputs (covenant 0, exec0..2 1..3, genesis 4, terminal 5,
               funding 6+) — every hardcoded index is therefore wrong and no
               action can ever satisfy the scripts, whatever the proof.
               Evidence, on a REAL action (36,997 B, 8-in/8-out) evaluated
               with the BCH-2026 VM on the apecsdev VM: input 0 (covenant)
               PASSES; inputs 1-3 fail `OP_SPLIT invalid index (item 219,
               split 867)`, inputs 4-5 fail `OP_VERIFY`; the network's
               broadcast error was `mandatory-script-verify-flag-failed
               (Invalid OP_SPLIT range)`. The working DEPLOYED program is
               the GENERALIZED variant (DEPLOYED_PROGRAM redeem 4
               @1549-1557: `OP_TXINPUTCOUNT >= 5`, terminal at index 5).
               FIX = redeploy under the wallet key with a GENERALIZED
               program; the flag flips only for such a pool. */
            walletProverCompatible: false,
            genesisLeaves: [
                '12351826192886546690885792605915790291283848718645116437899738538537062803555',
                '7398522746693646650328110604928791171707350116246498951314945102068585381447',
            ],
            bootstrapNotes: [
                {
                    note: { value: '0', ownerPub: '5299619240641551281634865583518297030282874472190772894086521144482721001553', rho: '130842949111883530073146641958534655280', r: '153387697958148631644100398335583547244' },
                    nk: '1',
                    index: 0,
                },
                {
                    note: { value: '0', ownerPub: '5299619240641551281634865583518297030282874472190772894086521144482721001553', rho: '130842949111883530073146641958534655281', r: '153387697958149840569920012964758253420' },
                    nk: '1',
                    index: 1,
                },
            ],
            stepLockings: WALLET_STEP_LOCKINGS,
            program: WALLET_PROGRAM,
            notes: 'Path-A pool deployed 2026-11-22 from apps/web/scripts/deploy-pool.mjs (anchor 050b5934…504a9 = the category, mint a3e90020…decc02, deploy 53014fd4…766da). The wallet-committed keypair (GitHub Release proving-assets-v1) + the wallet-tracked chipnet PUSD category. The deployed pools (gate3 + mainnet) stay runner-gated — their witness-encoding generator revision is still missing (scripts/pool-accept.mjs is the gate).',
        },
        {
            id: 'gate3-demo-pool',
            name: 'Gate 3 demo pool',
            lockingBytecode: 'aa207c0c15fbdc14dda43fb0540846e065a1bbd4076e7ab64720e64c3ecd3515208087',
            covenantRedeem: '2053b1852a0311e37849cedf9b7353faff12be4ceba23b6199801a8309ba0d699878009c637b82012088537a82012088547a82012088557a82012088567a82012088c2529dc076ce5779517e8876cf01207f7554ca0221077f7701207f758876cf01207f7778d07c57797e56797ea853797c7e7c5a7993525c79955b7995947600a26900cd537ac78800d15879517e8800d27b8800d39d5879519c6356d156798856d358799d68547abc547abc7e537abc7e7bbc7e547a012080bc7e547a012080bc7e7bbc7e7cbc7ea876517f75011f847c517f777ebc54ca0200077f7701207f758777677c519d7c82012088c2529dc076ce5379517e88203e1f1922dfb671d3f912f7ea461e0a88ee848fdde12b6c18ab1ad2c56ae734212000000000000000000000000000000000000000000000000000000000000000005279cf7b52797e8800cd5279c78800d1547a517e8800d37bd09d00d27b7b7e8768',
            assetCategory: '98690dba09831a8099613ba2eb4cbe12fffa53739bdfce4978e311032a85b153',
            genesisRootLE: '2c0f533600a77df705b7a23481a16bbc2baa9e9abb6a2943857931faa3f44525',
            genesisLeafCount: 2,
            /* NOT wallet-prover-compatible: the deployed program's vkey
               differs from the wallet-committed one (the correction in notes
               below) — but that vkey is now RECOVERED (see notes). Note
               DETECTION is unaffected; the remaining gate is the runner's
               witness-ENCODING revision (lib/pool/actions.js). */
            walletProverCompatible: false,
            stepLockings: STEP_LOCKINGS,
            program: DEPLOYED_PROGRAM,
            notes: 'Path-A lifecycle proof pool (deployed 2026-11-01, block 330438; first op SHIELD f5927a0b…). VKEY LINEAGE CORRECTION (2026-11-22, from on-chain witness data): the deployed verifier program does NOT verify against the wallet-committed verification_key.json — the live actions’ genesis witness carries a vk_x that matches NEITHER the committed NOR the earlier vkey for their on-chain (n0, n1), and the deployed step redeems/fragments differ from the current bench main (exec2 fragment 561 B vs 559 B, terminal redeem 4158 B vs 4157 B). The pool was built by a runner worktree whose exact revision is not in the public repo (the documented “layout drift”, handoff §4.4). Until the runner’s build256 vkey + worktree are re-verified, treat this pool as NOT wallet-prover-compatible; the note-detection scan is unaffected (it validates against the on-chain n0/n1, not the vkey). RECOVERY (2026-11-22): the pool\'s TRUE keypair is RECOVERED — the apecsdev VM ~/zkb/pusd-shielded-pool/build/ pair (pool_final.zkey, 97,716,000 B, sha256 4a4e2543…, pairing-VERIFIED on the VM; its vkey is the committed fixture tests/fixtures/pool/deployed-vkey.json, sha256 05250429…; the Phase-2 entropy is STORED at build/demo-entropy.txt = c490ce06a2f3… — a reproducible demo-solo-1of1). Two independent proofs it is the pools\' key: its IC points are EMBEDDED in the deployed program (LE), and its vk_x for each live (n0, n1) appears byte-exact in the live genesis witness (fields 4/5, LE). STILL GATED: the runner\'s witness-ENCODING generator (a different MSM build than the public bench main — the live push-0 is the same 14 fields in NATURAL order LITTLE-ENDIAN vs the port\'s reordered big-endian layout, and the port\'s pairing check rejects the live proof under the recovered key across all sign/limb variants; the ~/zkb worktrees are public main + a 1-byte OP_7 tweak — the runner\'s revision is NOT among them). The acceptance gate: scripts/pool-accept.mjs must report all five verifier inputs BYTE-EXACT before walletProverCompatible flips.',
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
 * lineage must match the wallet's proving assets (lib/pool/prover.js)
 * AND its verifier program must accept the builder's input layout.
 * ALL THREE registered pools are flagged false today — gate3's vkey
 * lineage is runner-gated (its entry notes), the mainnet demo pool's too,
 * and chipnet-pusd-v2's step program pins the bench's 5-input layout
 * while the builder emits 8 inputs (its entry note). Returns null when no
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

/*
 * The pool covenant's ELECTRUM SCRIPTHASH (sha256 of the full locking
 * bytecode, byte-reversed, hex) — the form Fulcrum actually accepts for
 * the P2SH32 covenant addresses. The CashAddress form from poolAddress()
 * carries the hashType bits (`bitcoincash::p…`) which Fulcrum REJECTS with
 * "Invalid address" (verified live on mainnet + chipnet, 2026-11-22) —
 * every chain query for pool history MUST go through this scripthash
 * (provider.js getScripthashHistory).
 */
export function poolScripthash(pool) {
    return binToHex(new Uint8Array(sha256.hash(poolLockingBytecode(pool))).reverse())
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
