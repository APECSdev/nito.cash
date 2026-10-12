/* apps/web/scripts/visual-baseline.mjs
 *
 * Phase D visual-regression harness. Serves the built `dist-vite/` SPA over a
 * local static server, loads each route in headless Chrome, toggles light/dark
 * theme, and captures full-page screenshots. Run BEFORE a CSS→Tailwind batch
 * (mode `capture`) to record the baseline, then AFTER (mode `compare`) to
 * pixel-diff the same routes and report any visual drift.
 *
 * Usage:
 *   node scripts/visual-baseline.mjs capture   # writes scripts/.baseline/*.png
 *   node scripts/visual-baseline.mjs compare   # diffs current vs baseline
 *
 * Exit code is non-zero if any route drifts beyond the threshold.
 *
 * Determinism notes (hard-won):
 *   - Every request NOT served by the local server is aborted, so live data
 *     (ticker price, balances via rest.bitcoin.com) renders identically (as
 *     empty/error state) for baseline and compare.
 *   - CSS animations/transitions are disabled so a mid-animation frame can't
 *     cause false drift.
 *   - Each route is navigated to DIRECTLY (`/#/setup`), never by loading `/`
 *     then mutating location.hash. Splash.vue mounts a `setTimeout(3000)` that
 *     calls `router.replace('setup')` and its `beforeDestroy` does NOT clear
 *     it; loading `/` first lets that stale timer hijack the target route.
 *   - `requestAnimationFrame` is stubbed to a no-op so Splash's own rAF-driven
 *     animation loop renders a single static frame.
 */
import puppeteer from 'puppeteer-core'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

const ROOT = path.resolve(process.cwd(), 'dist-vite')
const OUT = path.resolve(process.cwd(), 'scripts/.baseline')
const PORT = 5400
const MODE = process.argv[2] || 'capture'

/* Pixel-diff tolerance: allow tiny sub-pixel/font-rendering noise but catch
   any real layout/color change. */
const THRESHOLD = 0.1   // pixelmatch sensitivity
const MAX_DIFF_RATIO = 0.001 // 0.1% of pixels may differ

const ROUTES = [
    ['setup',    '#/setup'],
    ['dashboard','#/dashboard'],
    ['send',     '#/send'],
    ['receive',  '#/receive'],
    ['history',  '#/history'],
    ['settings', '#/settings'],
]
const THEMES = ['light', 'dark']

const mime = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.wav':'audio/wav','.ico':'image/x-icon' }
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/' || p === '') p = '/index.html'
    let f = path.join(ROOT, p)
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html')
    try { res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res) }
    catch (e) { res.statusCode = 404; res.end('nf') }
})
await new Promise(r => server.listen(PORT, '127.0.0.1', r))

fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--force-color-profile=srgb','--hide-scrollbars'],
})

const page = await browser.newPage()
/* Fixed viewport = Desktop shell (768px cap) so screenshots are deterministic. */
await page.setViewport({ width: 1024, height: 900, deviceScaleFactor: 1 })

/* Determinism: block every request that is NOT served by our local static
   server (live ticker/balance data would otherwise differ run-to-run). */
await page.setRequestInterception(true)
page.on('request', (req) => {
    if (req.url().startsWith(`http://127.0.0.1:${PORT}/`)) req.continue()
    else req.abort()
})

/* Freeze rAF so Splash's animation loop renders one static frame. */
await page.evaluateOnNewDocument(() => {
    window.requestAnimationFrame = () => 0
    window.cancelAnimationFrame = () => {}
})

/* Navigate DIRECTLY to a route and screenshot it (never via `/` + hash swap). */
async function shoot(routeName, hash, theme, file) {
    await page.goto(`http://127.0.0.1:${PORT}/${hash}`, { waitUntil: 'load', timeout: 30000 })
    await page.evaluate((t) => {
        document.body.classList.toggle('dark', t === 'dark')
    }, theme)
    await new Promise(r => setTimeout(r, 1600))
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' }).catch(() => {})
    await new Promise(r => setTimeout(r, 100))
    await page.screenshot({ path: file })
}

if (MODE === 'capture') {
    for (const [name, hash] of ROUTES) {
        for (const theme of THEMES) {
            const f = path.join(OUT, `${name}-${theme}.png`)
            await shoot(name, hash, theme, f)
            console.log('captured', `${name}-${theme}.png`)
        }
    }
    console.log('BASELINE_CAPTURED')
} else {
    let failed = 0
    for (const [name, hash] of ROUTES) {
        for (const theme of THEMES) {
            const base = path.join(OUT, `${name}-${theme}.png`)
            const cur = path.join(OUT, `.cur-${name}-${theme}.png`)
            await shoot(name, hash, theme, cur)

            const a = PNG.sync.read(fs.readFileSync(base))
            const b = PNG.sync.read(fs.readFileSync(cur))
            if (a.width !== b.width || a.height !== b.height) {
                console.log(`DIMENSION_MISMATCH ${name}-${theme} ${a.width}x${a.height} vs ${b.width}x${b.height}`)
                failed++
                continue
            }
            const diff = new PNG({ width: a.width, height: a.height })
            const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: THRESHOLD })
            const ratio = n / (a.width * a.height)
            if (ratio > MAX_DIFF_RATIO) {
                failed++
                fs.writeFileSync(path.join(OUT, `.diff-${name}-${theme}.png`), PNG.sync.write(diff))
                console.log(`DRIFT ${name}-${theme} diff=${(ratio*100).toFixed(3)}% (${n}px)`)
            } else {
                console.log(`ok ${name}-${theme} diff=${(ratio*100).toFixed(3)}% (${n}px)`)
            }
            fs.unlinkSync(cur)
        }
    }
    console.log(failed === 0 ? 'COMPARE_PASS' : `COMPARE_FAIL (${failed} routes drifted)`)
    process.exitCode = failed === 0 ? 0 : 1
}

await browser.close()
server.close()
