---
# apps/docs/index.md
layout: home

hero:
  name: Nito.cash
  text: Hush Your Money.
  tagline: A Bitcoin Cash privacy wallet — and the first shielded pool for PayonUSD (PUSD) on BCH.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Private Payments
      link: /private-payments/overview

features:
  - title: Privacy-first wallet
    details: A client-side Bitcoin Cash wallet. Keys are derived and transactions are signed locally — nothing sensitive ever leaves your device.
  - title: PUSD shielded pool
    details: Sender, receiver, and amount are masked using a BN254 Groth16 circuit verified directly on the BCH VM. Chipnet for the BCH Blaze 2026 hackathon.
  - title: Mainnet + Chipnet
    details: Switch between BCH mainnet and chipnet from Settings. Same keys, same wallet — only the address prefix changes.
  - title: Halo 2 / Orchard prover
    details: A Cloudflare Worker (Rust → WASM) proving Orchard ZK statements, deployed at prover.nito.cash.
---
