# Getting Started

Nito.cash is a **client-side Bitcoin Cash (BCH) privacy wallet**, built as a Single Page
Application. There is no backend server — the app runs entirely in your browser and talks to the
BCH network directly.

## What "client-side" means

- Your **mnemonic seed** is stored only on your device (persisted to an encrypted cookie /
  localStorage, never transmitted).
- All **key derivation** (BIP39 mnemonic → seed, BIP32 `m/44'/145'/0'/0/N`) and all
  **transaction signing** (Schnorr, BIP143-style `SIGHASH_ALL|FORKID`) happen **locally** using
  `@scure/bip39`, `@scure/bip32`, and `@bitauth/libauth`.
- The app talks to the BCH network over the **Fulcrum / Electrum protocol** through a
  **quorum cluster** — it connects to *multiple* servers and only accepts a result once a quorum
  of them agree, so no single endpoint is trusted.

## Create or restore a wallet

1. Open [nito.cash](https://nito.cash).
2. From the splash screen, choose **Setup**.
3. Create a new wallet (you'll be shown a 12-word recovery phrase — **write it down and keep it
   safe**) or **Import** an existing phrase.
4. Your dashboard shows your balance, addresses, and history.

## Backup

Your 12-word recovery phrase is the **only** backup. Anyone with the phrase controls the funds;
anyone without it cannot recover them. There is no "forgot password" flow.

## Next steps

- [Networks (Mainnet / Chipnet)](/guide/networks) — switch networks for testing.
- [Private Payments](/private-payments/overview) — the PUSD shielded pool.
