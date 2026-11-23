// apps/web/src/lib/pool/verifier.js
//
// The on-chain Groth16 VERIFIER-STEP builder — the wallet-side port of the
// zk-verifier-bench `produceTransaction` (mr-zwets/groth16_cashscript,
// chunked/bn254/densless-msm/transaction.mjs) that generated every live pool
// action's five verifier inputs.
//
// A pool action tx spends FIVE "verifier step" UTXOs (P2SH32) alongside the
// pool covenant input. Each step's unlocking bytecode embeds a slice of the
// Groth16 verification computation as data pushes; the step redeem scripts
// (constants of the deployment) consume them and carry the pairing forward
// intra-tx (OP_INPUTBYTECODE). The wallet must construct these unlockings from
// ITS OWN proof, so the two witness generators are ported here as pure
// functions over (@noble/curves bn254 + BigInt):
//
//   · produceWitness(vk, proof, publicInputs)  — the "densless" chunked
//     pairing witness: Miller-loop line functions, the residue cube-root
//     witness { c, cInv, w }, the quotient/aggregate polynomial, the
//     accumulator headers, executor/fixed-table/terminal witnesses and the
//     genesis pushes. (Ported from densless-recovered/witness.mjs +
//     root-witness.mjs; the hashing is libauth sha256 instead of node:crypto.)
//   · msmWitness(n0, n1, vk, split, cuts)      — the GLV/Straus MSM over the
//     two public inputs: vk_x = IC0 + n0·IC1 + n1·IC2. Returns the witness
//     bytes, per-cut accumulator states, zInv and vk_x. (Ported from
//     pairfold5-msm/vkx-msm-asm.mjs's `witness` + gen_vkx_glv.mjs's GLV
//     decomposition; the split table is COMPUTED from the vk, not embedded.)
//   · produceVerifierInputs({ vk, proof, publicSignals, program }) — the
//     transaction assembly: the five unlocking bytecodes, exactly in the
//     layout the deployed step redeem scripts expect.
//
// The PROGRAM constants (step redeem scripts, shared fragments, P2SH32
// lockings, quotient layout) are NOT regenerated here — they are deployment
// constants extracted from the live chain (see lib/pool/verifier-program.js)
// and passed in via `program`. The bench's `build()` fixed-point pipeline
// (shared.mjs/genesis.mjs/terminal.mjs, ~90 KB of program generation) is
// thereby replaced by data, keeping the port to the proof-dependent runtime.
//
// Layout facts (verified against the live chipnet pools, both deployments —
// gate3-demo-pool and the Option B chain share one program):
//   inputs  : pool covenant at 0, exec steps 1–3, GENESIS at 4, TERMINAL at 5
//   genesis : 24 pushes — [.. 19 genesis pushes ..][pad][wa][n1][n0][redeem]
//             n1 (actionHash) data at byte offset 1792, n0 (merkleRoot) at
//             1825 (the deployed covenant reads them there — asset-pool.cash
//             re-indexed to the live layout).
//   quotient: 190 coefficients × 32 B = 6080 = 3×1248 (exec chunks) + 2336 tail
//   MSM     : split 26 (wa = 38 B), cuts [38, 46, 54, 60]
//
// Correctness gate: byte-exact reproduction of the bench's
// artifacts/verifier-vectors.json steps for each public fixture proof
// (tests/unit/lib/pool-verifier.spec.js), then full VM acceptance of the
// assembled inputs against the DEPLOYED lockings on the BCH 2026 VM.

import { bn254 } from '@noble/curves/bn254.js'
import { psiFrobenius } from '@noble/curves/abstract/tower.js'
import { bigIntToVmNumber, encodeDataPush, sha256 } from '@bitauth/libauth'

/* ─── byte helpers (Buffer-free) ─────────────────────────────────────────── */

const concatBytes = (parts) => {
    const total = parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const p of parts) { out.set(p, at); at += p.length }
    return out
}

/** 32-byte big-endian encoding of a non-negative field-sized integer. */
const be32 = (v) => {
    const out = new Uint8Array(32)
    let x = BigInt(v)
    for (let i = 31; i >= 0; i -= 1) { out[i] = Number(x & 0xffn); x >>= 8n }
    return out
}

/** 32-byte fixed little-endian ("fixed32" in the bench). */
const fixed32 = (v) => be32(v).reverse()

/** Minimal VM-number encoding (libauth). */
const num = (v) => new Uint8Array(bigIntToVmNumber(BigInt(v)))

const hexToBytes = (h) => {
    const out = new Uint8Array(h.length / 2)
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
    return out
}

const bytesToHex = (b) => {
    const out = []
    for (const byte of b) out.push(byte.toString(16).padStart(2, '0'))
    return out.join('')
}

const u32 = (x) => new Uint8Array([(x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff])

const assertOk = (cond, msg) => { if (!cond) throw new Error(`pool verifier: ${msg}`) }

const sha256b = (b) => new Uint8Array(sha256.hash(b))
const doubleSha256 = (b) => sha256b(sha256b(b))

/* ─── residue witness (root-witness.mjs) ─────────────────────────────────── */

const { Fp, Fp2, Fp6, Fp12 } = bn254.fields
const BN_X = 4965661367192848881n
const p = Fp.ORDER
const r = bn254.fields.Fr.ORDER
const P12 = p ** 12n - 1n

export const LAMBDA = (6n * BN_X + 2n) + p - p ** 2n + p ** 3n

const tup = (a) => [a.c0.c0.c0, a.c0.c0.c1, a.c0.c1.c0, a.c0.c1.c1, a.c0.c2.c0, a.c0.c2.c1,
    a.c1.c0.c0, a.c1.c0.c1, a.c1.c1.c0, a.c1.c1.c1, a.c1.c2.c0, a.c1.c2.c1]
const eq12 = (a, b) => { const x = tup(a), y = tup(b); return x.every((v, i) => v === y[i]) }
const isOne = (a) => eq12(a, Fp12.ONE)
const f6 = (t) => Fp6.create({ c0: Fp2.fromBigTuple([t[0], t[1]]), c1: Fp2.fromBigTuple([t[2], t[3]]), c2: Fp2.fromBigTuple([t[4], t[5]]) })
const mk12 = (lo, hi) => Fp12.create({ c0: f6(lo), c1: f6(hi) })
const mul12 = (a, b) => Fp12.mul(a, b)
const inv12 = (a) => Fp12.inv(a)
const sqr12 = (a) => Fp12.sqr(a)
const powExact = (a, e) => { let res = Fp12.ONE, base = a; while (e > 0n) { if (e & 1n) res = mul12(res, base); base = sqr12(base); e >>= 1n } return res }

/* 27th root of unity (cubic non-residue in Fp6, only c0.c2 nonzero). */
const ROOT27 = mk12([0n, 0n, 0n, 0n,
    18017241959182010774688792132341824651274886350515952296967734324480226243499n,
    8310587989442958350646884634893221121607168288938349542082022013494928077472n], [0n, 0n, 0n, 0n, 0n, 0n])

export const SCALING = mk12([0n, 0n, 0n, 0n, 1n, 0n], [0n, 0n, 0n, 0n, 0n, 0n])
/* Selector-2 scaling: SCALING^2 / xi (xi = 9 + u) — xi is a cube in Fp12, so the
   coset test is unchanged; with plain SCALING^2 every selector-2 proof was
   rejected at the terminal. */
const XI = Fp12.create({ c0: Fp6.create({ c0: Fp2.fromBigTuple([9n, 1n]), c1: Fp2.ZERO, c2: Fp2.ZERO }), c1: Fp6.ZERO })
export const SCALING2 = mul12(sqr12(SCALING), inv12(XI))

const COSET27 = (() => { const a = []; let x = Fp12.ONE; for (let i = 0; i < 27; i++) { a.push(x); x = mul12(x, ROOT27) } return a })()

const exp1 = P12 / 3n
const modinv = (a, m) => { let [or, rr] = [((a % m) + m) % m, m], [os, s] = [1n, 0n]; while (rr) { const qn = or / rr; [or, rr] = [rr, or - qn * rr]; [os, s] = [s, os - qn * s] } return ((os % m) + m) % m }
const rInv = modinv(r, P12 / r)
const m_ = LAMBDA / (3n * r)
const mInv = modinv(m_, P12)
const U = P12 / 27n
const kFac = (U % 3n === 2n) ? 1n : 2n
const cubeExp = (kFac * U + 1n) / 3n

function cubeRoot(Y) {
    const b = powExact(Y, U)
    let j = -1
    for (let t = 0; t < 9; t++) if (eq12(COSET27[(3 * t) % 27], b)) { j = t; break }
    if (j < 0) throw new Error('pool verifier: not a cube')
    const corr = ((-(kFac * BigInt(j))) % 27n + 27n) % 27n
    return mul12(powExact(Y, cubeExp), COSET27[Number(corr)])
}

/**
 * Given the RAW Miller boundary fRaw, return { c, cInv, w } with c^LAMBDA == fRaw*w
 * (the gnark scaling + clean AMM cube-root residue witness).
 */
function residueWitness(fRaw) {
    let w = null, rw = null
    for (const cand of [Fp12.ONE, SCALING, SCALING2]) { const t = mul12(fRaw, cand); if (isOne(powExact(t, exp1))) { w = cand; rw = t; break } }
    if (!w) throw new Error('pool verifier: no cubic-residue scaling')
    rw = powExact(rw, rInv)
    rw = powExact(rw, mInv)
    const c = cubeRoot(rw)
    return { c, cInv: inv12(c), w }
}

/* ─── pinned deployment tag (constants.mjs) ─────────────────────────────── */

/* Public fixed deployment literal embedded in the recovered genesis program.
   Historical derivation is unknown; do not assume it is a hash of the public VK. */
const deploymentTag = hexToBytes('9c1f30d6d0762b66a52c266e919b1fa2523e199857083d4090abeddb45c41f66')

/* ─── produceWitness (densless-recovered/witness.mjs) ────────────────────── */

const flat = (x) => [x.c0.c0.c0, x.c0.c0.c1, x.c0.c1.c0, x.c0.c1.c1, x.c0.c2.c0, x.c0.c2.c1,
    x.c1.c0.c0, x.c1.c0.c1, x.c1.c1.c0, x.c1.c1.c1, x.c1.c2.c0, x.c1.c2.c1]

/**
 * Normalize a Groth16 proof into the bench's field encoding
 * ({ a: {x,y}, b: {x:{c0,c1}, y:{c0,c1}}, c: {x,y} }, decimal strings).
 * Accepts BOTH common shapes:
 *   · snarkjs `fullProve` output: { pi_a: [x,y,"1"], pi_b: [[..],[..],[..]], pi_c: [x,y,"1"] }
 *     (what the wallet's own prover, lib/pool/prover.js, produces)
 *   · the bench's fixtures: { a: {x, y}, b: {x:{c0,c1}, y:{c0,c1}}, c: {x, y} }
 */
export function normalizeProof(proof) {
    if (proof.a && proof.b && proof.c) return proof
    if (!proof.pi_a || !proof.pi_b || !proof.pi_c) {
        throw new Error('pool verifier: proof must be snarkjs ({pi_a,pi_b,pi_c}) or bench ({a,b,c}) shaped')
    }
    return {
        a: { x: proof.pi_a[0], y: proof.pi_a[1] },
        b: {
            x: { c0: proof.pi_b[0][0], c1: proof.pi_b[0][1] },
            y: { c0: proof.pi_b[1][0], c1: proof.pi_b[1][1] },
        },
        c: { x: proof.pi_c[0], y: proof.pi_c[1] },
    }
}

/**
 * Produce the chunked Groth16 verification witness for (vk, proof, publicInputs).
 * Public inputs = [merkleRoot, actionHash] (decimal strings or BigInts).
 * Returns the pieces produceVerifierInputs assembles into the 5 unlockings.
 */
export function produceWitness(vk, proof, publicInputs) {
    proof = normalizeProof(proof)
    const mod = (x) => (x % p + p) % p
    const point = (x) => bn254.G1.Point.fromAffine({ x: BigInt(x.x), y: BigInt(x.y) })

    let vkx = point(vk.ic[0])
    publicInputs.forEach((x, i) => { const k = BigInt(x); assertOk(k >= 0n && k < bn254.fields.Fr.ORDER, 'public input out of range'); if (k !== 0n) vkx = vkx.add(point(vk.ic[i + 1]).multiply(k)) })
    const vp = vkx.toAffine()

    const fields = [0n, 0n, BigInt(proof.a.x), mod(-BigInt(proof.a.y)), vp.x, vp.y, BigInt(proof.c.x), BigInt(proof.c.y),
        BigInt(proof.b.x.c0), BigInt(proof.b.x.c1), BigInt(proof.b.y.c0), BigInt(proof.b.y.c1), 0n, 0n]

    const factorRows = []
    const line = (cy, cx, cb, x, y) => {
        const value = ({ c0: { c0: Fp2.mul(cy, { c0: y, c1: 0n }), c1: Fp2.ZERO, c2: Fp2.ZERO },
            c1: { c0: Fp2.mul(cx, { c0: x, c1: 0n }), c1: cb, c2: Fp2.ZERO } })
        factorRows[factorRows.length - 1].push(value)
        return value
    }

    const points = [
        bn254.G2.Point.fromAffine({ x: { c0: fields[8], c1: fields[9] }, y: { c0: fields[10], c1: fields[11] } }),
        ...['gamma', 'delta'].map((key) => bn254.G2.Point.fromAffine({
            x: { c0: BigInt(vk[key].x.c0), c1: BigInt(vk[key].x.c1) },
            y: { c0: BigInt(vk[key].y.c0), c1: BigInt(vk[key].y.c1) },
        })),
    ]
    points.forEach((pt) => pt.assertValidity())

    const running = [...points]
    const digits = []
    for (let n = 6n * BN_X + 2n; n > 1n; n >>= 1n) {
        if (!(n & 1n)) digits.unshift(0)
        else if ((n & 3n) === 3n) { digits.unshift(-1); n += 1n }
        else digits.unshift(1)
    }

    /* Public Miller arithmetic: no imported initial state or inverse witness enters raw. */
    const slopeRows = Array.from({ length: 65 }, () => [])
    const bPointsAfter = {}
    let raw = Fp12.ONE
    for (let event = 0; event < digits.length; event++) {
        factorRows.push([])
        raw = sqr12(raw)
        for (let pair = 0; pair < 3; pair++) {
            const a = running[pair].toAffine()
            const slope = Fp2.div(Fp2.mul(Fp2.sqr(a.x), { c0: 3n, c1: 0n }), Fp2.add(a.y, a.y))
            const scale = pair === 0 ? Fp2.neg(Fp2.add(a.y, a.y)) : event === 64 ? Fp2.ONE : Fp2.add(a.y, a.y)
            raw = mul12(raw, line(scale, Fp2.mul(Fp2.neg(slope), scale), Fp2.mul(Fp2.sub(Fp2.mul(slope, a.x), a.y), scale), fields[2 + 2 * pair], fields[3 + 2 * pair]))
            if (pair === 0) slopeRows[event].push(slope.c0, slope.c1)
            running[pair] = running[pair].double()
            if (digits[event]) {
                const target = digits[event] < 0 ? points[pair].negate() : points[pair]
                const b = target.toAffine()
                const a2 = running[pair].toAffine()
                const slope2 = Fp2.div(Fp2.sub(b.y, a2.y), Fp2.sub(b.x, a2.x))
                const scale2 = pair === 0 ? Fp2.sub(a2.x, b.x) : Fp2.ONE
                raw = mul12(raw, line(scale2, Fp2.mul(Fp2.neg(slope2), scale2), Fp2.mul(Fp2.sub(Fp2.mul(slope2, a2.x), a2.y), scale2), fields[2 + 2 * pair], fields[3 + 2 * pair]))
                if (pair === 0) slopeRows[event].push(slope2.c0, slope2.c1)
                running[pair] = running[pair].add(target)
            }
        }
        const a = running[0].toAffine()
        bPointsAfter[event] = [a.x.c0, a.x.c1, a.y.c0, a.y.c1]
    }

    const { psi } = psiFrobenius(Fp, Fp2, Fp2.NONRESIDUE)
    for (let pair = 0; pair < 3; pair++) {
        const q = points[pair].toAffine()
        const q1 = psi(q.x, q.y)
        const q2 = psi(q1[0], q1[1])
        for (const b of [{ x: q1[0], y: q1[1] }, { x: q2[0], y: Fp2.neg(q2[1]) }]) {
            const a = running[pair].toAffine()
            const slope = Fp2.div(Fp2.sub(b.y, a.y), Fp2.sub(b.x, a.x))
            const scale = pair === 0 ? Fp2.sub(a.x, b.x) : Fp2.ONE
            raw = mul12(raw, line(scale, Fp2.mul(Fp2.neg(slope), scale), Fp2.mul(Fp2.sub(Fp2.mul(slope, a.x), a.y), scale), fields[2 + 2 * pair], fields[3 + 2 * pair]))
            if (pair === 0) slopeRows[64].push(slope.c0, slope.c1)
            running[pair] = running[pair].add(bn254.G2.Point.fromAffine(b))
        }
    }
    const alpha = bn254.G1.Point.fromAffine({ x: BigInt(vk.alpha.x), y: BigInt(vk.alpha.y) })
    const beta = bn254.G2.Point.fromAffine({ x: { c0: BigInt(vk.beta.x.c0), c1: BigInt(vk.beta.x.c1) }, y: { c0: BigInt(vk.beta.y.c0), c1: BigInt(vk.beta.y.c1) } })
    raw = mul12(raw, bn254.pairing(alpha, beta, false))
    assertOk(eq12(Fp12.finalExponentiate(raw), Fp12.ONE), 'pairing sanity check failed')

    const witness = residueWitness(raw)
    assertOk(eq12(Fp12.pow(witness.c, LAMBDA), mul12(raw, witness.w)), 'residue witness check failed')

    const polynomial = (c) => {
        const out = Array(12).fill(0n)
        for (const [i, d] of [0, 2, 4, 1, 3, 5].entries()) { out[d] = mod(c[2 * i] - 9n * c[2 * i + 1]); out[d + 6] = c[2 * i + 1] }
        return out
    }
    const multiply = (a, b) => {
        const out = Array(a.length + b.length - 1).fill(0n)
        for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] = mod(out[i + j] + a[i] * b[j])
        return out
    }

    assertOk(factorRows.length === 65, 'factor rows')
    factorRows[64].push(bn254.pairing(alpha, beta, false))
    let accumulated = polynomial(flat(witness.cInv))
    const aggregate = Array(190).fill(0n)
    const states = []
    const quotients = []
    for (let event = 0; event < 65; event++) {
        accumulated = multiply(accumulated, accumulated)
        for (const factor of factorRows[event]) accumulated = multiply(accumulated, polynomial(flat(factor)))
        if (digits[event]) accumulated = multiply(accumulated, polynomial(flat(digits[event] < 0 ? witness.c : witness.cInv)))
        if (event === 0 || event % 2 === 1 || event === 64) {
            const residual = [...accumulated]
            const q = Array(Math.max(1, residual.length - 12)).fill(0n)
            for (let i = residual.length - 1; i >= 12; i--) { const v = residual[i]; q[i - 12] = v; residual[i] = 0n; residual[i - 6] = mod(residual[i - 6] + 18n * v); residual[i - 12] = mod(residual[i - 12] - 82n * v) }
            const reduced = residual.slice(0, 12)
            const exponent = event === 0 ? 0 : event === 64 ? 33 : (event + 1) / 2
            while (q.length > 1 && q[q.length - 1] === 0n) q.pop()
            assertOk(q.length <= 190, 'quotient degree')

            accumulated = reduced
            /* Invert the tower-to-polynomial map to produce wire coefficients. */
            const c = Array(12).fill(0n)
            for (const [i, d] of [0, 2, 4, 1, 3, 5].entries()) { c[2 * i + 1] = reduced[d + 6]; c[2 * i] = mod(reduced[d] + 9n * reduced[d + 6]) }
            states.push({ event, coefficients: c.map(String) })
            quotients.push({ event, degree: q.length - 1, weightExponent: exponent, coefficients: q })
        }
    }

    const fingerprint = (c) => mod(c.reduce((sum, x, i) => sum + BigInt(x) * 7n ** BigInt(i), 0n))
    const selector = [Fp12.ONE, SCALING, SCALING2].findIndex((x) => eq12(x, witness.w))
    assertOk(selector >= 0, 'selector')

    const payload = concatBytes([
        [fields[2], mod(-fields[3]), ...fields.slice(8, 12), fields[6], fields[7], fields[4], fields[5]].map(be32),
        [deploymentTag],
        flat(witness.c).map(be32),
        flat(witness.cInv).map(be32),
        [new Uint8Array([selector])],
    ].flat())
    assertOk(payload.length === 1121, 'payload length')

    let digest = doubleSha256(new TextEncoder().encode('BN254-SZ/g/v4-s-vk'))
    digest = doubleSha256(concatBytes([digest, u32(0), u32(payload.length), payload]))

    const fps = [fingerprint(flat(witness.cInv)), ...states.map((s) => fingerprint(s.coefficients))]
    const stateDigests = {}
    for (const [i, value] of fps.entries()) {
        digest = doubleSha256(concatBytes([digest, u32(i + 1), u32(32), be32(value)]))
        if (i > 0) stateDigests[states[i - 1].event] = digest
    }
    fields[0] = mod(BigInt('0x' + bytesToHex(doubleSha256(concatBytes([digest, new TextEncoder().encode('BN254-SZ/gf/v4-s-vk'), u32(36)])))))
    for (const q of quotients) { const weight = mod(fields[0] ** BigInt(q.weightExponent)); q.coefficients.forEach((v, i) => { aggregate[i] = mod(aggregate[i] + weight * v) }) }
    fields[1] = mod(BigInt('0x' + bytesToHex(doubleSha256(concatBytes([new TextEncoder().encode('BN254-SZ/z/v4-s-vk'), be32(fields[0]), ...aggregate.map(be32)])))))
    const z = fields[1]
    const basis = []
    for (const d of [0n, 2n, 4n, 1n, 3n, 5n]) basis.push(mod(z ** d), mod(z ** d * (z ** 6n - 9n)))

    ;[witness.c, witness.cInv].forEach((x, i) => { fields[12 + i] = mod(flat(x).reduce((sum, c, j) => sum + c * basis[j], 0n)) })

    const fixedTables = [[], [], []]
    for (let event = 1; event <= 63; event++) {
        const row = factorRows[event]
        const stride = digits[event] ? 2 : 1
        const values = []
        for (let column = 0; column < stride; column++) {
            const gamma = flat(row[stride + column])
            const delta = flat(row[2 * stride + column])
            const ge = mod(gamma.reduce((sum, x, i) => sum + x * basis[i], 0n))
            const de = mod(delta.reduce((sum, x, i) => sum + x * basis[i], 0n))
            const be = mod(flat(row[column]).reduce((sum, x, i) => sum + x * basis[i], 0n))
            values.push(mod(be * ge * de))
        }
        fixedTables[event <= 21 ? 0 : event <= 41 ? 1 : 2].push(...values)
    }
    const fixedTableHex = fixedTables.map((values) => concatBytes(values.map((x) => fixed32(x))))
    assertOk(JSON.stringify(fixedTableHex.map((x) => x.length)) === JSON.stringify([928, 832, 928]), 'fixed tables')

    const executorWitnessParts = [[], [], []]
    for (let event = 1; event <= 63; event++) {
        const parts = executorWitnessParts[event <= 21 ? 0 : event <= 41 ? 1 : 2]
        parts.push(...slopeRows[event].map((x) => fixed32(x)))
        if (event % 2 === 1) {
            const state = states.find((s) => s.event === event).coefficients.map(BigInt)
            const evaluation = mod(state.reduce((sum, x, i) => sum + x * basis[i], 0n))
            parts.push(be32(fingerprint(state)), be32(evaluation))
        }
    }
    const executorWitnessHex = executorWitnessParts.map((parts) => concatBytes(parts))
    assertOk(JSON.stringify(executorWitnessHex.map((x) => x.length)) === JSON.stringify([2560, 2304, 2560]), 'executor witnesses')

    let left = 0n, right = 0n
    const accumulatorHeaderHex = []
    const extensionModulus = mod(z ** 12n - 18n * z ** 6n + 82n)
    for (const [i, state] of states.entries()) {
        const c = state.coefficients.map(BigInt)
        const q = quotients[i]
        const reducedEvaluation = mod(c.reduce((sum, x, j) => sum + x * basis[j], 0n))
        let qEvaluation = 0n
        for (let j = q.coefficients.length - 1; j >= 0; j--) qEvaluation = mod(qEvaluation * z + q.coefficients[j])
        const computedEvaluation = mod(reducedEvaluation + qEvaluation * extensionModulus)
        const weight = mod(fields[0] ** BigInt(q.weightExponent))
        left = mod(left + weight * computedEvaluation)
        right = mod(right + weight * reducedEvaluation)
        if ([0, 21, 41, 63].includes(state.event)) {
            const numbers = [left, right, mod(weight * fields[0]), reducedEvaluation, ...bPointsAfter[state.event]]
            const bytes = concatBytes([stateDigests[state.event], new Uint8Array(8), ...numbers.map((x) => fixed32(x))])
            assertOk(bytes.length === 296, 'accumulator header')
            accumulatorHeaderHex.push(bytes)
        }
    }
    assertOk(accumulatorHeaderHex.length === 4, 'accumulator header count')

    /* Terminal certifies the boundary factors and Frobenius subgroup relation. */
    const terminalLineOrder = [9, 8, 7, 6, 5, 2, 1, 4, 3, 0]
    const terminalEvaluations = terminalLineOrder.map((i) => mod(flat(factorRows[64][i]).reduce((sum, x, j) => sum + x * basis[j], 0n)))
    const q0 = points[0].toAffine()
    const q1 = psi(q0.x, q0.y)
    const q2 = psi(q1[0], q1[1])
    const q3 = psi(q2[0], q2[1])
    const terminalValues = [...terminalEvaluations, q1[1].c1, q1[1].c0, q3[0].c1, q3[0].c0]
        .concat([...states[states.length - 1].coefficients].reverse().map(BigInt), flat(witness.cInv).reverse(), flat(witness.c).reverse())
    assertOk(terminalValues.length === 50, 'terminal values')
    /* FIXED 32-byte LE for every terminal witness push (NOT `num`): the runner's
       terminal encoding is fixed-width — a CONFIRMED on-chain action
       (gate3 SHIELD f5927a0b…, block 330438) carries exactly 51 32-byte pushes
       there, while `num` emits a minimal VM-number that becomes 31 bytes
       whenever a value's top byte is zero. Measured 2026-11-23: our terminal
       unlocking was 8707 B vs the confirmed 8708 B, differing ONLY at push[19]
       (31 vs 32 bytes), and the BCH-2026 VM rejected the terminal
       (`OP_VERIFY failed`). Field elements are < 2^254, so fixed32 is exact. */
    const terminalWitnessHex = terminalValues.map((x) => fixed32(x))

    /* FIXED 32-byte LE for every genesis field push (NOT `num`): the genesis
       witness is FIXED-OFFSET — the covenant reads n1 at byte 1792 and n0 at
       1825, so a 31-byte minimal encoding of any preceding push shifts them
       and the action is unspendable (hit live 2026-11-23: a proof whose n1
       had a zero top byte produced a 31-byte push → `Invalid OP_SPLIT
       range`). Field elements are < 2^254, so le32 is always exact. */
    const genesisKnownPushes = {
        0: concatBytes(fields.map((x) => fixed32(x))),
        2: fixed32(mod(-flat(factorRows[0][2]).reduce((sum, x, i) => sum + x * basis[i], 0n))),
        3: fixed32(mod(-flat(factorRows[0][1]).reduce((sum, x, i) => sum + x * basis[i], 0n))),
        4: fixed32(slopeRows[0][1]),
        5: fixed32(slopeRows[0][0]),
        18: concatBytes([...flat(witness.c), ...flat(witness.cInv)].map(be32)),
        38: fixed32(BigInt(publicInputs[1])),
        39: fixed32(BigInt(publicInputs[0])),
    }
    ;[...states[0].coefficients].reverse().forEach((x, i) => { genesisKnownPushes[6 + i] = fixed32(BigInt(x)) })

    return {
        genesisKnownPushes,
        terminalWitnessHex,
        accumulatorHeaderHex,
        executorWitnessHex,
        fixedTableHex,
        fields: fields.map(String),
        c: flat(witness.c).map(String),
        cInv: flat(witness.cInv).map(String),
        selector,
        states,
        quotient: aggregate.map(String),
        transcriptFinalDigest: bytesToHex(digest),
    }
}

/* ─── GLV decomposition (pairing/gen_vkx_glv.mjs) ────────────────────────── */

const modpow = (b, e, m) => { let R = 1n; b = ((b % m) + m) % m; while (e > 0n) { if (e & 1n) R = (R * b) % m; b = (b * b) % m; e >>= 1n } return R }
const cru = (m) => { for (let g = 2n; g < 100n; g++) { const w = modpow(g, (m - 1n) / 3n, m); if (w !== 1n && (w * w % m * w % m) === 1n) return w } }
const isqrt = (n) => { let x = n, y = (n + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n } return x }

function glvBasis(n, lam) {
    let r0 = n, r1 = lam, t0 = 0n, t1 = 1n
    const s = isqrt(n)
    const seq = [{ r: r0, t: t0 }, { r: r1, t: t1 }]
    while (r1 >= s) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [t0, t1] = [t1, t0 - q * t1]; seq.push({ r: r1, t: t1 }) }
    const l = seq.findIndex((e) => e.r < s)
    const v1 = { a: seq[l].r, b: -seq[l].t }
    const c1 = { a: seq[l - 1].r, b: -seq[l - 1].t }
    const c2 = seq[l + 1] ? { a: seq[l + 1].r, b: -seq[l + 1].t } : c1
    const nrm = (v) => v.a * v.a + v.b * v.b
    const v2 = nrm(c1) <= nrm(c2) ? c1 : c2
    return { a1: v1.a, b1: v1.b, a2: v2.a, b2: v2.b }
}

const rnd = (numerator, denominator) => {
    const q = numerator / denominator, rem = numerator - q * denominator
    const t = 2n * (rem < 0n ? -rem : rem)
    let res = q
    if (t > denominator) res += ((numerator < 0n) !== (denominator < 0n)) ? -1n : 1n
    return res
}

const GLV_BOUND = 1n << 128n

/** GLV decomposition of k into NON-NEGATIVE (k1,k2), k = k1 + k2*lambda (mod r), <=128 bits. */
function glvDecompose(k, a1, b1, a2, b2) {
    const c1 = rnd(b2 * k, r), c2 = rnd(-b1 * k, r)
    let k1 = k - c1 * a1 - c2 * a2, k2 = -c1 * b1 - c2 * b2
    let best = null
    for (let i = -1n; i <= 1n; i++) for (let j = -1n; j <= 1n; j++) {
        const x = k1 + i * a1 + j * a2, y = k2 + i * b1 + j * b2
        if (x >= 0n && y >= 0n) { const sc = x > y ? x : y; if (best === null || sc < best.s) best = { x, y, s: sc } }
    }
    return [best.x, best.y]
}

/**
 * Jointly choose exact bounded GLV representatives with the fewest Straus
 * additions. Every other representative differs by i*(a1,b1)+j*(a2,b2); both
 * the returned representative and the nearest-plane seed lie in [0,2^128)^2, so
 * Cramer's rule bounds |i|,|j| — the search is exhaustive. Ties prefer the
 * shorter combined bit length, then the lexicographically smaller witness tuple
 * (deterministic vector generation).
 */
function glvDecomposeJoint(k0, k1, a1, b1, a2, b2, lam) {
    if (k0 < 0n || k0 >= r || k1 < 0n || k1 >= r) throw new Error('pool verifier: joint GLV inputs must be canonical scalars')
    const determinant = a1 * b2 - a2 * b1
    assertOk((determinant < 0n ? -determinant : determinant) === r, 'invalid GLV lattice determinant')
    assertOk((a1 + b1 * lam) % r === 0n && (a2 + b2 * lam) % r === 0n, 'invalid GLV lattice basis')

    const abs = (value) => (value < 0n ? -value : value)
    const iBound = Number((GLV_BOUND * (abs(a2) + abs(b2)) + r - 1n) / r + 1n)
    const jBound = Number((GLV_BOUND * (abs(a1) + abs(b1)) + r - 1n) / r + 1n)
    const candidates = [k0, k1].map((scalar) => {
        const [baseX, baseY] = glvDecompose(scalar, a1, b1, a2, b2)
        if (baseX < 0n || baseX >= GLV_BOUND || baseY < 0n || baseY >= GLV_BOUND) throw new Error('pool verifier: nearest-plane GLV seed is outside the exhaustive search box')
        const bounded = []
        for (let i = -iBound; i <= iBound; i++) {
            for (let j = -jBound; j <= jBound; j++) {
                const x = baseX + BigInt(i) * a1 + BigInt(j) * a2
                const y = baseY + BigInt(i) * b1 + BigInt(j) * b2
                if (x >= 0n && x < GLV_BOUND && y >= 0n && y < GLV_BOUND) bounded.push([x, y])
            }
        }
        return bounded
    })
    let best = null
    for (const [k10, k20] of candidates[0]) {
        for (const [k11, k21] of candidates[1]) {
            const scalars = [k10, k20, k11, k21]
            const union = k10 | k20 | k11 | k21
            const bits = union.toString(2)
            const score = [bits.replaceAll('0', '').length, union === 0n ? 0 : bits.length, ...scalars]
            let better = best === null
            if (best !== null) {
                for (let index = 0; index < score.length; index++) {
                    if (score[index] === best.score[index]) continue
                    better = score[index] < best.score[index]
                    break
                }
            }
            if (better) best = { scalars, score }
        }
    }
    return best.scalars
}

/* ─── msmWitness (pairfold5-msm/vkx-msm-asm.mjs `witness`) ───────────────── */

const jmod = (x) => ((x % p) + p) % p
const dblJ = ([X, Y, Z]) => {
    const a = jmod(X * X), b = jmod(Y * Y), c = jmod(b * b), d = jmod(4n * X * b)
    const e = 3n * a, f = jmod(e * e), nx = jmod(f - 2n * d)
    return [nx, jmod((d - nx) * e - 8n * c), jmod(2n * Y * Z)]
}
const maddJ = ([X, Y, Z], [bx, by]) => {
    const z1z1 = jmod(Z * Z), u2 = jmod(bx * z1z1)
    if (u2 === X) throw new Error('pool verifier: exceptional mixed add (equal x)')
    const s2 = jmod(jmod(z1z1 * Z) * by), h = jmod(u2 - X), rr = jmod(s2 - Y)
    const hh = jmod(h * h), hhh = jmod(h * hh), vv = jmod(hh * X), nx = jmod(rr * rr - hhh - 2n * vv)
    return [nx, jmod((vv - nx) * rr - Y * hhh), jmod(Z * h)]
}

/**
 * The GLV/Straus MSM witness over the two public inputs:
 * vk_x = IC0 + n0·IC1 + n1·IC2 via 4-scalar GLV Straus over
 * {IC1, phi(IC1), IC2, phi(IC2)}, two 64-bit halves sharing 64 doublings.
 * Witness: one byte per position (MSB-first), idx0 + 16*idx64. The accumulator
 * starts at Q0 = G1 generator and the final step adds IC0 - [2^64]Q0.
 *
 * Returns { wa, wb, w, states, st, zInv, vkx } — the pieces the genesis
 * (part A), execs (states) and terminal (part B) pushes carry.
 */
export function msmWitness(n0, n1, vk, split = 26, cuts = [38, 46, 54, 60]) {
    const G1 = bn254.G1.Point

    /* Endomorphism + GLV lattice constants, derived from the vk (deterministic). */
    const phiPt = (Pt, beta) => { const a = Pt.toAffine(); return G1.fromAffine({ x: (a.x * beta) % p, y: a.y }) }
    const ic = vk.ic.map((pt) => G1.fromAffine({ x: BigInt(pt.x), y: BigInt(pt.y) }))
    let BETA = null, LAM = null
    for (const be of [cru(p), (cru(p) ** 2n) % p]) for (const la of [cru(r), (cru(r) ** 2n) % r]) {
        if (phiPt(ic[1], be).equals(ic[1].multiplyUnsafe(la))) { BETA = be; LAM = la }
    }
    const { a1, b1, a2, b2 } = glvBasis(r, LAM)

    /* The 16-entry Straus subset-sum tables, per 64-bit half group. */
    const BP = [ic[1], phiPt(ic[1], BETA), ic[2], phiPt(ic[2], BETA)]
    const shiftedTables = [1n, 1n << 64n].map((shift) => {
        const bases = BP.map((pt) => pt.multiplyUnsafe(shift))
        const table = []
        for (let idx = 1; idx < 16; idx++) {
            let acc = G1.ZERO
            for (let i = 0; i < 4; i++) if (idx & (1 << i)) acc = acc.add(bases[i])
            table[idx] = acc.toAffine()
        }
        return table
    })
    const entry = (half, idx) => {
        const a = shiftedTables[half][idx]
        return [a.x, a.y]
    }

    const Q0 = G1.BASE.toAffine()
    const FINAL = ic[0].subtract(G1.BASE.multiply(1n << 64n)).toAffine()

    const ks = glvDecomposeJoint(n0, n1, a1, b1, a2, b2, LAM)
    const nib = (i) => ks.reduce((acc, k, j) => acc + (Number((k >> BigInt(i)) & 1n) << j), 0)
    const bytes = new Uint8Array(Array.from({ length: 64 }, (_, t) => nib(63 - t) + 16 * nib(127 - t)))

    const mod = (x) => ((x % p) + p) % p
    let acc = [Q0.x, Q0.y, 1n]
    let st = null
    const states = {}
    for (let t = 0; t < 64; t++) {
        acc = dblJ(acc)
        if (bytes[t] % 16) acc = maddJ(acc, entry(0, bytes[t] % 16))
        if (bytes[t] >> 4) acc = maddJ(acc, entry(1, bytes[t] >> 4))
        if (cuts.includes(t + 1)) states[t + 1] = [...acc]
        if (t === 63 - split) st = concatBytes([...acc, n0, n1].map(fixed32).concat([bytes.subarray(0, 64 - split)]))
    }
    acc = maddJ(acc, [FINAL.x, FINAL.y])
    const zInv = bn254.fields.Fp.inv(acc[2])
    const vx = mod(acc[0] * zInv * zInv), vy = mod(acc[1] * zInv * zInv * zInv)

    /* Reference check: the Jacobian walk must equal the direct MSM. */
    let v = ic[0]
    if (n0 !== 0n) v = v.add(ic[1].multiply(n0))
    if (n1 !== 0n) v = v.add(ic[2].multiply(n1))
    const a = v.toAffine()
    if (a.x !== vx || a.y !== vy) throw new Error('pool verifier: MSM reference mismatch')

    return {
        wa: bytes.subarray(0, 64 - split),
        wb: bytes.subarray(64 - split),
        w: bytes,
        states,
        st,
        zInv,
        vkx: concatBytes([fixed32(vx), fixed32(vy)]),
    }
}

/* ─── produceVerifierInputs (densless-msm/transaction.mjs produceTransaction) ─ */

/**
 * Assemble the five verifier-step unlocking bytecodes for a proof.
 *
 * @param vk           the pool's verification key (verification_key.json shape)
 * @param proof        the Groth16 proof ({ a, b, c } with snarkjs field encodings)
 * @param publicSignals the proof's public signals [merkleRoot, actionHash]
 *                      (decimal strings or BigInts)
 * @param program      the deployed program constants:
 *                     { redeems[5], sharedFragments[3], quotientLengths[3],
 *                       quotientSuffixes[3], stagePads[4], genesisPad,
 *                       msmSplit, cuts } — hex strings or Uint8Array.
 * @returns the five { unlocking } bytecodes in step order
 *          [exec0, exec1, exec2, genesis, terminal] — tx inputs 1..5.
 */
export function produceVerifierInputs({ vk, proof, publicSignals, program }) {
    const w = produceWitness(vk, normalizeProof(proof), publicSignals)
    const quotient = concatBytes(w.quotient.map((x) => be32(BigInt(x))))

    const n0 = BigInt(publicSignals[0]), n1 = BigInt(publicSignals[1])
    const msmSplit = program.msmSplit ?? 26
    const cuts = program.cuts ?? [38, 46, 54, 60]
    const m = msmWitness(n0, n1, vk, msmSplit, cuts)

    /* MSM stage state pushes: the accumulator after witness byte CUTS[k],
       n0, n1 and all 64 witness bytes. */
    const state = (k) => concatBytes([...[...m.states[cuts[k]], n0, n1].map(fixed32), m.w])

    const stagePads = program.stagePads ?? [0, 0, 0, 0]
    const pad = (k) => (k < 3 ? stagePads.slice(0, 3).some(Boolean) : stagePads[3] > 0) ? [new Uint8Array(stagePads[k])] : []

    const redeems = program.redeems.map(hexToBytes)
    const sharedFragments = program.sharedFragments.map(hexToBytes)
    const quotientLengths = program.quotientLengths ?? [1248, 1248, 1248]
    const quotientSuffixes = (program.quotientSuffixes ?? [[], [], []]).map(hexToBytes)

    /* The vk_x the MSM computes must be the one the genesis push 0 carries
       (fields 4, 5), which the terminal stage checks. */
    assertOk(bytesToHex(m.vkx) === bytesToHex(w.genesisKnownPushes[0].slice(128, 192)), 'MSM vk_x binding')

    const inputs = []
    let offset = 0
    for (let i = 0; i < 3; i++) {
        const length = quotientLengths[i]
        inputs.push([
            w.accumulatorHeaderHex[i],
            sharedFragments[i],
            w.executorWitnessHex[i],
            w.fixedTableHex[i],
            concatBytes([quotient.subarray(offset, offset + length), quotientSuffixes[i]]),
            ...pad(i),
            state(i),
            redeems[i],
        ])
        offset += length
    }

    /* Sliced genesis: the densless pushes 19..39 (dead predicate, n1, n0) are gone. */
    const genesis = new Array(19)
    for (const [index, value] of Object.entries(w.genesisKnownPushes)) if (Number(index) < 19) genesis[Number(index)] = value
    /* The selector MUST encode to exactly ONE byte in the FIXED-OFFSET
       witness layout (the covenant reads n1 at byte 1792 / n0 at 1825): the
       VM-number form gives OP_0 / OP_1 / OP_2 for selectors 0 / 1 / 2 — all
       one byte. A raw `Uint8Array.of(0)` would encode as `01 00` (two bytes)
       and shift the whole witness by one, exactly the failure mode that makes
       a selector-0 proof unspendable. */
    genesis[1] = num(BigInt(w.selector))
    assertOk(genesis.every((x) => x !== undefined), 'genesis pushes incomplete')

    /* Genesis carries MSM part A: its pushes (wa, n1, n0) follow the genesis pad. */
    inputs.push([
        ...genesis,
        new Uint8Array(program.genesisPad ?? 0),
        m.wa,
        fixed32(n1),
        fixed32(n0),
        redeems[3],
    ])

    /* The terminal carries the final MSM stage: pushes (pad), zInv, state after
       the redeem's own pushes. */
    assertOk(quotient.length - offset === 2336, 'quotient tail length')
    inputs.push([
        w.accumulatorHeaderHex[3],
        quotient.subarray(offset),
        ...w.terminalWitnessHex,
        ...pad(3),
        fixed32(m.zInv),
        state(3),
        redeems[4],
    ])

    return inputs.map((pushes) => concatBytes(pushes.map((push) => new Uint8Array(encodeDataPush(push)))))
}
