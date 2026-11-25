/* apps/demo/src/lib/tour.js
 *
 * The walkthrough script. Each chapter drives the framed wallet by route and
 * (optionally) by clicking one of its own controls. Copy is transcribed from
 * the app itself and the BCH BLAZE 2026 submission page — nothing here claims
 * a capability the repo does not ship.
 *
 * `hold` is the autoplay dwell in milliseconds. `hint` is shown in Try mode.
 */
export const CHAPTERS = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        route: '/dashboard',
        hold: 5200,
        seed: true,
        title: 'Every wallet in one place.',
        body: 'One seed, four wallets: Nito Cash and Nito Vault are shielded; Naked Cash and Naked Vault are transparent. Balances, fiat values and privacy modes sit on one screen.',
        bullets: [
            'Shielded + transparent variants of cash and vault',
            'Live BCH balance with fiat conversion',
            'Mainnet reads through a 2-of-3 Fulcrum quorum',
        ],
        hint: 'Tap a wallet tile, or the Receive / Send buttons below the balance.',
    },
    {
        id: 'receive',
        label: 'Receive',
        route: '/receive',
        hold: 4200,
        title: 'Get paid with a QR or a link.',
        body: 'The receiving account is derived from your seed and rendered as a CashAddress and a QR code. Nothing is registered anywhere.',
        bullets: [
            'CashAddress and QR code, ready to scan',
            'Copy a shareable payment link',
            'Real-time notifications on incoming payments',
        ],
        hint: 'Show the QR, or copy the address or payment link.',
    },
    {
        id: 'send',
        label: 'Send',
        route: '/send',
        hold: 4400,
        title: 'Send — signed on your device.',
        body: 'Amounts switch between sats, bits, mBCH, BCH and USD. The transaction is built and signed locally; only the final broadcast leaves the browser.',
        bullets: [
            'Unit switching: sats, bits, mBCH, BCH and USD',
            'Schnorr signatures (SIGHASH_ALL | FORKID) built locally',
            'Broadcast through the quorum cluster',
        ],
        hint: 'Enter an amount and a BCH address, then review the payment.',
    },
    {
        id: 'history',
        label: 'History',
        route: '/history',
        hold: 4200,
        title: 'History with live fiat values.',
        body: 'Confirmed and pending transactions share one list, with the fiat value at the live rate. Open any row for the full transaction.',
        bullets: [
            'Confirmed and pending transactions in one list',
            'Fiat value at the live CoinGecko rate',
            'Open any transaction for full details',
        ],
        hint: 'Tap a transaction to open its details.',
    },
    {
        id: 'concierge',
        label: 'Concierge',
        route: '/concierge',
        hold: 15000,
        title: 'Private payments, front and centre.',
        body: 'The Concierge Desk simulates a five-party CashFusion round: peers seat one at a time, six phases run, and the table settles with the measured G3 numbers. Entirely local.',
        bullets: [
            'CashFusion + P2P over Nostr',
            'Five peers, six phases, one settled table',
            'Nothing leaves the browser — no relay is contacted',
        ],
        hint: 'Press Request a round and watch the table fill.',
        action: async ({ wait, click, scroll, dismiss }) => {
            await wait(800)
            click('CashFusion')
            await wait(700)
            click('Request a round')
            await wait(1600)
            scroll()
            await wait(11000)
            scroll()
            dismiss()
        },
    },
    {
        id: 'vault',
        label: 'Vault Desk',
        route: '/concierge',
        hold: 7600,
        title: 'The shielded pool.',
        body: 'The Vault Desk carries the chipnet evidence: the first shielded PUSD pool on Bitcoin Cash, with a Groth16 proof welded to a covenant that enforces the same note transition on chain.',
        bullets: [
            'First shielded PUSD pool on BCH chipnet',
            'Groth16 proof + covenant on the same action hash',
            'Deploy, shield, transfer and unshield — confirmed on chain',
        ],
        hint: 'Open a suite to read the vault ledger and its boundaries.',
        action: async ({ wait, click, top, dismiss }) => {
            await wait(700)
            click('Earn')
            await wait(200)
            dismiss()
            top()
        },
    },
]
