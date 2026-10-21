<!-- README.md -->

# Nito.cash — Hush Your Money™

![Nito.cash Poster](https://nito.cash/poster.jpg)

[![ci](https://github.com/APECSdev/nito.cash/actions/workflows/ci.yml/badge.svg)](https://github.com/APECSdev/nito.cash/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/APECSdev/nito.cash/graph/badge.svg)](https://codecov.io/gh/APECSdev/nito.cash)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Vue](https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vue.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-workspace-F69220?logo=pnpm&logoColor=white)
![BCH](https://img.shields.io/badge/Bitcoin%20Cash-BCH-0AC18E)

> **The most user-friendly, privacy shielding wallet for crypto newcomers.**

A privacy-focused Bitcoin Cash (BCH) wallet and ZK proving stack, built for
**[BCH Blaze 2026](https://dorahacks.io/hackathon/bchblaze2026)**.

## Nito Cash — Private Payments (flagship feature)

The headline build for BCH Blaze 2026 is the **first shielded pool for PayonUSD
(PUSD) on BCH Chipnet** — sender, receiver, and amount are all masked. A BN254
Groth16 zero-knowledge proof (split across 5 transaction inputs so it fits the BCH
VM's cost limits) proves each note transition is valid, while a CashToken-aware
**covenant** independently enforces the exact same transition on-chain: the covenant
recomputes the proof's `actionHash` public input from the values it applies and
requires a match, welding the ZK proof to the precise note transition. Pool state
`{merkleRoot, nullifierSetHash}` rides in a mutable CashToken NFT, so value moves
**shielded → shielded** with no public link between deposits and withdrawals.

The full pool lifecycle is **live and confirmed on chipnet** — deploy, shield,
private transfer, and withdraw:

| Step | Tx | Confirmed | What it does |
| ---- | -- | --------- | ------------ |
| **SHIELD** | TX-S1 | [block 328733](https://chipnet.chaingraph.cash/tx/d3a442f3d3145cba3d1d6fd626164e077fa92b02720b882e3e98b40e70f4188c) | 1,000,000 public PUSD → shielded (hidden 700k + 300k notes created) |
| **TRANSFER** | TX-T1 | [block 328740](https://chipnet.chaingraph.cash/tx/3a8b9287ea97c050b0110522afa84daf0de90984ef3266db4062768d19adf8a5) | pure shielded → shielded: no public value moves, no link in or out |
| **UNSHIELD** | TX-U1 | [block 328744](https://chipnet.chaingraph.cash/tx/c8d4c6e67859602a700b36ed33c6d90f0bf0ecb43c2e58b87041f845d4cc214a) | 250,000 PUSD back out publicly; 750,000 stays shielded |

> Chipnet proof-of-concept with a disclosed 1-of-1 trusted setup — a full MPC
> ceremony is mandatory before mainnet. The complete technical design (circuit,
> covenant, verifier patching, and per-transaction worked examples) lives in the
> companion repo **[APECSdev/pusd-pool](https://github.com/APECSdev/pusd-pool)**.

## Getting started

Requires **Node 24** and **pnpm** (`corepack enable && corepack prepare pnpm@latest --activate`).

```bash
pnpm install          # install the whole workspace (frozen lockfile)

pnpm dev              # run the wallet dev server (apps/web)
pnpm build            # production build of the wallet -> apps/web/dist-vite
pnpm test:unit        # unit tests (apps/web)
pnpm lint             # eslint (apps/web)

pnpm prover:deploy    # deploy the ZK prover via the apecsdev VM -> prover.nito.cash
```

The prover's WebAssembly artifact (`workers/prover/src/orchard.wasm`) is committed, so
deploying it does **not** require a Rust toolchain. See `AGENTS.md` for full contributor
guidance (PNPM rules, Ledger integration plan, monorepo layout, and the phased Vue 3 /
Tailwind modernization).

---

## Anatomy of Nito.cash wallet

- [x] Maximum Convenience: 9.5
- [x] Excellent Privacy: 9.0
- [x] Pretty Good Security: 8.0

## Improving the on-boarding experience for newcomers

> There are a few (well-known) wallet providers that offer simplified on-boarding processes for newcomers; most commonly by using a traditional __username & password__ for account security. However, in the spirit of encouraging a __non-custodial, censorship-proof__ world; with a future, free from the tragedy of oppression that continues to plague our societies, they have not been considered in this brief analysis.

__Today's newcomers will commonly experience the following:__

1. Open their respective app store (Android or iOS).
2. Search & download the app recommended by their sponsor.
3. Install the app.
4. Create a new wallet.
5. Secure the 12 seed words protecting their new wallet.
6. Confirm (all or some of) the 12 words to complete the setup process.
7. Open the 'Receive' screen for a QR code.
_(sponsor scans QR code for their address and sends)_
8. Newcomer confirms receipt of "first crypto" from their sponsor.

(average time to complete: __5 - 10 minutes__)

__NOTE:__ Step \#5 has consistently proven to be highly problematic.

---

__Nito.cash newcomers experience ONLY the following:__

1. Open their camera phone.
2. Scan the QR code shown on their sponsors phone.
3. Newcomer confirms receipt of "first crypto" from their sponsor.

(average time to complete: __25 - 30 seconds__)

## It's _really_ best to KISS when introducing crypto

Do you know how many __first-time users__ actually care about __securing__ their seed phrase?

__NONE__

..and that's why Nito __Keeps It Super-Simple__

Sponsorships take __less than 30 seconds__ from the moment a newcomer opens their phone, until they receive their very first crypto. The experience is __fast and painless.__

Nito further provides __ALL the necessary education__ for the newcomer; but at a time that's convenient for __THEM.__ And that way, the two parties are free to immediately resume their previous activity.

## Nito sponsorships are effortless

By offering __just $1.00 sponsorships,__ you can potentially introduce hundreds of first-time users to the wonderful world of crypto. Some of the __most welcoming__ newcomers for Nito sponsoring have included:

1. Friends & family
2. Classmates
3. Bartenders and waiters
4. Uber (ride-share) drivers
5. Party guests
6. Conference attendees

_and the list goes on and on..._

## Move your money with maximum discretion

> Everyone should have a right to privacy when it comes to THEIR OWN MONEY.

Nito.cash integrates emerging technology that improves the privacy long sought after by
the crypto community — including a Halo 2 / Orchard zero-knowledge proving service
(`@nito.cash/prover`, live at `prover.nito.cash`) for shielded transitions.

_Please visit __[r/NitoCash](https://reddit.com/r/NitoCash/)__ for the latest information regarding ongoing development._

## Is it the end for "seed phrase" wallets?

__Absolutely NOT!__

The purpose of Nito.cash is to be a super convenient, on-boarding wallet for newcomers. __It is NOT meant to serve as a "primary" daily driver for ANY user.__ Security compromises were made to ensure that newcomers are immediately introduced to an __enjoyable crypto experience.__ After which, they can choose to slowly build on their education, while exploring their specific interest(s).

__Guides are available in-app, on topics including:__

- [ ] Which wallet(s) will eventually best serve their needs.
- [ ] How to safely and securely protect their private keys.

__Cheers to that!__

---

## Repository structure

This is a pnpm **monorepo** with three packages:

| Package             | Path             | What it is                                                          |
| ------------------- | ---------------- | ------------------------------------------------------------------- |
| `@nito.cash/web`    | `apps/web/`      | The Nito.cash wallet — a client-side Vue SPA, deployed to Cloudflare Pages. |
| `@nito.cash/docs`   | `apps/docs/`     | VitePress documentation site, deployed to Cloudflare Pages as `docs.nito.cash`. |
| `@nito.cash/prover` | `workers/prover/`| A Halo 2 / Orchard ZK prover (Rust → WASM), deployed as a Cloudflare Worker at `prover.nito.cash`. |

**Related repo:** **[APECSdev/pusd-pool](https://github.com/APECSdev/pusd-pool)** — the
shielded-pool circuit, covenant, and on-chipnet build records behind Nito Cash
Private Payments.
