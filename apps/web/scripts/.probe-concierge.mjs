/* Probe computed styles of the Concierge sub-view root <main> elements
   (Lobby/Earn/Spend) to resolve the Concierge-scoped vs sub-view-scoped
   `main` cascade empirically (both are specificity (0,1,1)). */
import http from 'http'
import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve('dist-vite')
const PORT = 8125
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/' || p === '') p = '/index.html'
    let f = path.join(ROOT, p)
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html')
    try { res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream'); fs.createReadStream(f).pipe(res) }
    catch (e) { res.statusCode = 404; res.end('nf') }
})
await new Promise(r => server.listen(PORT, '127.0.0.1', r))

const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage()
await page.setViewport({ width: 1024, height: 900, deviceScaleFactor: 1 })
await page.setRequestInterception(true)
page.on('request', (req) => { req.url().startsWith(`http://127.0.0.1:${PORT}/`) ? req.continue() : req.abort() })
await page.evaluateOnNewDocument(() => { window.requestAnimationFrame = () => 0; window.cancelAnimationFrame = () => {}; window.setInterval = () => 0; window.clearInterval = () => {} })

async function probe(tab) {
    await page.goto(`http://127.0.0.1:${PORT}/#/concierge`, { waitUntil: 'load', timeout: 30000 })
    await new Promise(r => setTimeout(r, 800))
    if (tab) {
        await page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === t); if (b) b.click() }, tab)
        await new Promise(r => setTimeout(r, 400))
    }
    const out = await page.evaluate(() => {
        const m = document.querySelector('main')
        const cs = getComputedStyle(m)
        return {
            paddingTop: cs.paddingTop, paddingRight: cs.paddingRight, paddingBottom: cs.paddingBottom, paddingLeft: cs.paddingLeft,
            display: cs.display, flexDirection: cs.flexDirection, justifyContent: cs.justifyContent,
            height: cs.height, overflowY: cs.overflowY, flexGrow: cs.flexGrow,
            stf: cs.getPropertyValue('--section-title-fontsize'), stc: cs.getPropertyValue('--section-title-color'),
        }
    })
    console.log((tab || 'Lobby').padEnd(6), JSON.stringify(out))
}
await probe(null)
await probe('Earn')
await probe('Spend')
await browser.close(); server.close(); process.exit(0)
