/* apps/demo/src/lib/demo.js
 *
 * The demo harness for the framed wallet.
 *
 * The wallet exposes two seams the harness uses (both already shipped, no
 * app change):
 *
 *   1. `globalThis.__nito_store_facade__` — the $store-compatible facade
 *      (apps/web/src/store/index.js:280) so we can commit the profile seed
 *      and dispatch `wallets/createWallet`.
 *   2. `globalThis.__NITO_MOCK_CLUSTER__[networkId]` — the deterministic
 *      mock chain read by `getCluster()` (apps/web/src/lib/bch/provider.js:305)
 *      so every balance/history/broadcast call is local.
 *
 * The fixture below is the same one the walkthrough video used
 * (NOTES/video/pipeline/capture.mjs): a fixed test seed, a 1.6 BCH balance,
 * three history rows and a no-op broadcast. It has never held funds.
 */

const SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const IV = '000102030405060708090a0b0c0d0e0f'

/* Deterministic demo receiving address (derived from the fixed test seed). */
const OUR = 'bitcoincash:qptf4pe2u20g8ww73sguex6hsjh6rxcgfc4mkrcz2a'

export const MOCK_BALANCE = 160000000

function buildMock() {
    const h = (c) => c.repeat(64).slice(0, 64)
    const now = Math.floor(Date.now() / 1000)
    const A = h('a1')
    const B = h('b2')
    const C = h('c3')
    const P = h('d4')
    const out = (value, addresses) => ({ value, scriptPubKey: { addresses } })

    /* 1.75 in - 1.20 out + 1.05 in = 1.60 BCH (matches getBalance). */
    const txs = {
        [A]: {
            txid: A,
            confirmations: 312,
            time: now - 2 * 86400,
            vin: [],
            vout: [out(1.75, [OUR])],
        },
        [B]: {
            txid: B,
            confirmations: 144,
            time: now - 86400,
            vin: [{ txid: P, vout: 0 }],
            vout: [out(0.05, [OUR])],
        },
        [P]: {
            txid: P,
            confirmations: 145,
            time: now - 86500,
            vin: [],
            vout: [out(1.25, [OUR])],
        },
        [C]: {
            txid: C,
            confirmations: 12,
            time: now - 6 * 3600,
            vin: [],
            vout: [out(1.05, [OUR])],
        },
    }

    return {
        getBalance: async () => ({ confirmed: MOCK_BALANCE, unconfirmed: 0 }),
        getUtxos: async () => [
            { tx_hash: A, tx_pos: 0, height: 100, value: 175000000 },
            { tx_hash: C, tx_pos: 0, height: 109, value: 75000000 },
        ],
        getHistory: async () => [
            { tx_hash: A, height: 100 },
            { tx_hash: B, height: 104 },
            { tx_hash: C, height: 109 },
        ],
        getTransaction: async () => '00',
        verboseGetTransaction: async (txid) => txs[txid] || txs[A],
        broadcast: async () => A,
        estimateFee: async () => 0.00001,
        relayFee: async () => 0.00001,
        subscribeAddresses: async () => {},
        unsubscribeAddresses: async () => {},
    }
}

/** Install the mock chain on the framed window. */
export function installMock(win) {
    const mock = buildMock()
    win.__NITO_MOCK_CLUSTER__ = { mainnet: mock, chipnet: mock }
    return mock
}

/** Poll `check` until it returns truthy (or throw after `timeout`). */
export async function waitFor(check, timeout = 20000, step = 100) {
    const started = Date.now()
    for (;;) {
        let value = false
        try {
            value = check()
        } catch {
            value = false
        }
        if (value) return value
        if (Date.now() - started > timeout) {
            throw new Error('demo: the wallet did not become ready in time')
        }
        await sleep(step)
    }
}

/** Resolve once the wallet's store facade exists. */
export function waitForApp(win) {
    return waitFor(() => win.__nito_store_facade__)
}

/** Close the app's floating BLAZE banner (it opens expanded by default and
 *  covers the phone's lower half; the small pill stays visible). The banner
 *  mounts after the store, so retry briefly instead of clicking once. */
export async function closeBlaze(win, duration = 2500) {
    const end = Date.now() + duration

    /* Keep watching across the route change: Splash, Setup and Dashboard each
       mount their OWN banner (open by default), so one click is not enough. */
    while (Date.now() < end) {
        const toggle = [...win.document.querySelectorAll('button')]
            .find((b) => /BLAZE 2026/.test(b.textContent || ''))

        if (toggle && (toggle.textContent || '').includes('▾')) toggle.click()

        await sleep(150)
    }
}

/** Seed the fixed test wallet + install the mock chain. */
export async function seed(win) {
    installMock(win)

    const facade = win.__nito_store_facade__
    facade.commit('profile/setMasterSeed', SEED)
    facade.commit('profile/setMasterIV', IV)
    await facade.dispatch('wallets/createWallet')
}

/** Scroll the framed view to its bottom (the Concierge round table lives
 *  below the service record). The view's <main> is the scroll container —
 *  pick the longest one, because Notification.vue also renders a <main>. */
export function scrollToRound(win) {
    const mains = [...win.document.querySelectorAll('main')]
    const main = mains.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]

    if (!main) return

    const heading = [...main.querySelectorAll('*')]
        .find((n) => n.children.length === 0 && /Table 02b/i.test(n.textContent || ''))

    if (!heading) {
        main.scrollTop = main.scrollHeight

        return
    }

    const target = heading.closest('section') || heading
    main.scrollTop += target.getBoundingClientRect().top - main.getBoundingClientRect().top - 8
}

/** Scroll the framed view to its top (a new tab/view starts at the top). */
export function scrollTop(win) {
    const mains = [...win.document.querySelectorAll('main')]
    const main = mains.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]

    if (main) main.scrollTop = 0
}

/** Dismiss the app's persistent notification banner (it has no timer). The
 *  component's own click setter commits `system/setNotification`, which the
 *  store facade rejects — clear the reactive state field directly instead. */
export function dismissNotification(win) {
    const facade = win.__nito_store_facade__

    if (facade && facade.state && facade.state.system && 'nm' in facade.state.system) {
        facade.state.system.nm = null
    }
}

/** Navigate the framed app (hash router). */
export function go(win, route) {
    win.location.hash = '#' + route
}

/** Click the first button/link whose text contains `text`. */
export function clickText(win, text) {
    const needle = String(text).toLowerCase()
    const nodes = win.document.querySelectorAll('button, a, [role="button"]')
    const hit = [...nodes].find((n) => (n.textContent || '').trim().toLowerCase().includes(needle))
    if (hit) {
        hit.click()
        return true
    }
    return false
}

/** Clear the demo wallet state and reload the framed app. */
export function reset(win) {
    win.localStorage.clear()
    win.location.hash = '#/'
    win.location.reload()
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
