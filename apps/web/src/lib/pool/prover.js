// src/lib/pool/prover.js
//
// Client-side Groth16 prover for the PUSD shielded pool (Chipnet PoC).
//
// Assembles the circuit witness (`circuits/pool.circom` in pusd-shielded-pool)
// from wallet notes and runs `snarkjs.groth16.fullProve` against the proving
// assets (`public/proving/pool.wasm` witness calculator + `pool_final.zkey`
// proving key). Proof generation is heavy (~seconds for the 183,760-constraint
// circuit) and runs async.
//
// The witness assembly reuses the wallet's existing pool primitives
// (`./notes` commitments/nullifiers/actionHash + `./merkle` roots/paths), so the
// JS-computed public inputs match the circuit EXACTLY (verified byte-for-byte
// against the bench's committed transfer fixture, which verifies on-chain).
//
// PROVING ASSETS — NOT COMMITTED. The witness calculator (`pool.wasm`) and the
// proving key (`pool_final.zkey`) that pair with the WALLET-COMMITTED verifying
// key (`public/proving/verification_key.json`, PPOT-derived) are gitignored in
// pusd-shielded-pool and regenerate only on the build box (bch-infra); the
// repo's committed `artifacts/` copies are a documented-STALE pre-PPOT snapshot
// that does NOT match the live vkey. Copy the live `build/pool_js/pool.wasm` +
// `build/pool_final.zkey` into `public/proving/` to enable proof generation.
// (`verification_key.json` IS committed here — it is the WALLET-COMMITTED key,
// the pair of the gitignored zkey/wasm. CORRECTION 2026-11-22, registry.js: the
// DEPLOYED pools do NOT verify under it — proofs made with these assets serve
// wallet-side verification and FUTURE Path-A pool deployments under OUR vkey,
// not the already-deployed pools.)

import * as snarkjs from 'snarkjs'

import { binToHex, sha256 } from '@bitauth/libauth'

import { noteCommitment, nullifier, actionHash, actionHash3out, randomField, deriveOwnerPub, TREE_DEPTH, poseidonHash } from './notes.js'
import { computeRoot, merklePath, zeroHashes } from './merkle.js'

/* Proving assets (served as static files, fetched on demand by snarkjs). */
export const PROVING_WASM = 'proving/pool.wasm'
export const PROVING_ZKEY = 'proving/pool_final.zkey'
export const VERIFYING_KEY = 'proving/verification_key.json'
export const PROVING_WASM_3OUT = 'proving/pool3.wasm'
export const PROVING_ZKEY_3OUT = 'proving/pool3_final.zkey'
export const VERIFYING_KEY_3OUT = 'proving/verification_key_3out.json'

/*
 * RELEASE DISTRIBUTION (blocker #4): the witness calculator (3.4 MB) and the
 * proving key (97 MB) are gitignored and CANNOT ship inside the app bundle —
 * a Cloudflare Pages Direct Upload caps a single file at 25 MiB. The
 * canonical storage is this repo's GitHub Release `proving-assets-v1`
 * (pool.wasm + pool_final.zkey + verification_key.json, uploaded from the
 * bch-infra-generated artifacts that live in `public/proving/`; lineage
 * VERIFIED 2026-11-22 on the build VM — snarkjs zKey.exportVerificationKey
 * reproduces the committed verification_key.json byte-for-byte).
 *
 * BROWSER-FETCHABLE MIRROR: GitHub release assets send NO
 * `Access-Control-Allow-Origin`, so the browser cannot fetch them directly.
 * The prover Worker proxies the release at /assets/<name> with permissive
 * CORS (workers/prover/src/index.js handleAsset); these *_URL constants are
 * the WORKER mirror — the default asset locations the orchestrator
 * (lib/pool/actions.js) passes to snarkjs. The relative paths above remain
 * the LOCAL-DEV override: with the files dropped into `public/proving/`,
 * pass those paths instead.
 */
export const RELEASE_TAG = 'role2-proving-assets-v1'
export const RELEASE_BASE = `https://github.com/APECSdev/pusd-shielded-pool/releases/download/${RELEASE_TAG}/`
export const ASSETS_BASE = 'https://prover.nito.cash/assets/'
export const PROVING_WASM_URL = ASSETS_BASE + 'pool.wasm'
export const PROVING_ZKEY_URL = ASSETS_BASE + 'pool_final.zkey'
export const VERIFYING_KEY_URL = ASSETS_BASE + 'verification_key.json'
export const PROVING_WASM_3OUT_URL = ASSETS_BASE + 'pool3.wasm'
export const PROVING_ZKEY_3OUT_URL = ASSETS_BASE + 'pool3_final.zkey'
export const VERIFYING_KEY_3OUT_URL = ASSETS_BASE + 'verification_key_3out.json'
/*
 * THE V3 POOL (circuit pool4 — the append-proof + nullifier-SMT + deposit-path
 * revision; the chipnet v3 pool `chipnet-role2-pool4-v3` is DEPLOYED — anchor
 * 03af2eda…, deploy 89f0829e…, program locking aa207453…). The asset hashes
 * below are VERIFIED against the ceremony artifacts on the VM
 * (~/zkb/pusd-shielded-pool/build4/) on 2026-11-27 — the zkey measured
 * 120,818,048 B on disk (the handover doc's 104,040,332-B figure disagrees;
 * the HASH is the authority). These constants + pins are INERT until the v3
 * registry entry lands with the Hush's proving-assets release (M2): the
 * mirror FILENAMES follow the release's own names — adjust here at M2 if
 * they differ from the artifact names. The VK note from the state file:
 * "CHIPNET-ONLY until the mini-MPC settles" — mainnet funding stays gated
 * on the ceremony decision regardless.
 */
export const PROVING_WASM_V3 = 'proving/pool4.wasm'
export const PROVING_ZKEY_V3 = 'proving/pool4_final.zkey'
export const VERIFYING_KEY_V3 = 'proving/verification_key_4out.json'
export const PROVING_WASM_V3_URL = ASSETS_BASE + 'pool4.wasm'
export const PROVING_ZKEY_V3_URL = ASSETS_BASE + 'pool4_final.zkey'
export const VERIFYING_KEY_V3_URL = ASSETS_BASE + 'verification_key_4out.json'

/*
 * B4 — THE PROVING-ASSET sha256 PINS (2026-11-27).
 *
 * The store's prover flow passes asset LOCATIONS (the Worker mirror URLs or
 * the local-dev relative paths) to snarkjs and previously verified ZERO
 * bytes — any asset substitution (a compromised mirror, a stale local file)
 * would prove under the WRONG ceremony silently. The WRONG-ASSET TRAP IS
 * REAL AND PRESENT: the dev-host `public/proving/pool_final.zkey`
 * (97,714,842 B) is the OLD pre-PPOT artifact sha256 `b2398d85…` — proving
 * with it produces proofs against a ceremony NO deployed pool verifies
 * under. These pins close that: every canonical asset location maps to the
 * sha256 of the EXACT bytes it must serve, `fetchVerifiedAsset` refuses any
 * mismatch (naming both hashes), and `generateProof` / `fetchVerifyingKey`
 * pass snarkjs the VERIFIED BYTES — never an unverified URL.
 *
 * The six canonical values (all hash-verified against the artifacts on the
 * apecsdev VM ~/zkb/pusd-shielded-pool/build{,3}/ and against the live
 * prover.nito.cash mirror on 2026-11-27):
 *   2-out  wasm  pool.wasm             8595b434…7a48 (3,376,395 B — role2-proving-assets-v1)
 *   2-out  zkey  pool_final.zkey       4a4e2543…b7c0 (97,716,000 B)
 *   2-out  vkey  verification_key.json 05250429…4bd19
 *   3-out  wasm  pool3.wasm            c806e561…910fb (3,380,815 B — role2-proving-assets-3out-v1)
 *   3-out  zkey  pool3_final.zkey      b0177dbe…1659 (98,190,141 B)
 *   3-out  vkey  verification_key_3out d4ed12ee…4861
 *
 * snarkjs 0.7.6 accepts Uint8Array buffers for BOTH the wasm and the zkey
 * (fastfile@0.0.20 readExisting: `instanceof Uint8Array` → mem file) — the
 * verified bytes go straight into fullProve; no second unverified fetch.
 *
 * The v3 trio (VK 07638f10… / zkey 942f8fc5… / wasm a9b4b03d…) enters THIS
 * table as a data edit when the Hush release lands — nothing else changes.
 */
export const PROVING_ASSET_SHA256 = {
    [PROVING_WASM]: '8595b43409370c83f371e16408cde85d88382f6fa66f406404071fb38efa7a48',
    [PROVING_ZKEY]: '4a4e2543dbe640de7a59e23cc652b89a50034898757efff22242eafec0f7b7c0',
    [VERIFYING_KEY]: '05250429214cd82eac6540459a564c223c2b3f985122fbe5369b2eac7546bd19',
    [PROVING_WASM_3OUT]: 'c806e561d9466ec25f437d6dfe659ce97e73a3f65359449bcc35deb9c81910fb',
    [PROVING_ZKEY_3OUT]: 'b0177dbe5bb1bf7e9122a00953a2facd3d05b0405fee6c1a59d0da55cfb81659',
    [VERIFYING_KEY_3OUT]: 'd4ed12eefea550d20fb17b34303fa1446af204b182d58c4807f36944f0d04861',
    [PROVING_WASM_URL]: '8595b43409370c83f371e16408cde85d88382f6fa66f406404071fb38efa7a48',
    [PROVING_ZKEY_URL]: '4a4e2543dbe640de7a59e23cc652b89a50034898757efff22242eafec0f7b7c0',
    [VERIFYING_KEY_URL]: '05250429214cd82eac6540459a564c223c2b3f985122fbe5369b2eac7546bd19',
    [PROVING_WASM_3OUT_URL]: 'c806e561d9466ec25f437d6dfe659ce97e73a3f65359449bcc35deb9c81910fb',
    [PROVING_ZKEY_3OUT_URL]: 'b0177dbe5bb1bf7e9122a00953a2facd3d05b0405fee6c1a59d0da55cfb81659',
    [VERIFYING_KEY_3OUT_URL]: 'd4ed12eefea550d20fb17b34303fa1446af204b182d58c4807f36944f0d04861',
    /* The v3 (pool4) trio — hash-verified against build4/ on 2026-11-27. */
    [PROVING_WASM_V3]: 'a9b4b03d17c614ba920c45df5c34949e26ce8cdbdeb3d6b145476a2857289395',
    [PROVING_ZKEY_V3]: '942f8fc5327191da4a98bfbd81b74f87bd6f79267efb2d3067ac6cd0175a723a',
    [VERIFYING_KEY_V3]: '07638f101038418d7b97ba46871476edaf3f6c63086fa9e984a2aa33e530b704',
    [PROVING_WASM_V3_URL]: 'a9b4b03d17c614ba920c45df5c34949e26ce8cdbdeb3d6b145476a2857289395',
    [PROVING_ZKEY_V3_URL]: '942f8fc5327191da4a98bfbd81b74f87bd6f79267efb2d3067ac6cd0175a723a',
    [VERIFYING_KEY_V3_URL]: '07638f101038418d7b97ba46871476edaf3f6c63086fa9e984a2aa33e530b704',
}

/* The pinned sha256 for a canonical asset location (null = unpinned). */
export function pinnedSha256Of(url) {
    return PROVING_ASSET_SHA256[url] || null
}

/*
 * Fetch an asset and VERIFY its sha256 against the pin (B4). Returns the
 * verified bytes (Uint8Array) — or NULL when `allowUnpinned` is explicitly
 * set for an unpinned location (the caller then passes the ORIGINAL
 * location through to snarkjs, whose fastfile reads node paths/URLs itself;
 * the node harnesses use this ONLY after their own sha256 gate — see
 * scripts/role2-sweep-standing.mjs --assets). Without the escape hatch an
 * unknown location refuses BEFORE any fetch; a known location whose bytes
 * do not hash to its pin refuses, naming both values.
 */
export async function fetchVerifiedAsset(url, { expectedSha256 = pinnedSha256Of(url), allowUnpinned = false } = {}) {
    if (!expectedSha256) {
        if (allowUnpinned) return null

        throw new Error(`prover: REFUSING unpinned proving asset '${url}' — no sha256 pin (B4)`)
    }

    console.log(`prover: fetching ${url} …`) // eslint-disable-line no-console
    const fetchStart = Date.now()
    const res = await fetch(url)
    if (!res.ok) throw new Error(`prover: cannot fetch proving asset (${res.status} ${url})`)

    const bytes = new Uint8Array(await res.arrayBuffer())
    console.log(`prover: fetched ${url} — ${bytes.length} B in ${Math.round((Date.now() - fetchStart) / 1000)}s; hashing…`) // eslint-disable-line no-console

    const hashStart = Date.now()
    const actual = binToHex(sha256.hash(bytes))
    console.log(`prover: hashed ${url} in ${Math.round((Date.now() - hashStart) / 1000)}s`) // eslint-disable-line no-console

    if (actual !== expectedSha256) {
        throw new Error(`prover: proving-asset sha256 MISMATCH for '${url}' — expected ${expectedSha256}, got ${actual} (B4: refusing wrong proving assets; the old local public/proving/pool_final.zkey is b2398d85… — replace it or use the mirror URLs)`)
    }

    return bytes
}

/* Module-level verifying-key cache (3 KB JSON — fetched once per session). */
let _vkeyCache = null

/*
 * Fetch (and cache) the verifying key. Defaults to the APP-SERVED committed
 * copy (`public/proving/verification_key.json` ships in the bundle — the
 * committed vkey is small, so it needs no Release fetch). An explicit `url`
 * (e.g. VERIFYING_KEY_URL) bypasses the cache.
 */
export async function fetchVerifyingKey(url = VERIFYING_KEY, { allowUnpinned = false } = {}) {
    if (!url) throw new Error('prover: no verifying-key url')
    if (url === VERIFYING_KEY && _vkeyCache) return _vkeyCache

    /* B4: the vkey bytes are sha256-PINNED before parsing — a substituted
       verifying key makes forged proofs verify (the verification-side
       wrong-asset trap). The verified bytes are parsed here; the
       allowUnpinned escape hatch (harness-only) keeps the plain res.json()
       path for locations fastfile/fetch-shape the caller owns. */
    const bytes = await fetchVerifiedAsset(url, { allowUnpinned })

    const vkey = bytes === null
        ? await fetch(url).then((res) => {
            if (!res.ok) throw new Error(`prover: cannot fetch verifying key (${res.status} ${url})`)

            return res.json()
        })
        : JSON.parse(new TextDecoder().decode(bytes))

    if (url === VERIFYING_KEY) {
        _vkeyCache = vkey
    }

    return vkey
}

const S = (x) => BigInt(x).toString(10)

/**
 * Build the circuit witness for a 2-in / 2-out pool action.
 *
 *   inNotes  — [{ note: {value, ownerPub, rho, r}, nk, index }]  (exactly 2;
 *               `index` is the note's leaf position in `leaves`)
 *   outNotes — [{ value, ownerPub, rho, r }]                     (exactly 2)
 *   leaves   — the current note-commitment leaves (membership paths + merkleRoot
 *               are computed against THIS list, before the outputs are appended)
 *   publicValueAbs / publicValueSign / assetCategory — the action's public value
 *               (sign 0 = shield/deposit, 1 = unshield/withdrawal). The circuit
 *               takes the 256-bit category as TWO 128-bit limbs
 *               (`assetCategoryHi`/`assetCategoryLo` — the role-2 `pool.circom`);
 *               the actionHash still binds the single 256-bit `assetCategory`.
 *
 * Value conservation (enforced in-circuit):
 *   inValue0 + inValue1 + (sign ? -publicValueAbs : +publicValueAbs)
 *     === outValue0 + outValue1
 *
 * Returns the snarkjs input object (every signal as a decimal string).
 */
export async function buildPoolWitness({
    inNotes, outNotes, leaves, publicValueAbs, publicValueSign, assetCategory,
}) {
    /* Input commitments, nullifiers, and membership paths. */
    const nf = []
    const paths = []

    for (let i = 0; i < 2; i++) {
        const { note, nk, index } = inNotes[i]

        nf.push(await nullifier(nk, note.rho))
        paths.push(await merklePath(leaves, index))
    }

    /* Output commitments. */
    const cm = []

    for (let j = 0; j < 2; j++) {
        const o = outNotes[j]

        cm.push(await noteCommitment(o.value, o.ownerPub, o.rho, o.r))
    }

    /* Tree roots before / after appending the two output commitments. */
    const merkleRoot = await computeRoot(leaves)
    const newMerkleRoot = await computeRoot([ ...leaves, ...cm ])

    /* The second public input (SHA256-bound; see notes.js actionHash). */
    const aHash = actionHash({
        nf0: nf[0], nf1: nf[1], cm0: cm[0], cm1: cm[1],
        publicValueAbs, publicValueSign, assetCategory, newMerkleRoot,
    })

    /* The circuit's 128-bit category limbs (the role-2 pool.circom). */
    const assetCategoryHi = assetCategory >> 128n
    const assetCategoryLo = assetCategory & ((1n << 128n) - 1n)

    return {
        merkleRoot: S(merkleRoot),
        actionHash: S(aHash),
        nf: [ S(nf[0]), S(nf[1]) ],
        cm: [ S(cm[0]), S(cm[1]) ],
        publicValueAbs: S(publicValueAbs),
        publicValueSign: S(publicValueSign),
        assetCategoryHi: S(assetCategoryHi),
        assetCategoryLo: S(assetCategoryLo),
        newMerkleRoot: S(newMerkleRoot),
        inValue: [ S(inNotes[0].note.value), S(inNotes[1].note.value) ],
        inOwnerPub: [ S(inNotes[0].note.ownerPub), S(inNotes[1].note.ownerPub) ],
        inRho: [ S(inNotes[0].note.rho), S(inNotes[1].note.rho) ],
        inR: [ S(inNotes[0].note.r), S(inNotes[1].note.r) ],
        nk: [ S(inNotes[0].nk), S(inNotes[1].nk) ],
        inPathElements: [ paths[0].pathElements.map(S), paths[1].pathElements.map(S) ],
        inPathBits: [ paths[0].pathBits.map(S), paths[1].pathBits.map(S) ],
        outValue: [ S(outNotes[0].value), S(outNotes[1].value) ],
        outOwnerPub: [ S(outNotes[0].ownerPub), S(outNotes[1].ownerPub) ],
        outRho: [ S(outNotes[0].rho), S(outNotes[1].rho) ],
        outR: [ S(outNotes[0].r), S(outNotes[1].r) ],
    }
}

/**
 * Build the circuit witness for a 3-out (v3) pool action.
 *
 * The 3-out circuit (`circuits/pool3.circom`) is the same 2-in joinsplit with
 * a third out-note; the actionHash preimage gains `cm2` (9 fields). The
 * 2-out `buildPoolWitness` above is untouched.
 *
 *   outNotes — exactly 3 [{ value, ownerPub, rho, r }]
 *   leaves   — the current leaves (the three output commitments are appended)
 *
 * Value conservation: inValue0 + inValue1 + (sign ? -pv : +pv)
 *   === outValue0 + outValue1 + outValue2
 */
export async function buildPoolWitness3out({
    inNotes, outNotes, leaves, publicValueAbs, publicValueSign, assetCategory,
}) {
    if (!Array.isArray(outNotes) || outNotes.length !== 3) throw new Error('prover: the 3-out witness needs exactly 3 out-notes')

    const nf = []
    const paths = []

    for (let i = 0; i < 2; i++) {
        const { note, nk, index } = inNotes[i]

        nf.push(await nullifier(nk, note.rho))
        paths.push(await merklePath(leaves, index))
    }

    const cm = []

    for (let j = 0; j < 3; j++) {
        const o = outNotes[j]

        cm.push(await noteCommitment(o.value, o.ownerPub, o.rho, o.r))
    }

    const merkleRoot = await computeRoot(leaves)
    const newMerkleRoot = await computeRoot([ ...leaves, ...cm ])

    const aHash = actionHash3out({
        nf0: nf[0], nf1: nf[1], cm0: cm[0], cm1: cm[1], cm2: cm[2],
        publicValueAbs, publicValueSign, assetCategory, newMerkleRoot,
    })

    const assetCategoryHi = assetCategory >> 128n
    const assetCategoryLo = assetCategory & ((1n << 128n) - 1n)

    return {
        merkleRoot: S(merkleRoot),
        actionHash: S(aHash),
        nf: [ S(nf[0]), S(nf[1]) ],
        cm: [ S(cm[0]), S(cm[1]), S(cm[2]) ],
        publicValueAbs: S(publicValueAbs),
        publicValueSign: S(publicValueSign),
        assetCategoryHi: S(assetCategoryHi),
        assetCategoryLo: S(assetCategoryLo),
        newMerkleRoot: S(newMerkleRoot),
        inValue: [ S(inNotes[0].note.value), S(inNotes[1].note.value) ],
        inOwnerPub: [ S(inNotes[0].note.ownerPub), S(inNotes[1].note.ownerPub) ],
        inRho: [ S(inNotes[0].note.rho), S(inNotes[1].note.rho) ],
        inR: [ S(inNotes[0].note.r), S(inNotes[1].note.r) ],
        nk: [ S(inNotes[0].nk), S(inNotes[1].nk) ],
        inPathElements: [ paths[0].pathElements.map(S), paths[1].pathElements.map(S) ],
        inPathBits: [ paths[0].pathBits.map(S), paths[1].pathBits.map(S) ],
        outValue: [ S(outNotes[0].value), S(outNotes[1].value), S(outNotes[2].value) ],
        outOwnerPub: [ S(outNotes[0].ownerPub), S(outNotes[1].ownerPub), S(outNotes[2].ownerPub) ],
        outRho: [ S(outNotes[0].rho), S(outNotes[1].rho), S(outNotes[2].rho) ],
        outR: [ S(outNotes[0].r), S(outNotes[1].r), S(outNotes[2].r) ],
    }
}

/**
 * The v3 (pool4) witness — the deposit path + the APPEND witness.
 *
 * Ported 1:1 from `pusd-shielded-pool/role2-op-witness-v3.mjs` (their FINAL
 * generator — the shape is frozen by the M4 contract; the MPC changes only
 * the zkey/VK). The three v3 fixes, all enforced here at the JS layer exactly
 * as the generator does (the circuit enforces the same in-circuit):
 *   - DEPOSIT (the onboarding): phantom in-notes (value 0, fresh secrets,
 *     zeroed paths; membership gated OFF in-circuit) — no imported notes, no
 *     bootstrap seeds, genesis tree EMPTY;
 *   - the APPEND witness (R3-FREE-NEWROOT closed at circuit level):
 *     appendIndex (the fill count) + three sequential frontier sibling paths,
 *     each asserted against the DENSE-SHAPE rule (sibling[d] == zh[d] iff the
 *     slot's bit d is 0) and each old-walk fold equal to the current tree
 *     root (with the prior cms already appended) — newMerkleRoot is now
 *     CIRCUIT-CONSTRAINED, not a free input;
 *   - nf0 != nf1 (R2) — the builder refuses duplicates before any fuel burns.
 *
 * Conservation (unchanged): inSum + (sign ? -pv : +pv) === outSum over the
 * three out-notes.
 *
 * Returns { input, cm, newMerkleRoot, appendIndex, nf } — `input` is the
 * circuit witness (all fields stringified), the extras feed the op JSON /
 * the lock tag / the notes records in the actions layer.
 */
export async function buildPoolWitnessV3({
    inNotes, outNotes, leaves, publicValueAbs, publicValueSign, assetCategory, isDeposit = false,
}) {
    if (!Array.isArray(outNotes) || outNotes.length !== 3) throw new Error('prover: the v3 witness needs exactly 3 out-notes')

    const zeros = await zeroHashes()
    const nf = []
    const paths = []
    const effectiveIn = []

    if (isDeposit) {
        /* The onboarding path: phantom in-notes (value 0, fresh secrets); the
         * circuit gates membership off (isDeposit=1) and pins both values to
         * zero. The phantom secrets are discarded after the witness. */
        for (let i = 0; i < 2; i++) {
            const nk = randomField()
            const ownerPub = await deriveOwnerPub(nk)
            const rho = randomField()
            const r = randomField()

            effectiveIn.push({ note: { value: 0n, ownerPub, rho, r }, nk, index: -1 })
            nf.push(await nullifier(nk, rho))
            /* unused, boolean-safe */
            paths.push({ pathElements: Array(TREE_DEPTH).fill(0n), pathBits: Array(TREE_DEPTH).fill(0) })
        }
    } else {
        if (!Array.isArray(inNotes) || inNotes.length !== 2) throw new Error('prover: the v3 witness spends exactly 2 in-notes')

        for (let i = 0; i < 2; i++) {
            const { note, nk, index } = inNotes[i]

            nf.push(await nullifier(nk, note.rho))
            paths.push(await merklePath(leaves, index))
            effectiveIn.push({ note, nk, index })
        }
    }

    /* R2, client-side, BEFORE fuel burns: nf0 == nf1 is forbidden by the v3
     * circuit (and by walkB at consensus — nf0's slot is filled in midRoot). */
    if (nf[0] === nf[1]) throw new Error('prover: nf0 == nf1 — the v3 circuit forbids nullifier doubling')

    const cm = []

    for (let j = 0; j < 3; j++) {
        const o = outNotes[j]

        cm.push(await noteCommitment(o.value, o.ownerPub, o.rho, o.r))
    }

    /* Conservation: inSum + (sign ? -pv : +pv) === outSum (deposits: inSum 0). */
    const inSum = effectiveIn.reduce((a, n) => a + BigInt(n.note.value), 0n)
    const outSum = outNotes.reduce((a, o) => a + BigInt(o.value), 0n)

    if (outSum !== inSum + (publicValueSign === 1n ? -publicValueAbs : publicValueAbs)) {
        throw new Error(`prover: conservation violated — in ${inSum}, out ${outSum}, pv ${publicValueAbs}, sign ${publicValueSign}`)
    }

    const oldRoot = await computeRoot(leaves)

    /* ── the APPEND witness: three sequential frontier inserts ── */
    const appendIndex = leaves.length
    const appendSiblings = []
    const treeLeaves = leaves.slice()

    for (let k = 0; k < 3; k++) {
        const slot = appendIndex + k
        const p = await merklePath(treeLeaves, slot)

        appendSiblings.push(p.pathElements)

        /* The old-walk fold: the ZERO leaf at the frontier slot must fold up
         * the supplied siblings to the CURRENT tree root (with cm[0..k-1]
         * already appended) — the exact check noteappend.circom constrains. */
        let cur = 0n

        for (let d = 0; d < TREE_DEPTH; d++) {
            const bit = (slot >> d) & 1

            cur = bit === 1
                ? await poseidonHash([p.pathElements[d], cur])
                : await poseidonHash([cur, p.pathElements[d]])
        }

        const curRoot = await computeRoot(treeLeaves)

        if (cur !== curRoot) throw new Error(`prover: append ${k} old-walk does not fold to the current tree root`)
        if (k === 0 && curRoot !== oldRoot) throw new Error('prover: append 0 fold != the stored pool root')

        /* Dense-shape rule (the circuit enforces the same): sibling[d] == zh[d]
         * iff bit d == 0 — a zero sibling under a 1-bit means a HOLE (the slot
         * is not the frontier); a non-zero sibling under a 0-bit means the
         * slot is not empty. */
        for (let d = 0; d < TREE_DEPTH; d++) {
            const bit = (slot >> d) & 1
            const isZh = p.pathElements[d] === zeros[d]

            if (bit === 0 && !isZh) throw new Error(`prover: append ${k} level ${d}: bit=0 but sibling != zh — the slot is not the frontier`)
            if (bit === 1 && isZh) throw new Error(`prover: append ${k} level ${d}: bit=1 but sibling == zh — the left neighbor is empty (hole)`)
        }

        treeLeaves.push(cm[k])
    }

    /* The chain: oldRoot -(cm0)-> r1 -(cm1)-> r2 -(cm2)-> newMerkleRoot. */
    const newMerkleRoot = await computeRoot([...leaves, ...cm])

    const aHash = actionHash3out({
        nf0: nf[0], nf1: nf[1], cm0: cm[0], cm1: cm[1], cm2: cm[2],
        publicValueAbs, publicValueSign, assetCategory, newMerkleRoot,
    })

    const assetCategoryHi = assetCategory >> 128n
    const assetCategoryLo = assetCategory & ((1n << 128n) - 1n)

    const input = {
        merkleRoot: S(oldRoot),
        actionHash: S(aHash),
        nf: [S(nf[0]), S(nf[1])],
        cm: [S(cm[0]), S(cm[1]), S(cm[2])],
        publicValueAbs: S(publicValueAbs),
        publicValueSign: S(publicValueSign),
        assetCategoryHi: S(assetCategoryHi),
        assetCategoryLo: S(assetCategoryLo),
        newMerkleRoot: S(newMerkleRoot),
        isDeposit: S(isDeposit ? 1n : 0n),
        appendIndex: S(BigInt(appendIndex)),
        appendSiblings: appendSiblings.map((sib) => sib.map(S)),
        inValue: effectiveIn.map((n) => S(n.note.value)),
        inOwnerPub: effectiveIn.map((n) => S(n.note.ownerPub)),
        inRho: effectiveIn.map((n) => S(n.note.rho)),
        inR: effectiveIn.map((n) => S(n.note.r)),
        nk: effectiveIn.map((n) => S(n.nk)),
        inPathElements: paths.map((p) => p.pathElements.map(S)),
        inPathBits: paths.map((p) => p.pathBits.map(S)),
        outValue: outNotes.map((o) => S(o.value)),
        outOwnerPub: outNotes.map((o) => S(o.ownerPub)),
        outRho: outNotes.map((o) => S(o.rho)),
        outR: outNotes.map((o) => S(o.r)),
    }

    return { input, cm, newMerkleRoot, appendIndex, nf }
}

/**
 * Generate a Groth16 proof for an assembled witness.
 * Returns { proof, publicSignals } with publicSignals = [merkleRoot, actionHash].
 *
 * B4: BOTH assets are fetched and sha256-VERIFIED against the pins before
 * snarkjs sees them — fullProve receives the verified Uint8Array bytes
 * (snarkjs 0.7.6 fastfile accepts buffers), never an unverified URL. The
 * call sites (the store's submitRole2Action / actions.js) are unchanged —
 * the verification is inside. `allowUnpinned` is the local-dev escape
 * hatch ONLY; the store paths never set it.
 */
export async function generateProof(input, wasmUrl = PROVING_WASM_URL, zkeyUrl = PROVING_ZKEY_URL, { allowUnpinned = false } = {}) {
    const [wasm, zkey] = await Promise.all([
        fetchVerifiedAsset(wasmUrl, { allowUnpinned }),
        fetchVerifiedAsset(zkeyUrl, { allowUnpinned }),
    ])

    /* A NULL result = the allowUnpinned pass-through: snarkjs's fastfile
       reads the original location (a node path or URL) itself. */
    console.log('prover: assets ready — groth16 fullProve starting…') // eslint-disable-line no-console
    const proveStart = Date.now()
    const result = await snarkjs.groth16.fullProve(input, wasm ?? wasmUrl, zkey ?? zkeyUrl)
    console.log(`prover: fullProve DONE in ${Math.round((Date.now() - proveStart) / 1000)}s`) // eslint-disable-line no-console
    return result
}

/* Verify a proof against the verifying key (sanity check / tests). */
export async function verifyProof(vkey, proof, publicSignals) {
    return snarkjs.groth16.verify(vkey, publicSignals, proof)
}
