// src/lib/wallets.js
//
// The Nito.cash FOUR-WALLET model — single source of truth for the wallet
// switcher + routing.
//
// Two axes:
//   privacy:  'nito'  (shielded — sender, receiver & amount are hidden)
//             'naked' (transparent — public on-chain)
//   purpose:  'cash'  (spendable stablecoins)
//             'vault' (holdings — base coins + cash-tokens)
//
// "Nito Cash" is the DEFAULT wallet and the umbrella alias for ALL shielded
// stablecoins; every other wallet is SECONDARY in the UI/UX.
//
// Each asset carries a `status`:
//   'active'      — usable today
//   'coming-soon' — signalled, not yet wired
//   'exploring'   — under evaluation (e.g. a foreign-chain asset)

/* Wallet ids (also used as the `/wallets/:walletId` route param). */
export const NITO_CASH = 'nito-cash'
export const NAKED_CASH = 'naked-cash'
export const NITO_VAULT = 'nito-vault'
export const NAKED_VAULT = 'naked-vault'

/* The default wallet (lands here after setup). */
export const DEFAULT_WALLET = NITO_CASH

/* The four wallets, in switcher order (Cash row first, then Vault row). */
export const WALLETS = [
    {
        id: NITO_CASH,
        name: 'Nito Cash',
        privacy: 'nito',
        kind: 'cash',
        default: true,
        status: 'active',
        tagline: 'Shielded stablecoins — private sender, receiver & amount',
        assets: [
            { symbol: 'PUSD', label: 'PayonUSD', status: 'active' },
        ],
    },
    {
        id: NAKED_CASH,
        name: 'Naked Cash',
        privacy: 'naked',
        kind: 'cash',
        status: 'active',
        tagline: 'Transparent stablecoins — public on-chain',
        assets: [
            { symbol: 'PUSD', label: 'PayonUSD', status: 'active' },
            { symbol: 'USDCx', label: 'USDC on Aleo', status: 'exploring' },
        ],
    },
    {
        id: NITO_VAULT,
        name: 'Nito Vault',
        privacy: 'nito',
        kind: 'vault',
        status: 'coming-soon',
        tagline: 'Shielded cash-tokens — generalized private holdings',
        assets: [
            { symbol: 'CashTokens', label: 'Any CashToken', status: 'coming-soon' },
        ],
    },
    {
        id: NAKED_VAULT,
        name: 'Naked Vault',
        privacy: 'naked',
        kind: 'vault',
        status: 'active',
        tagline: 'Transparent holdings — base coins & cash-tokens',
        assets: [
            { symbol: 'BCH', label: 'Bitcoin Cash', status: 'active' },
            { symbol: 'SOL', label: 'Solana', status: 'coming-soon' },
            { symbol: 'CashTokens', label: 'CashTokens', status: 'coming-soon' },
        ],
    },
]

/* Look up a wallet by id, falling back to the default wallet. */
export function getWallet(id) {
    return WALLETS.find((w) => w.id === id) || WALLETS.find((w) => w.id === DEFAULT_WALLET)
}
