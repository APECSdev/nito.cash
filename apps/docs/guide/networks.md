# Networks (Mainnet / Chipnet)

Nito.cash supports two Bitcoin Cash networks:

| Network | Address prefix | Use |
| ------- | -------------- | --- |
| **Mainnet** | `bitcoincash:` | Real BCH. Real value. |
| **Chipnet** | `bchtest:` | A test network where the next BCH VM upgrade is already active. Valueless coins for testing. |

Both networks use the **same BCH keys** (coin type `145`); only the CashAddress prefix differs.

## Switching networks

Go to **Settings** and use the **Mainnet / Chipnet** toggle. The setting is persisted
(`profile.net`) and the app does a full reload on switch.

## Why Chipnet matters

The [PUSD shielded pool](/private-payments/overview) is built **Chipnet-only** for the BCH Blaze
2026 hackathon. Chipnet runs the **BCH 2026 VM**, which is what makes it possible to verify a
Groth16 proof **directly on-chain** in a single standard transaction.

## Network backend

Each network is defined in `apps/web/src/lib/bch/networks.js` with a set of Fulcrum servers and a
quorum size:

- **Mainnet** — 4 servers, quorum 2.
- **Chipnet** — 2 servers, quorum 2.

The `FulcrumCluster` (`apps/web/src/lib/bch/provider.js`) connects to **all** of a network's
servers and broadcasts every request; a response is only accepted once `quorum` servers return an
identical result.
