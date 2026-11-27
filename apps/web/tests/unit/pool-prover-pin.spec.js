// tests/unit/pool-prover-pin.spec.js
//
// B4 — the proving-asset sha256 pins (lib/pool/prover.js).
//
// Coverage contract:
//   1. The PIN TABLE: all 12 canonical locations (6 assets x local-path +
//      mirror-URL) map to the EXACT documented hashes — hard-coded here as a
//      second copy of the truth so an accidental pin edit fails loudly.
//   2. fetchVerifiedAsset: pinned-success (synthetic pin), MISMATCH refusal,
//      unpinned refusal (BEFORE any fetch), allowUnpinned escape hatch.
//   3. generateProof: the wiring — both assets verified before snarkjs sees
//      them; fullProve receives the BYTES (snarkjs is mocked); a MISMATCH
//      aborts before fullProve.
//   4. fetchVerifyingKey: the committed vkey (the REAL file from
//      public/proving/) verifies, parses, and caches; tampered bytes refuse.
//
// The pinned-success path against the REAL 3.4 MB wasm / 98 MB zkey fixtures
// is deliberately NOT a unit test — it is the live path exercised by the
// browser acceptance; here the mechanism is covered with synthetic pins and
// the pin VALUES are covered by the table assertions.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* Spec-side hashing via node:crypto (module-scope libauth interop is not
   available during collection; the PRODUCTION code in prover.js uses
   libauth's sha256 inside async functions, same as notes.js/carrier.js). */
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex')

vi.mock('snarkjs', () => ({ groth16: { fullProve: vi.fn() } }))

/* The six canonical asset hashes (2026-11-27; verified against the VM
   ~/zkb/pusd-shielded-pool/build{,3} artifacts + the live mirror). */
const CANONICAL = {
    wasm2out: '8595b43409370c83f371e16408cde85d88382f6fa66f406404071fb38efa7a48',
    zkey2out: '4a4e2543dbe640de7a59e23cc652b89a50034898757efff22242eafec0f7b7c0',
    vkey2out: '05250429214cd82eac6540459a564c223c2b3f985122fbe5369b2eac7546bd19',
    wasm3out: 'c806e561d9466ec25f437d6dfe659ce97e73a3f65359449bcc35deb9c81910fb',
    zkey3out: 'b0177dbe5bb1bf7e9122a00953a2facd3d05b0405fee6c1a59d0da55cfb81659',
    vkey3out: 'd4ed12eefea550d20fb17b34303fa1446af204b182d58c4807f36944f0d04861',
}

/* The REAL committed verifying key (byte-exact the pin — asserted live in
   the fetchVerifyingKey tests). */
/* NOTE: resolved via process.cwd() (the vitest root = apps/web) — the
   `new URL(literal, import.meta.url)` pattern is REWRITTEN by Vite's import
   analysis to a jsdom http://localhost:3000 URL for resolvable assets (the
   wrong-asset-trap probe measured this live) and breaks under fileURLToPath. */
const COMMITTED_VKEY = readFileSync(join(process.cwd(), 'public/proving/verification_key.json'))
const COMMITTED_VKEY_BYTES = new Uint8Array(COMMITTED_VKEY)
const COMMITTED_VKEY_HASH = sha256Hex(COMMITTED_VKEY_BYTES)

/* The WRONG-ASSET TRAP on record: the old local zkey's documented hash. */
const OLD_LOCAL_ZKEY = 'b2398d853d70813884513738fd312e8b4b4f44213537144b082658050238af5e'

const bytesToBuffer = (bytes) => {
    const copy = new Uint8Array(bytes.length)
    copy.set(bytes)
    return copy.buffer
}

/* Stub global fetch: bodies is { [url]: Uint8Array | { status } }. */
const stubFetch = (bodies) => {
    const fn = vi.fn(async (url) => {
        const body = bodies[url]
        if (body && body.status) return { ok: false, status: body.status, arrayBuffer: async () => new ArrayBuffer(0) }
        if (body === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
        return { ok: true, arrayBuffer: async () => bytesToBuffer(body) }
    })
    vi.stubGlobal('fetch', fn)
    return fn
}

/* Fresh module per test (the vkey cache is module-level). */
const freshProver = async () => {
    vi.resetModules()
    return await import('@/lib/pool/prover.js')
}

describe('lib/pool/prover B4 — the proving-asset pins', () => {
    let prover

    beforeEach(async () => {
        prover = await freshProver()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.clearAllMocks()
    })

    it('pins ALL 12 canonical locations to the exact documented hashes', () => {
        const {
            PROVING_WASM, PROVING_ZKEY, VERIFYING_KEY,
            PROVING_WASM_3OUT, PROVING_ZKEY_3OUT, VERIFYING_KEY_3OUT,
            PROVING_WASM_URL, PROVING_ZKEY_URL, VERIFYING_KEY_URL,
            PROVING_WASM_3OUT_URL, PROVING_ZKEY_3OUT_URL, VERIFYING_KEY_3OUT_URL,
        } = prover

        expect(prover.PROVING_ASSET_SHA256[PROVING_WASM]).toBe(CANONICAL.wasm2out)
        expect(prover.PROVING_ASSET_SHA256[PROVING_ZKEY]).toBe(CANONICAL.zkey2out)
        expect(prover.PROVING_ASSET_SHA256[VERIFYING_KEY]).toBe(CANONICAL.vkey2out)
        expect(prover.PROVING_ASSET_SHA256[PROVING_WASM_3OUT]).toBe(CANONICAL.wasm3out)
        expect(prover.PROVING_ASSET_SHA256[PROVING_ZKEY_3OUT]).toBe(CANONICAL.zkey3out)
        expect(prover.PROVING_ASSET_SHA256[VERIFYING_KEY_3OUT]).toBe(CANONICAL.vkey3out)
        expect(prover.PROVING_ASSET_SHA256[PROVING_WASM_URL]).toBe(CANONICAL.wasm2out)
        expect(prover.PROVING_ASSET_SHA256[PROVING_ZKEY_URL]).toBe(CANONICAL.zkey2out)
        expect(prover.PROVING_ASSET_SHA256[VERIFYING_KEY_URL]).toBe(CANONICAL.vkey2out)
        expect(prover.PROVING_ASSET_SHA256[PROVING_WASM_3OUT_URL]).toBe(CANONICAL.wasm3out)
        expect(prover.PROVING_ASSET_SHA256[PROVING_ZKEY_3OUT_URL]).toBe(CANONICAL.zkey3out)
        expect(prover.PROVING_ASSET_SHA256[VERIFYING_KEY_3OUT_URL]).toBe(CANONICAL.vkey3out)

        /* 12 entries, no strays. */
        expect(Object.keys(prover.PROVING_ASSET_SHA256)).toHaveLength(12)
    })

    it('keeps the committed vkey byte-exact to its pin and the old local zkey OUT of the table', () => {
        expect(COMMITTED_VKEY_HASH).toBe(CANONICAL.vkey2out)
        expect(Object.values(prover.PROVING_ASSET_SHA256)).not.toContain(OLD_LOCAL_ZKEY)
    })

    it('pinnedSha256Of resolves canonical locations and returns null for unknown ones', () => {
        expect(prover.pinnedSha256Of(prover.PROVING_ZKEY_URL)).toBe(CANONICAL.zkey2out)
        expect(prover.pinnedSha256Of('proving/some-random-dev-asset.wasm')).toBe(null)
    })

    it('fetchVerifiedAsset returns verified bytes when the pin matches (synthetic pin)', async () => {
        const payload = new Uint8Array([1, 2, 3, 4, 5])
        const pin = sha256Hex(payload)
        const fetchFn = stubFetch({ 'https://mirror.test/asset.bin': payload })

        const bytes = await prover.fetchVerifiedAsset('https://mirror.test/asset.bin', { expectedSha256: pin })

        expect(fetchFn).toHaveBeenCalledTimes(1)
        expect([...bytes]).toEqual([...payload])
    })

    it('fetchVerifiedAsset REFUSES mismatched bytes, naming both hashes', async () => {
        const fetchFn = stubFetch({ [prover.PROVING_WASM_URL]: new Uint8Array([9, 9, 9]) })

        await expect(prover.fetchVerifiedAsset(prover.PROVING_WASM_URL))
            .rejects.toThrow(`sha256 MISMATCH for '${prover.PROVING_WASM_URL}' — expected ${CANONICAL.wasm2out}`)

        expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('fetchVerifiedAsset REFUSES unpinned locations BEFORE any fetch (and honours allowUnpinned)', async () => {
        const fetchFn = stubFetch({})

        await expect(prover.fetchVerifiedAsset('proving/custom-dev.wasm'))
            .rejects.toThrow('REFUSING unpinned proving asset')

        expect(fetchFn).not.toHaveBeenCalled()

        /* The escape hatch: NULL (the caller passes the original location
           through to snarkjs — fastfile reads node paths/URLs itself; the
           node harnesses use this ONLY after their own sha256 gate). */
        expect(await prover.fetchVerifiedAsset('proving/custom-dev.wasm', { allowUnpinned: true })).toBe(null)
        expect(fetchFn).not.toHaveBeenCalled()
    })

    it('generateProof verifies BOTH assets and hands snarkjs the bytes', async () => {
        const snarkjs = await import('snarkjs')
        stubFetch({})
        snarkjs.groth16.fullProve.mockResolvedValue({ proof: { pi: 1 }, publicSignals: [11, 22] })

        /* The allowUnpinned pass-through: the ORIGINAL locations go to
           snarkjs (its fastfile reads node paths/URLs itself) — the node
           harness pattern (--assets, pre-hash-verified by the harness). */
        const input = { a: '1', b: '2' }
        const result = await prover.generateProof(input, 'proving/custom.wasm', 'proving/custom.zkey', { allowUnpinned: true })

        expect(snarkjs.groth16.fullProve).toHaveBeenCalledTimes(1)
        const [witnessArg, wasmArg, zkeyArg] = snarkjs.groth16.fullProve.mock.calls[0]
        expect(witnessArg).toBe(input)
        expect(wasmArg).toBe('proving/custom.wasm')
        expect(zkeyArg).toBe('proving/custom.zkey')
        expect(result).toEqual({ proof: { pi: 1 }, publicSignals: [11, 22] })
    })

    it('generateProof ABORTS on a pinned-location mismatch before snarkjs runs', async () => {
        const snarkjs = await import('snarkjs')
        stubFetch({
            [prover.PROVING_WASM_3OUT_URL]: new Uint8Array([3, 3]),
            [prover.PROVING_ZKEY_3OUT_URL]: new Uint8Array([4, 4]),
        })

        await expect(prover.generateProof({ }, prover.PROVING_WASM_3OUT_URL, prover.PROVING_ZKEY_3OUT_URL))
            .rejects.toThrow('sha256 MISMATCH')

        expect(snarkjs.groth16.fullProve).not.toHaveBeenCalled()
    })

    it('fetchVerifyingKey verifies + parses + caches the REAL committed vkey (byte-exact the pin)', async () => {
        const fetchFn = stubFetch({ [prover.VERIFYING_KEY]: COMMITTED_VKEY_BYTES })

        const vkey = await prover.fetchVerifyingKey()

        expect(fetchFn).toHaveBeenCalledTimes(1)
        expect(vkey.protocol).toBe('groth16')
        expect(vkey.nPublic).toBe(2)

        /* The cache: a second call does NOT re-fetch. */
        const again = await prover.fetchVerifyingKey()
        expect(again).toBe(vkey)
        expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    it('fetchVerifyingKey REFUSES tampered vkey bytes', async () => {
        const tampered = new Uint8Array(COMMITTED_VKEY_BYTES)
        tampered[10] ^= 0xff
        stubFetch({ [prover.VERIFYING_KEY]: tampered })

        await expect(prover.fetchVerifyingKey()).rejects.toThrow('sha256 MISMATCH')
    })

    it('fetchVerifyingKey REFUSES an unpinned custom url', async () => {
        const fetchFn = stubFetch({})

        await expect(prover.fetchVerifyingKey('https://evil.example/vkey.json'))
            .rejects.toThrow('REFUSING unpinned proving asset')

        expect(fetchFn).not.toHaveBeenCalled()
    })
})
