// scripts/prove-browser.mjs
// Browser end-to-end verification of the client-side pool prover: serve the app
// (vite dev), load prove-test.html in headless Chrome, and assert the wallet's
// own buildPoolWitness + snarkjs groth16 fullProve + verifyProof produce a valid
// proof against the served PPOT-derived proving assets.
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'

const PORT = 5601
const BASE = `http://127.0.0.1:${PORT}`
const PROVE_TIMEOUT_MS = 420000 // proving 183k constraints in headless Chrome is slow

const server = spawn('node_modules/.bin/vite', ['--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
})
server.stderr.on('data', d => process.stderr.write(d))

async function waitServer() {
    for (let i = 0; i < 60; i++) {
        try { const r = await fetch(`${BASE}/prove-test.html`); if (r.ok) return } catch {}
        await new Promise(r => setTimeout(r, 500))
    }
    throw new Error('dev server did not start')
}

let browser
try {
    await waitServer()
    browser = await puppeteer.launch({
        executablePath: '/usr/bin/google-chrome',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=6144'],
        protocolTimeout: PROVE_TIMEOUT_MS + 60000,
    })
    const page = await browser.newPage()
    page.on('pageerror', e => console.error('[pageerror]', String(e).slice(0, 400)))
    await page.goto(`${BASE}/prove-test.html`, { waitUntil: 'domcontentloaded', timeout: 60000 })

    const deadline = Date.now() + PROVE_TIMEOUT_MS
    let res = null
    while (Date.now() < deadline) {
        res = await page.evaluate(() => window.__proveResult)
        if (res && res.ok !== null) break
        await new Promise(r => setTimeout(r, 2000))
        if (res && res.stage) process.stdout.write(`\r  stage: ${res.stage}   `)
    }
    console.log('\nRESULT:', JSON.stringify(res, null, 2))
    if (!res) { console.error('TIMEOUT waiting for prove result'); process.exit(2) }
    process.exit(res.ok ? 0 : 1)
} finally {
    if (browser) await browser.close().catch(() => {})
    server.kill('SIGTERM')
}
