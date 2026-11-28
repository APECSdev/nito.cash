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
/* Wallet B — the recipient (same file; its delivery point is the recorded
   5d281726… — the dp stability across sessions is part of the proof). */
const MNEMONIC_B = 'siren sword sadness special ahead job assist sadness piece supreme lyrics tower swap lunch valve lunch casino miracle ramp street pet chimney rapid private'

const ACTION = (process.argv[2] || 'shield').toLowerCase()
const AMOUNT = process.argv[3] || '1000'
const RECIPIENT = process.argv[4] || ''
if (!['shield', 'transfer', 'unshield', 'deposit', 'all', 'allv3', 'b3'].includes(ACTION)) throw new Error('action must be shield|transfer|unshield|deposit|all|allv3|b3')
if (ACTION === 'transfer' && !/^[0-9a-fA-F]{64}$/.test(RECIPIENT)) throw new Error('transfer needs a 64-hex delivery point')

/* `all` runs the full acceptance in ONE browser session (the role-2 notes are
   off-chain, so a restore between actions would wipe them). ACCEPT_ALL overrides
   the three amounts (e.g. "200,200,112" for the 3-out run). */
const ALL_AMOUNTS = (process.env.ACCEPT_ALL || '').split(',').filter(Boolean)
/* `allv3` = the pool4 (v3) lifecycle: SHIELD (the empty-genesis onboarding —
   the UI's Shield button dispatches the technical 'deposit' action on v3
   pools; no ACCEPT_NOTES import) → TRANSFER → UNSHIELD. */
const ALL_ACTIONS = ACTION === 'all'
    ? [
        { label: 'Shield', amount: ALL_AMOUNTS[0] || '1000' },
        { label: 'Transfer', amount: ALL_AMOUNTS[1] || '400', recipient: RECIPIENT },
        { label: 'Unshield', amount: ALL_AMOUNTS[2] || '600' },
    ]
    : ACTION === 'allv3'
        ? [
        { label: 'Shield', amount: ALL_AMOUNTS[0] || '1000' },
        { label: 'Transfer', amount: ALL_AMOUNTS[1] || '100', recipient: RECIPIENT },
        { label: 'Unshield', amount: ALL_AMOUNTS[2] || '300' },
        ]
    : [{ label: ACTION.charAt(0).toUpperCase() + ACTION.slice(1), amount: String(AMOUNT), recipient: ACTION === 'transfer' ? RECIPIENT : '' }]

/* Optional multi-pool run: ACCEPT_POOL clicks the pool-selector button (its
   exact label, e.g. "3-out v3") and ACCEPT_NOTES imports a notes JSON (the
   Hush export) into the sealed store before the actions. */
const POOL_LABEL = process.env.ACCEPT_POOL || ''
const NOTES_FILE = process.env.ACCEPT_NOTES || ''
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
        /* CORS-open: the intercepted proving-asset fetches 302-redirect HERE
           (the local-asset speedup) — a cross-origin fetch redirected to a
           response WITHOUT ACAO headers throws (the CORS redirect rule:
           "No 'Access-Control-Allow-Origin' header is present", measured). */
        res.setHeader('Access-Control-Allow-Origin', '*')
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
async function clickButton(text, pg = page) {
    const ok = await pg.evaluate((label) => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label)
        if (!btn) return false
        btn.click()
        return true
    }, text)
    if (!ok) throw new Error(`button not found: ${text}`)
}

/* Navigate + wait for the app shell to render. */
async function gotoHash(hash, pg = page) {
    /* 180 s: under a loaded VM the app's boot-time network (the Fulcrum
       cluster sweep + the ticker) can hold >2 inflight connections past the
       old 60 s window before networkidle2 settles. */
    await pg.goto(`${BASE}/#${hash}`, { waitUntil: 'networkidle2', timeout: 180000 })
    await pg.waitForFunction(() => document.querySelector('#app') && document.querySelector('#app').children.length > 0, { timeout: 60000 })
}

/* Restore a wallet on a page + switch it to chipnet (the steps 1-2 flow,
   factored for the b3 mode's SECOND wallet — the default flow below stays
   inline/unchanged). */
async function restoreOn(pg, mnemonic) {
    await gotoHash('/restore', pg)
    await pg.waitForSelector('textarea', { timeout: 30000 })
    await pg.type('textarea', mnemonic)
    await clickButton('Connect Wallet', pg)
    await pg.waitForFunction(() => location.hash.includes('/dashboard'), { timeout: 60000 })

    await gotoHash('/settings', pg)
    await pg.waitForSelector('.toggle', { timeout: 30000 })
    const switched = await pg.evaluate(() => {
        const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Chipnet (testnet)'))
        if (!label) return false
        const toggle = label.querySelector('.toggle')
        if (!toggle) return false
        toggle.click()
        return true
    })
    if (!switched) throw new Error('chipnet toggle not found')
    await new Promise((r) => setTimeout(r, 2500))
    await pg.waitForFunction(() => document.querySelector('#app') && document.querySelector('#app').children.length > 0, { timeout: 60000 })
    const network = await pg.evaluate(() => {
        const facade = window.__nito_store_facade__
        return facade ? facade.getters['profile/getNetwork'] : null
    })
    if (network !== 'chipnet') throw new Error('network switch did not land on chipnet: ' + network)
    return network
}

/* The wait-confirmed poll (Electrum, page-free) — shared with the b3 mode. */
async function waitConfirmed(txid, timeoutMs = 300000) {
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

if (ACTION === 'b3') {
    /* ─────────────────────────────────────────────────────────────────────
     * B3 — the TWO-WALLET off-chain delivery acceptance.
     *
     * A SHIELD → A TRANSFER to B's delivery point (the post-broadcast hook
     * encrypts B's out-note + publishes the NP01 packet to the note mailbox)
     * → B opens its wallet (a SEPARATE browser profile — the passive
     * mount-scan) → B's balance + note list show the transfer → A rescans →
     * B's receipt clears A's outbox. Every leg is the REAL UI + the REAL
     * public relays (the registry NOTE_MAILBOX set).
     *
     * ACCEPT_ALL="<shield>,<transfer>" (defaults 1000,200).
     * ───────────────────────────────────────────────────────────────────── */
    try {
        const SHIELD_AMOUNT = ALL_AMOUNTS[0] || '1000'
        const TRANSFER_AMOUNT = ALL_AMOUNTS[1] || '200'

        const ctxA = await browser.createBrowserContext()
        const pageA = await ctxA.newPage()
        const ctxB = await browser.createBrowserContext()
        const pageB = await ctxB.newPage()
        for (const pg of [pageA, pageB]) {
            pg.on('console', (msg) => { logs.push(msg.text()) })
            pg.on('pageerror', (err) => { logs.push('PAGEERROR ' + err.message) })
            /* The 15-min-stall diagnosis: EVERY failed/4xx/5xx network
               response + every aborted request, logged LIVE with its URL. */
            pg.on('response', (res) => {
                if (res.status() >= 400) console.log(`NET ${res.status()} ${res.url().slice(0, 120)}`)
            })
            pg.on('requestfailed', (req) => {
                console.log(`NETFAIL ${req.failure()?.errorText} ${req.url().slice(0, 120)}`)
            })
        }
        await pageA.setViewport({ width: 1024, height: 900 })
        await pageB.setViewport({ width: 1024, height: 900 })

        /* The VM's throttled egress: the 120 MB zkey fetch from the Worker
           mirror runs at ~41 KB/s in the browser (measured: the 3.6 MB wasm
           took 88 s) — ~49 minutes for the zkey, past every deadline. Serve
           the proving assets from the LOCAL dist copy instead (the files are
           the exact mirror assets, sha256-verified; the app's B4 pins still
           verify every byte). Everything else passes through untouched.
           SELF-HEAL: `vite build` EMPTIES dist-vite (emptyOutDir) — every
           rebuild wipes the local-proving cache; re-ensure it here (the
           GitHub release direct URLs — the Worker's own upstream is
           429-throttled right now). */
        fs.mkdirSync(path.join(ROOT, 'local-proving'), { recursive: true })
        for (const [name, url] of [
            ['pool4.wasm', 'https://github.com/APECSdev/pusd-shielded-pool/releases/download/role2-proving-assets-pool4-chipnet-v1/pool4.wasm'],
            ['verification_key_4out.json', 'https://github.com/APECSdev/pusd-shielded-pool/releases/download/role2-proving-assets-pool4-chipnet-v1/verification_key_4out.json'],
            ['pool4_final.zkey', 'https://prover.nito.cash/assets/pool4_final.zkey'],
        ]) {
            const f = path.join(ROOT, 'local-proving', name)
            if (!fs.existsSync(f) || fs.statSync(f).size < 1000) {
                console.log('local-proving: fetching', name, '…')
                const res = await fetch(url)
                if (!res.ok) throw new Error('cannot stage ' + name + ': ' + res.status)
                fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()))
                console.log('local-proving:', name, fs.statSync(f).size, 'B staged')
            }
        }
        await pageA.setRequestInterception(true)
        pageA.on('request', (req) => {
            const url = req.url()
            if (url.startsWith('https://prover.nito.cash/assets/')) {
                const name = url.split('/assets/')[1].split('?')[0]
                if (fs.existsSync(path.join(ROOT, 'local-proving', name))) {
                    /* URL-OVERRIDE: continue the SAME request against the local
                       static path (the 302-respond form dies with ERR_FAILED —
                       Chrome does not follow interception-synthesized
                       redirects; the local server carries ACAO so the
                       cross-origin fetch's CORS check passes on the final
                       response). */
                    req.continue({ url: `http://127.0.0.1:${PORT}/local-proving/${name}` })
                    return
                }
            }
            req.continue()
        })

        /* ── Phase 1 — B first: restore + read B's delivery point. ── */
        console.log('B: restoring…')
        await restoreOn(pageB, MNEMONIC_B)
        await gotoHash('/wallets/nito-cash', pageB)
        console.log('B: deriving the delivery point…')
        /* The dp renders as its own 64-hex LINE in the body text (measured:
           the label-DOM walk raced the Vue mount once; the line-regex is the
           probe-verified form). */
        await pageB.waitForFunction(() => /^[0-9a-f]{64}$/m.test(document.body.innerText), { timeout: 90000 })
        const bDp = await pageB.evaluate(() => {
            const m = document.body.innerText.match(/^[0-9a-f]{64}$/m)
            return m ? m[0] : null
        })
        if (!bDp) {
            await pageB.screenshot({ path: path.join(OUT, 'b3-B-phase1-FAIL.png'), fullPage: true })
            throw new Error('B delivery point did not render: ' + (await pageB.evaluate(() => document.body.innerText.slice(0, 300))))
        }
        console.log('B delivery point →', bDp)
        if (bDp !== '5d281726fb8f424b04f8c71110a3e9fb120ba399c38c9946d6ae72d4d1242a84') {
            throw new Error('B delivery point DRIFTED from the recorded one: ' + bDp)
        }

        /* B's pre-transfer balance (the fresh profile shows 0 — the PRIOR
           transfer's 100-unit note predates B3 and was never deliverable). */
        await pageB.waitForFunction(() => /\d+ PUSD/.test(document.body.innerText), { timeout: 30000 })
        const bBefore = await pageB.evaluate(() => document.body.innerText.match(/([\d,]+) PUSD/)?.[1] || null)
        console.log('B shielded balance BEFORE →', bBefore)
        await pageB.screenshot({ path: path.join(OUT, 'b3-B-before.png') })

        /* ── Phase 2 — A: restore, SHIELD, TRANSFER to B's dp. ── */
        console.log('A: restoring…')
        await restoreOn(pageA, MNEMONIC)
        /* Persist the NOTIFICATION texts (the toasts fade in seconds — the
           body-text probe missed the delivery line by a 30 s poll tick in
           the 11th run; the dispatch spy is durable). */
        await pageA.evaluate(() => {
            const facade = window.__nito_store_facade__
            window.__notifs = []
            const orig = facade.dispatch.bind(facade)
            facade.dispatch = (type, payload, opts) => {
                if (type === 'system/displayNotification' || type === 'displayNotification') {
                    window.__notifs.push(String(payload))
                }
                return orig(type, payload, opts)
            }
        })
        await gotoHash('/wallets/nito-cash', pageA)
        await pageA.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label), { timeout: 60000 }, POOL_LABEL || 'Shield')
        if (POOL_LABEL) {
            await clickButton(POOL_LABEL, pageA)
            await new Promise((r) => setTimeout(r, 600))
        }

        const runAction = async (label, amount, recipient) => {
            await clickButton(label, pageA)
            await pageA.waitForSelector('input[placeholder="e.g. 1000"]', { timeout: 15000 })
            await pageA.evaluate((sel, val) => {
                const el = document.querySelector(sel)
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
                setter.call(el, val)
                el.dispatchEvent(new Event('input', { bubbles: true }))
            }, 'input[placeholder="e.g. 1000"]', String(amount))
            if (recipient) {
                await pageA.evaluate((sel, val) => {
                    const el = document.querySelector(sel)
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
                    setter.call(el, val)
                    el.dispatchEvent(new Event('input', { bubbles: true }))
                }, 'input[placeholder="64 hex characters"]', String(recipient))
            }
            await pageA.screenshot({ path: path.join(OUT, `b3-A-${label}-form.png`) })
            await clickButton(`${label} PUSD`, pageA)
            console.log(`A: submitted ${label} ${amount}${recipient ? ' → ' + recipient.slice(0, 16) + '…' : ''} — proving…`)

            /* LIVE STAGE TRACE: dump the ACTION panel's tail (unfiltered —
               the filtered variant went silent through the whole 15-min
               stall) every 30 s until the broadcast or the error shows. */
            const deadline = Date.now() + 900000
            let lastPanel = ''
            while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 30000))
                const probe = await pageA.evaluate(() => {
                    const text = document.body.innerText
                    return {
                        done: /Broadcast — txid/.test(text) || /failed|Failed|Error|error|insufficient|Insufficient|required/i.test(text.slice(text.indexOf('Amount (PUSD'))),
                        panel: text.slice(text.indexOf('Amount (PUSD') >= 0 ? text.indexOf('Amount (PUSD') : text.length - 400).slice(0, 400),
                    }
                })
                if (probe.panel !== lastPanel) {
                    console.log(`A [${Math.round((Date.now() - (deadline - 900000)) / 1000)}s] PANEL:`, JSON.stringify(probe.panel.slice(0, 260)))
                    lastPanel = probe.panel
                }
                if (probe.done) break
            }
            const state = await pageA.evaluate(() => {
                const text = document.body.innerText
                const m = text.match(/Broadcast — txid ([0-9a-f]{64})/)
                const notifs = (window.__notifs || []).join('\n')
                const delivery = /recipient note is delivered/.test(notifs) ? 'delivered' : /queued|re-delivered/.test(notifs) ? 'queued' : null
                return { txid: m ? m[1] : null, delivery, notifs: (window.__notifs || []).slice(-4), text }
            })
            await pageA.screenshot({ path: path.join(OUT, `b3-A-${label}-result.png`), fullPage: true })
            if (!state.txid) {
                const dump = await pageA.evaluate(() => ({
                    panel: document.body.innerText.slice(-1500),
                    scan: window.__nito_store_facade__.state.pool.scan,
                    outbox: window.__nito_store_facade__.state.pool.outbox.length,
                    lastHex: window.__lastBroadcastHex ? window.__lastBroadcastHex.length : 0,
                }))
                console.log('PANEL DUMP:', JSON.stringify(dump, null, 2))
                throw new Error(`${label} did not broadcast`)
            }
            /* The TRANSFER's delivery proof is the OUTBOX (the durable
               record), NOT the toast — the store's internal dispatch
               bypasses the facade spy (measured run 13: the mailbox hook
               ran clean, the notification just was not observable). */
            if (label === 'Transfer') {
                /* SOFT diagnostic: the outbox's facade-read shape flaked
                   across runs (an old localStorage rehydration loses the key);
                   the REAL proofs are Phase 3 (B receives the note through
                   the mailbox) + Phase 4 (the receipt clears the outbox). */
                try {
                    const raw = await pageA.evaluate(() => JSON.stringify(window.__nito_store_facade__?.state?.pool?.outbox ?? null).slice(0, 200))
                    console.log('A transfer outbox RAW:', raw)
                } catch (e) {
                    console.log('A transfer outbox read failed:', e.message)
                }
            }
            console.log(`A: ${label} broadcast →`, state.txid, '(mailbox:', state.delivery + ')')
            if (label === 'Transfer' && !state.delivery) {
                throw new Error('the transfer broadcast but NO mailbox delivery notification appeared')
            }
            const height = await waitConfirmed(state.txid)
            console.log(`A: ${label} confirmed at`, height)
            return state
        }

        await runAction('Shield', SHIELD_AMOUNT)
        const transfer = await runAction('Transfer', TRANSFER_AMOUNT, bDp)

        /* A's outbox: exactly one pending packet for the transfer. */
        const outboxAfter = await pageA.evaluate(() => window.__nito_store_facade__.state.pool.outbox || [])
        console.log('A outbox →', outboxAfter.map((e) => ({ actionTxid: e.actionTxid, receiptSeen: e.receiptSeen, eventId: e.eventId })))
        if (outboxAfter.length !== 1 || outboxAfter[0].actionTxid !== transfer.txid) {
            throw new Error('A outbox does not hold exactly the transfer packet: ' + JSON.stringify(outboxAfter.map((e) => e.actionTxid)))
        }

        /* ── Phase 3 — B: open the wallet → the passive scan → the note. ── */
        console.log('B: re-opening the wallet (the passive mount-scan + the mailbox fetch)…')
        await gotoHash('/wallets/nito-cash', pageB)
        const target = Number(TRANSFER_AMOUNT).toLocaleString() + ' PUSD'
        const gotIt = await pageB.waitForFunction((want) => document.body.innerText.includes(want), { timeout: 120000, polling: 2000 }, target)
        if (!gotIt) throw new Error('B never saw the ' + target + ' balance')
        await pageB.screenshot({ path: path.join(OUT, 'b3-B-received.png'), fullPage: true })

        const bAfter = await pageB.evaluate(() => {
            const facade = window.__nito_store_facade__
            const notes = facade.state.pool.notes
            return {
                balance: document.body.innerText.match(/([\d,]+) PUSD/)?.[1] || null,
                noteCount: notes.length,
                notes: notes.map((n) => ({ value: String(n.value), leafIndex: n.leafIndex, spent: !!n.spent, txid: n.txid })),
                outbox: facade.state.pool.outbox.length,
            }
        })
        console.log('B AFTER →', JSON.stringify(bAfter, null, 2))
        if (bAfter.noteCount < 1) throw new Error('B recorded no note')
        if (!bAfter.notes.some((n) => !n.spent && n.value === String(Number(TRANSFER_AMOUNT)))) {
            throw new Error('B has no unspent ' + TRANSFER_AMOUNT + ' note: ' + JSON.stringify(bAfter.notes))
        }
        console.log('B RECEIVED THE TRANSFER ✓ — value', TRANSFER_AMOUNT, 'leafIndex', bAfter.notes.find((n) => n.value === String(Number(TRANSFER_AMOUNT)))?.leafIndex)

        /* ── Phase 4 — A rescans: B's receipt clears the outbox. ── */
        console.log('A: re-scanning (the outbox sweep → the receipt)…')
        await gotoHash('/wallets/nito-cash', pageA)
        const cleared = await pageA.waitForFunction(() => {
            const outbox = window.__nito_store_facade__.state.pool.outbox || []
            return outbox.length === 0 || outbox.every((e) => e.receiptSeen)
        }, { timeout: 60000, polling: 2000 })
        const outboxEnd = await pageA.evaluate(() => window.__nito_store_facade__.state.pool.outbox || [])
        console.log('A outbox after the sweep →', outboxEnd.length, 'entries')
        if (!cleared || outboxEnd.length !== 0) {
            throw new Error('A outbox was not cleared by the receipt sweep: ' + JSON.stringify(outboxEnd.map((e) => ({ actionTxid: e.actionTxid, receiptSeen: e.receiptSeen }))))
        }
        await pageA.screenshot({ path: path.join(OUT, 'b3-A-outbox-cleared.png'), fullPage: true })

        console.log('B3 ACCEPTANCE PASS', JSON.stringify({
            shieldAmount: SHIELD_AMOUNT,
            transferAmount: TRANSFER_AMOUNT,
            transferTxid: transfer.txid,
            bDeliveryPoint: bDp,
            bBalance: bAfter.balance,
            bNotes: bAfter.noteCount,
            aOutboxCleared: true,
        }))
    } catch (err) {
        console.log('B3 ACCEPTANCE FAILED:', err.message)
        console.log('--- console (tail) ---')
        console.log(logs.slice(-30).join('\n'))
        process.exitCode = 1
    } finally {
        await browser.close()
        if (server) server.close()
    }
    process.exit(process.exitCode || 0)
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
    /* The pool selector chip MUST be clicked BEFORE waiting for the FT-in
       button — the label depends on the SELECTED pool (Deposit on a v3/pool4
       pool, Shield on the 2-out default selection). */
    if (POOL_LABEL) {
        await page.waitForFunction((label) => {
            return [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label)
        }, { timeout: 60000 }, POOL_LABEL)
        await clickButton(POOL_LABEL)
        await new Promise((r) => setTimeout(r, 600))
        const selected = await page.evaluate(() => {
            const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === document.querySelector('button.border-primary')?.textContent.trim())
            return btn ? btn.textContent.trim() : null
        })
        console.log('pool selected →', POOL_LABEL, '(active:', selected + ')')
    }
    await page.waitForFunction((name) => {
        return [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === name)
    }, { timeout: 60000 }, ALL_ACTIONS[0].label)

    if (NOTES_FILE) {
        const notes = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'))
        const imported = await page.evaluate(async (list) => {
            const facade = window.__nito_store_facade__
            if (!facade) return -1
            for (const note of list) await facade.dispatch('pool/recordNote', note)
            return list.length
        }, notes)
        console.log('notes imported →', imported)
    }

    await page.screenshot({ path: path.join(OUT, `wallet-before-${ACTION}.png`) })

    /* The next action's scan only sees CONFIRMED actions and its state input
       must be the tip — poll the chain between actions (the module-level
       waitConfirmed, hoisted for the b3 mode too). */

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

        /* The zkey download is 98 MB and the proof ~20-200 s — allow 15
           minutes. POLL from node (a single long waitForFunction call trips
           puppeteer's 180 s protocol timeout during the cold-cache download +
           proof — measured 2026-11-26: the first 3-out run died at ~3 min with
           the page still "Working"). The toggle above cleared the previous
           result, so the match is this action's. */
        const deadline = Date.now() + 900000
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 2000))
            const done = await page.evaluate(() => {
                const text = document.body.innerText
                return /Broadcast — txid/.test(text) || /Error:|insufficient|Insufficient|required/.test(text)
            })
            if (done) break
        }

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
