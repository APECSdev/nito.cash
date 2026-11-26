/* apps/web/scripts/role2-browser-accept.mjs
 *
 * The WEB-PLATFORM role-2 acceptance harness (dev-only, like visual-baseline.mjs).
 * Drives the REAL wallet UI in headless Chrome against chipnet: restore the demo
 * wallet, switch to chipnet, then run one pool action through the Wallet view's
 * action panel — SHIELD, TRANSFER or UNSHIELD — and capture the broadcast txid
 * (or the on-screen error).
 *
 * The registry MUST be built with `walletProverCompatible: true` (the local
 * acceptance flip; the flag is committed only after the full three-action run).
 * Network access is REQUIRED (chipnet Fulcrum + prover.nito.cash) — this harness
 * deliberately does NOT block requests.
 *
 * Usage (from apps/web/, dist-vite built with the flip):
 *   CHROME_BIN=~/apps/chrome-portable/opt/google/chrome/chrome \
 *     node scripts/role2-browser-accept.mjs shield 1000
 *   ... transfer 1000 <64-hex delivery point>
 *   ... unshield 1000
 *
 * Exit code 0 = the UI rendered "Broadcast — txid …"; 1 = an on-screen error
 * or a timeout (the error text is printed).
 */
import puppeteer from 'puppeteer-core'
import { ElectrumClient } from '@electrum-cash/network'
import http from 'http'
import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(process.cwd(), 'dist-vite')
const OUT = path.resolve(process.cwd(), 'scripts/.accept')
/* ACCEPT_BASE points the harness at an already-running server (e.g. `vite dev`,
   whose stacks carry the original file names). Default: serve dist-vite. */
const PORT = Number(process.env.ACCEPT_PORT || 5410)
const BASE = process.env.ACCEPT_BASE || `http://127.0.0.1:${PORT}`

/* Wallet A — the role-2 demo wallet (NOTES/pool-e2e-demo-wallets.md). */
const MNEMONIC = 'direct blame later place ready bronze logic race soda toss clerk violin dirt area very color security physical rubber veteran circle grace treat strike'

const ACTION = (process.argv[2] || 'shield').toLowerCase()
const AMOUNT = process.argv[3] || '1000'
const RECIPIENT = process.argv[4] || ''
if (!['shield', 'transfer', 'unshield', 'all'].includes(ACTION)) throw new Error('action must be shield|transfer|unshield|all')
if (ACTION === 'transfer' && !/^[0-9a-fA-F]{64}$/.test(RECIPIENT)) throw new Error('transfer needs a 64-hex delivery point')

/* `all` runs the full acceptance in ONE browser session (the role-2 notes are
   off-chain, so a restore between actions would wipe them). */
const ALL_ACTIONS = ACTION === 'all'
    ? [
        { label: 'Shield', amount: '1000' },
        { label: 'Transfer', amount: '400', recipient: RECIPIENT },
        { label: 'Unshield', amount: '600' },
    ]
    : [{ label: ACTION.charAt(0).toUpperCase() + ACTION.slice(1), amount: String(AMOUNT), recipient: ACTION === 'transfer' ? RECIPIENT : '' }]
if (ALL_ACTIONS.some((a) => a.label === 'Transfer' && !/^[0-9a-fA-F]{64}$/.test(a.recipient || ''))) throw new Error('transfer needs a 64-hex delivery point')

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.ico': 'image/x-icon', '.wasm': 'application/wasm' }
let server = null
if (!process.env.ACCEPT_BASE) server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0])
    if (p === '/' || p === '') p = '/index.html'
    let f = path.join(ROOT, p)
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(ROOT, 'index.html')
    try {
        res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream')
        fs.createReadStream(f).pipe(res)
    } catch {
        res.statusCode = 404
        res.end('nf')
    }
})
if (server) await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1024, height: 900, deviceScaleFactor: 1 })

const logs = []
page.on('console', (msg) => { logs.push(msg.text()) })
page.on('pageerror', (err) => { logs.push('PAGEERROR ' + err.message) })

/* Capture Error STACKS (the app logs the caught error object; msg.text() only
   carries the message). */
await page.evaluateOnNewDocument(() => {
    const orig = console.error.bind(console)
    window.__errorStacks = []
    console.error = (...args) => {
        window.__errorStacks.push(args.map((a) => (a && a.stack ? a.stack : String(a))).join(' '))
        orig(...args)
    }
})

/* Click the first <button> whose textContent matches (the Button renders its
   label as the button text). */
async function clickButton(text) {
    const ok = await page.evaluate((label) => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
        if (!btn) return false
        btn.click()
        return true
    }, text)
    if (!ok) throw new Error(`button not found: ${text}`)
}

/* Navigate + wait for the app shell to render. */
async function gotoHash(hash) {
    await page.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle2', timeout: 60000 })
    await page.waitForFunction(() => document.querySelector('#app') && document.querySelector('#app').children.length > 0, { timeout: 30000 })
}

try {
    /* 1. Restore wallet A. */
    await gotoHash('/restore')
    await page.waitForSelector('textarea', { timeout: 30000 })
    await page.type('textarea', MNEMONIC)
    await clickButton('Connect Wallet')
    await page.waitForFunction(() => location.hash.includes('/dashboard'), { timeout: 60000 })
    console.log('wallet restored →', await page.evaluate(() => location.hash))

    /* 2. Switch to chipnet (the toggle lives in Settings → Basic). */
    await gotoHash('/settings')
    await page.waitForSelector('.toggle', { timeout: 30000 })
    const switched = await page.evaluate(() => {
        const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Chipnet (testnet)'))
        if (!label) return false
        const toggle = label.querySelector('.toggle')
        if (!toggle) return false
        toggle.click()
        return true
    })
    if (!switched) throw new Error('chipnet toggle not found')
    /* toggleNetwork persists then reloads after 800ms. */
    await new Promise((r) => setTimeout(r, 2500))
    await page.waitForFunction(() => document.querySelector('#app') && document.querySelector('#app').children.length > 0, { timeout: 60000 })
    const network = await page.evaluate(() => {
        const facade = window.__nito_store_facade__
        return facade ? facade.getters['profile/getNetwork'] : null
    })
    console.log('network →', network)
    if (network !== 'chipnet') throw new Error('network switch did not land on chipnet: ' + network)

    /* 3. The Wallet view (nito-cash) action panel. The amount input only
          renders AFTER an action is toggled, so wait for the Footer button. */
    await gotoHash('/wallets/nito-cash')
    await page.waitForFunction((name) => {
        return [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === name)
    }, { timeout: 30000 }, ALL_ACTIONS[0].label)
    await page.screenshot({ path: path.join(OUT, `wallet-before-${ACTION}.png`) })

    /* The next action's scan only sees CONFIRMED actions and its state input
       must be the tip — poll the chain between actions. */
    const waitConfirmed = async (txid, timeoutMs = 300000) => {
        const client = new ElectrumClient('nito.cash', '1.5', 'chipnet.bch.ninja', { port: 50004, encrypted: true })
        await client.connect()
        const start = Date.now()
        try {
            while (Date.now() - start < timeoutMs) {
                const merkle = await client.request('blockchain.transaction.get_merkle', txid).catch(() => null)
                if (merkle && merkle.block_height) return merkle.block_height
                await new Promise((r) => setTimeout(r, 5000))
            }
        } finally {
            await client.disconnect()
        }
        throw new Error('tx not confirmed in time: ' + txid)
    }

    const results = []

    for (const step of ALL_ACTIONS) {
        const { label, amount, recipient } = step

        await clickButton(label)
        await page.waitForSelector('input[placeholder="e.g. 1000"]', { timeout: 15000 })

        /* SET the value through the native setter + an input event (the Vue
           v-model contract). A plain click+type APPENDS to the previous
           action's value (measured: the transfer read 1000400). */
        const setInput = async (placeholder, value) => {
            await page.evaluate((sel, val) => {
                const el = document.querySelector(sel)
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
                setter.call(el, val)
                el.dispatchEvent(new Event('input', { bubbles: true }))
            }, `input[placeholder="${placeholder}"]`, String(value))
        }

        await setInput('e.g. 1000', amount)
        if (recipient) await setInput('64 hex characters', recipient)
        await page.screenshot({ path: path.join(OUT, `wallet-${label}-form.png`) })
        await clickButton(`${label} PUSD`)
        console.log('submitted', label, amount, '— waiting for the proof + broadcast…')

        /* The zkey download is 97 MB and the proof ~20 s — allow 10 minutes.
           The toggle above cleared the previous result, so the match is this
           action's. */
        await page.waitForFunction(() => {
            const text = document.body.innerText
            return /Broadcast — txid/.test(text) || /Error:|insufficient|Insufficient|required/.test(text)
        }, { timeout: 600000, polling: 1000 })

        const state = await page.evaluate(() => {
            const text = document.body.innerText
            const m = text.match(/Broadcast — txid ([0-9a-f]{64})/)
            const err = [...document.querySelectorAll('p')].map((p) => p.textContent.trim()).find((t) => /required|insufficient|failed|Error/i.test(t))
            return { txid: m ? m[1] : null, error: err || null }
        })
        await page.screenshot({ path: path.join(OUT, `wallet-${label}-result.png`), fullPage: true })
        results.push({ label, amount, ...state })
        console.log(JSON.stringify({ action: label, amount, ...state }))
        if (!state.txid) throw new Error(`${label} did not broadcast: ${state.error || 'no txid'}`)
        const height = await waitConfirmed(state.txid)
        console.log(label, 'confirmed at', height)
    }

    console.log('ACCEPTANCE PASS', JSON.stringify(results))
} catch (err) {
    console.log('ACCEPT FAILED:', err.message)
    console.log('--- console (tail) ---')
    console.log(logs.slice(-25).join('\n'))
    console.log('--- error stacks ---')
    console.log((await page.evaluate(() => window.__errorStacks || [])).join('\n'))
    const hex = await page.evaluate(() => window.__lastBroadcastHex || null)
    if (hex) { fs.writeFileSync(path.join(OUT, 'last-broadcast.hex'), hex); console.log('captured tx hex →', path.join(OUT, 'last-broadcast.hex'), hex.length, 'chars') }
    try { await page.screenshot({ path: path.join(OUT, `wallet-${ACTION}-failure.png`), fullPage: true }) } catch { /* ignore */ }
    process.exitCode = 1
} finally {
    await browser.close()
    if (server) server.close()
}
