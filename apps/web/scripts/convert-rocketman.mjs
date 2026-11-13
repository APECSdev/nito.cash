// Convert the original svg-icons/rocketman.svg into an animated Lottie
// (src/components/animations/rocketman.json) with 1:1 geometry: every SVG
// path is parsed (M/m L/l H/h V/v C/c S/s A/a Z/z — incl. arc->cubic) and
// emitted as exact Lottie bezier shapes with its original fill. Subpaths are
// classified into layers (paint-order preserved) that carry the animation:
// diver+pack bob, cloud drift, exhaust-flame flicker, speckle twinkle.
// Dev-only; run: node scripts/convert-rocketman.mjs
import { readFileSync, writeFileSync } from 'fs'

const SVG = readFileSync(new URL('../svg-icons/rocketman.svg', import.meta.url), 'utf8')
const OUT = new URL('../src/components/animations/rocketman.json', import.meta.url)

// ---------- path parsing ----------
// endpoint->center arc parameterization, split <=90deg, kappa cubics
const arcToCubics = (x0, y0, rx, ry, rotDeg, laf, sf, x1, y1) => {
  if (rx === 0 || ry === 0) return [{ c1: null, c2: null, p: [x1, y1] }]
  const rad = Math.PI / 180, rot = rotDeg * rad
  const cosr = Math.cos(rot), sinr = Math.sin(rot)
  const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2
  const x1t = cosr * dx + sinr * dy, y1t = -sinr * dx + cosr * dy
  rx = Math.abs(rx); ry = Math.abs(ry)
  const lam = (x1t * x1t) / (rx * rx) + (y1t * y1t) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const sgn = laf !== sf ? 1 : -1
  const num = rx * rx * ry * ry - rx * rx * y1t * y1t - ry * ry * x1t * x1t
  const den = rx * rx * y1t * y1t + ry * ry * x1t * x1t
  const co = sgn * Math.sqrt(Math.max(0, num / den))
  const cxt = co * rx * y1t / ry, cyt = -co * ry * x1t / rx
  const cxr = cosr * cxt - sinr * cyt + (x0 + x1) / 2
  const cyr = sinr * cxt + cosr * cyt + (y0 + y1) / 2
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy, len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }
  const th0 = ang(1, 0, (x1t - cxt) / rx, (y1t - cyt) / ry)
  let dth = ang((x1t - cxt) / rx, (y1t - cyt) / ry, (-x1t - cxt) / rx, (-y1t - cyt) / ry)
  if (!sf && dth > 0) dth -= 2 * Math.PI
  if (sf && dth < 0) dth += 2 * Math.PI
  const n = Math.ceil(Math.abs(dth) / (Math.PI / 2))
  const out = []
  let th = th0, delta = dth / n
  const k = (4 / 3) * Math.tan(delta / 4)
  let px = x0, py = y0
  for (let i = 0; i < n; i++) {
    const t0 = th, t1 = th + delta
    const c1 = [px + k * (-rx * Math.cos(rot) * Math.sin(t0) - ry * Math.sin(rot) * Math.cos(t0)),
                py + k * (-rx * Math.sin(rot) * Math.sin(t0) + ry * Math.cos(rot) * Math.cos(t0))]
    const ex = cxr + rx * Math.cos(rot) * Math.cos(t1) - ry * Math.sin(rot) * Math.sin(t1)
    const ey = cyr + rx * Math.sin(rot) * Math.cos(t1) + ry * Math.cos(rot) * Math.sin(t1)
    const c2 = [ex + k * (rx * Math.cos(rot) * Math.sin(t1) + ry * Math.sin(rot) * Math.cos(t1)),
                ey + k * (rx * Math.sin(rot) * Math.sin(t1) - ry * Math.cos(rot) * Math.cos(t1))]
    out.push({ c1, c2, p: [ex, ey] })
    px = ex; py = ey; th = t1
  }
  return out
}

// Char-cursor parser — needed because SVG arc flags concatenate without
// separators ("a.499.499 0 00-.263.132" = rx ry rot flag flag x y).
const parsePath = (d) => {
  let i = 0
  const ws = () => { while (i < d.length && /[\s,]/.test(d[i])) i++ }
  const num = () => {
    ws()
    const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(i))
    if (!m) return null
    i += m[0].length
    return parseFloat(m[0])
  }
  const flag = () => { ws(); const c = d[i]; if (c === '0' || c === '1') { i++; return +c } return null }
  const cmdChar = () => { ws(); const c = d[i]; if (/[a-zA-Z]/.test(c)) { i++; return c } return null }
  const subs = []
  let cx = 0, cy = 0, sx = 0, sy = 0, lastC2 = null, lastCmd = null
  let sub = null
  const newSub = () => { sub = { start: [sx, sy], segs: [], closed: false }; subs.push(sub) }
  newSub()
  let done = false
  while (!done) {
    const c = cmdChar()
    let C
    if (c) C = c
    else {
      ws()
      if (i >= d.length) { done = true; continue }
      C = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd
      if (!C || C === 'Z' || C === 'z') { done = true; continue } // implicit z-repeat is meaningless
    }
    const U = C.toUpperCase(), rel = C === C.toLowerCase()
    if (U === 'M') {
      const x = num(), y = num()
      if (x === null || y === null) { done = true; break }
      cx = rel ? cx + x : x; cy = rel ? cy + y : y
      sx = cx; sy = cy; newSub(); lastC2 = null; lastCmd = C; continue
    }
    if (U === 'L') {
      const x = num(), y = num()
      if (x === null || y === null) { done = true; break }
      cx = rel ? cx + x : x; cy = rel ? cy + y : y
      sub.segs.push({ c: null, p: [cx, cy] }); lastC2 = null; lastCmd = C; continue
    }
    if (U === 'H' || U === 'V') {
      const x = num()
      if (x === null) { done = true; break }
      if (U === 'H') cx = rel ? cx + x : x; else cy = rel ? cy + x : x
      sub.segs.push({ c: null, p: [cx, cy] }); lastC2 = null; lastCmd = C; continue
    }
    if (U === 'C') {
      const v = [num(), num(), num(), num(), num(), num()]
      if (v.some(n => n === null)) { done = true; break }
      let c1 = [v[0], v[1]], c2 = [v[2], v[3]], ex = v[4], ey = v[5]
      if (rel) { c1 = [cx + v[0], cy + v[1]]; c2 = [cx + v[2], cy + v[3]]; ex = cx + v[4]; ey = cy + v[5] }
      cx = ex; cy = ey
      sub.segs.push({ c: [c1, c2], p: [cx, cy] }); lastC2 = c2; lastCmd = C; continue
    }
    if (U === 'S') {
      const v = [num(), num(), num(), num()]
      if (v.some(n => n === null)) { done = true; break }
      const r = lastC2 ? [2 * cx - lastC2[0], 2 * cy - lastC2[1]] : [cx, cy]
      let c1 = r, c2 = [v[0], v[1]], ex = v[2], ey = v[3]
      if (rel) { c2 = [cx + v[0], cy + v[1]]; ex = cx + v[2]; ey = cy + v[3] }
      cx = ex; cy = ey
      sub.segs.push({ c: [c1, c2], p: [cx, cy] }); lastC2 = c2; lastCmd = C; continue
    }
    if (U === 'A') {
      const rx = num(), ry = num(), rot = num(), laf = flag(), sf = flag(), x = num(), y = num()
      if (rx === null || ry === null || rot === null || laf === null || sf === null || x === null || y === null) { done = true; break }
      const ex = rel ? cx + x : x, ey = rel ? cy + y : y
      const cs = arcToCubics(cx, cy, Math.abs(rx), Math.abs(ry), rot, laf, sf, ex, ey)
      for (const s of cs) sub.segs.push({ c: [s.c1, s.c2], p: s.p })
      cx = ex; cy = ey; lastC2 = cs[cs.length - 1].c2; lastCmd = C; continue
    }
    if (U === 'Z') {
      if (sub.segs.length) {
        const lp = sub.segs[sub.segs.length - 1].p
        if (Math.abs(lp[0] - sx) > 1e-6 || Math.abs(lp[1] - sy) > 1e-6) sub.segs.push({ c: null, p: [sx, sy] })
      }
      sub.closed = true
      cx = sx; cy = sy; lastC2 = null; newSub(); lastCmd = C; continue
    }
    done = true
  }
  return subs.filter(s => s.segs.length)
}

const toLottieBezier = (sub) => {
  const verts = [sub.start]
  const outT = []
  for (let k = 0; k < sub.segs.length; k++) {
    const s = sub.segs[k]
    // o[k] = outgoing tangent at vertex k = c1 of segment k (leaves vertex k)
    outT.push(s.c ? [s.c[0][0] - verts[k][0], s.c[0][1] - verts[k][1]] : [0, 0])
    verts.push(s.p)
  }
  const segs = sub.segs
  const last = segs[segs.length - 1]
  // i[k] = incoming tangent at vertex k = c2 of the ARRIVING segment (k-1)
  const inT = []
  // vertex 0: closed paths arrive via the last segment; open paths have none
  inT.push(sub.closed
    ? (last.c ? [last.c[1][0] - verts[0][0], last.c[1][1] - verts[0][1]] : [0, 0])
    : [0, 0])
  for (let k = 1; k <= segs.length; k++) {
    const s = segs[k - 1]
    inT.push(s.c ? [s.c[1][0] - verts[k][0], s.c[1][1] - verts[k][1]] : [0, 0])
  }
  // i/o/v must be equal length: the final vertex needs an outgoing tangent —
  // closed paths wrap (segment 0 leaves it again), open paths just end.
  outT.push(sub.closed ? outT[0] : [0, 0])
  return { c: sub.closed, i: inT, o: outT, v: verts }
}

// ---------- extraction ----------
const pathRe = /<path\b([^>]*)>/g
const paths = []
let m
while ((m = pathRe.exec(SVG))) {
  const attrs = m[1]
  const d = (attrs.match(/d="([^"]+)"/) || [])[1]
  if (!d) continue
  const fill = (attrs.match(/fill="([^"]+)"/) || [])[1] || 'none'
  const fo = attrs.match(/fill-opacity="([^"]+)"/)
  const evenodd = /fill-rule="evenodd"/.test(attrs) || /clip-rule="evenodd"/.test(attrs)
  paths.push({ d, fill, fo: fo ? parseFloat(fo[1]) : 1, evenodd })
}
console.log('paths extracted:', paths.length)
if (paths.length !== (SVG.match(/<path\b/g) || []).length) throw new Error('regex missed paths')

// ---------- flatten to subpath records ----------
const subsAll = []
paths.forEach((p, pi) => {
  for (const sub of parsePath(p.d)) subsAll.push({ p, pi, sub })
})
console.log('subpaths:', subsAll.length)

const bboxOf = (segs) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
  for (const seg of segs) {
    const pts = [seg.p]; if (seg.c) pts.push(seg.c[0], seg.c[1])
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}
// parent-level bbox (control-point-inclusive; the bush-overlay
// misclassification is handled by the rule ORDER below, not here)
const parentBBox = (pi) => bboxOf(subsAll.filter(s => s.pi === pi).flatMap(s => s.sub.segs))

let firstRig = -1
paths.forEach((p, i) => { if (firstRig < 0 && p.fill === '#2F2F2F') firstRig = i })

const groups = { bg: [], clouds: [], diver: [], rig: [], flame: [], bush: [], speckA: [], speckB: [] }
let speckN = 0
subsAll.forEach((rec) => {
  const pb = parentBBox(rec.pi)
  const sb = bboxOf(rec.sub.segs)
  if (pb.w > 150 && rec.p.fill === '#4CC3FF') return groups.bg.push(rec)
  if (rec.p.fill === '#FFECC6' || rec.p.fill === '#EF562D') return groups.flame.push(rec)
  if (rec.p.fill === '#FFCD4D' || (rec.p.fill === '#fff' && rec.p.fo < 1)) return groups.bush.push(rec)
  if (pb.w > 150 && (rec.p.fill === '#fff' || rec.p.fill === '#F0F4F5')) return groups.clouds.push(rec)
  if (sb.w < 6 && sb.h < 6) {
    // tiny subpaths are the spray/sparkle dots (dark spray lives inside the
    // robot-hand path element, amber dots + cyan antenna nub are their own)
    return (speckN++ % 2 ? groups.speckA : groups.speckB).push(rec)
  }
  if (firstRig >= 0 && rec.pi >= firstRig) return groups.rig.push(rec)
  return groups.diver.push(rec)
})
console.log('groups:', Object.entries(groups).map(([k, v]) => `${k}:${v.length}`).join(' '))
const used = Object.values(groups).reduce((a, g) => a + g.length, 0)
if (used !== subsAll.length) throw new Error(`classification lost subpaths: ${used} != ${subsAll.length}`)

// ---------- lottie assembly ----------
const col = (hex) => {
  const h = hex.replace('#', '')
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) / 255)
}
const ease = { i: { x: [0.42], y: [1] }, o: { x: [0.58], y: [0] } }
const animP = (frames) => ({
  a: 1,
  k: frames.map((f, i) => ({ t: f[0], s: f[1], ...(i < frames.length - 1 && ease) }))
})

const staticTr = () => ({
  ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 }, o: { a: 0, k: 100 }
})
const shapeGroup = (rec, tr) => ({
  ty: 'gr', nm: 'g', it: [
    { ty: 'sh', ks: { a: 0, k: toLottieBezier(rec.sub) }, nm: 'p' },
    { ty: 'fl', c: { a: 0, k: [...col(rec.p.fill), 1] }, o: { a: 0, k: Math.round(rec.p.fo * 100) }, r: rec.p.evenodd ? 2 : 1, nm: 'f' },
    tr || staticTr()
  ]
})
// NOTE: this lottie-web build requires i/o easing descriptors on every
// non-last keyframe — s-only keyframe chains break path rendering.
const kfE = (t, s, last = false) => ({ t, s, ...(last ? {} : ease) })
// exhaust flame flicker around its centroid
const flameTr = () => ({
  ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [97, 78] },
  s: { a: 1, k: [
    kfE(0, [100, 100]), kfE(18, [94, 90]), kfE(36, [100, 100]),
    kfE(54, [96, 92]), kfE(72, [100, 100]), kfE(90, [93, 89]),
    kfE(108, [100, 100]), kfE(126, [95, 91]), kfE(144, [100, 100]),
    kfE(162, [94, 90]), kfE(180, [100, 100]), kfE(198, [96, 92]),
    kfE(216, [100, 100]), kfE(228, [94, 90]), kfE(240, [100, 100], true)
  ] },
  r: { a: 0, k: 0 }, o: { a: 0, k: 100 }
})
// speckle twinkle (uniform per group; two groups out of phase; keyframes
// strictly increasing 0..240 and loop-closed)
const speckTr = (offset) => ({
  ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 1, k: Array.from({ length: 7 }, (_, j) =>
    kfE(j * 40, [((j * 40 + offset) / 40) % 2 ? 35 : 100], j === 6)) }
})

const bob = animP([[0, [0, 0]], [40, [0, -6]], [80, [0, 0]], [120, [0, -6]], [160, [0, 0]], [200, [0, -6]], [240, [0, 0]]])
const drift = animP([[0, [0, 0]], [120, [7, 0]], [240, [0, 0]]])

const layer = (ind, nm, shapes, p) => ({
  ddd: 0, ind, ty: 4, nm, sr: 1,
  ks: {
    o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p, a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100, 100] }
  },
  ao: 0, shapes, ip: 0, op: 240, st: 0, bm: 0
})

// NOTE on paint order: lottie-web appends SVG in REVERSE array order —
// array[0] renders ON TOP (verified empirically). The classified lists are
// in SVG paint order (bottom-first), so each layer's groups are reversed.
const layers = [
  layer(1, 'speckles', [
    ...groups.speckA.map(r => shapeGroup(r, speckTr(0))),
    ...groups.speckB.map(r => shapeGroup(r, speckTr(40)))
  ].reverse(), { a: 0, k: [0, 0] }),
  layer(2, 'bush', groups.bush.map(r => shapeGroup(r)).reverse(), { a: 0, k: [0, 0] }),
  layer(3, 'flames', groups.flame.map(r => shapeGroup(r, flameTr())).reverse(), { a: 0, k: [0, 0] }),
  layer(4, 'rig', groups.rig.map(r => shapeGroup(r)).reverse(), bob),
  layer(5, 'diver', groups.diver.map(r => shapeGroup(r)).reverse(), bob),
  layer(6, 'clouds', groups.clouds.map(r => shapeGroup(r)).reverse(), drift),
  layer(7, 'bg', groups.bg.map(r => shapeGroup(r)).reverse(), { a: 0, k: [0, 0] })
]

const anim = {
  v: '5.7.4', fr: 60, ip: 0, op: 240, w: 194, h: 242, nm: 'rocketman', ddd: 0,
  assets: [], layers, markers: []
}

const json = JSON.stringify(anim)
if (/NaN|Infinity/.test(json)) throw new Error('NaN in output')
writeFileSync(OUT, json)
console.log('written:', OUT.pathname.replace(/^.*apps\/web/, 'apps/web'), `${(json.length / 1024).toFixed(1)} KB`)
