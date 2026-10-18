// apps/docs/.vitepress/config.mjs
import { defineConfig } from 'vitepress'

// VitePress config for the Nito.cash docs site (docs.nito.cash).
// Built for static hosting on Cloudflare Pages (Direct Upload of .vitepress/dist).
export default defineConfig({
  title: 'Nito.cash',
  description: 'Hush Your Money — a Bitcoin Cash privacy wallet. Docs for the wallet, the PUSD shielded pool, and the ZK prover.',
  // Served from the root of docs.nito.cash.
  base: '/',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['meta', { name: 'theme-color', content: '#0f172a' }],
  ],

  themeConfig: {
    logo: undefined,
    siteTitle: 'Nito.cash Docs',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Private Payments', link: '/private-payments/overview' },
      { text: 'Prover', link: '/prover/overview' },
      { text: 'nito.cash', link: 'https://nito.cash' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Networks (Mainnet / Chipnet)', link: '/guide/networks' },
          { text: 'Ledger (Hardware Wallet)', link: '/guide/ledger' },
        ],
      },
      {
        text: 'Private Payments',
        items: [
          { text: 'Overview', link: '/private-payments/overview' },
          { text: 'The Circuit', link: '/private-payments/circuit' },
          { text: 'On-chain Verifier', link: '/private-payments/verifier' },
          { text: 'The Covenant', link: '/private-payments/covenant' },
          { text: 'Trusted Setup', link: '/private-payments/trusted-setup' },
          { text: 'Roadmap', link: '/private-payments/roadmap' },
        ],
      },
      {
        text: 'Prover',
        items: [
          { text: 'Overview', link: '/prover/overview' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/APECSdev/nito.cash' },
    ],

    footer: {
      message: 'Submission for the BCH Blaze 2026 hackathon.',
      copyright: 'Nito.cash — Hush Your Money.',
    },

    search: {
      provider: 'local',
    },
  },
})
