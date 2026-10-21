# USDCx on Aleo — Privacy-Stablecoin Rail Research

Verified via fetch of the authoritative source (`https://aleo.org/usdcx/`, fetched
live). This informs the wallet's private-stablecoin rail decision (Milestone 1).

## What USDCx is (verified)

- **The first private stablecoin on Aleo**, built by **Circle + Aleo**.
- **Live on Mainnet now** (per the Aleo page).
- **Fully backed 1:1 by USDC** held in **Circle xReserve** — Circle's infrastructure
  that lets a blockchain team deploy a USDC-backed stablecoin. USDCx is minted on
  Aleo via xReserve; native USDC (Circle-issued, backed by cash/cash-equivalents) is
  deposited in the xReserve contract, and USDCx is backed 1:1 by that.
- **Privacy via Aleo's zero-knowledge (ZK) cryptography** — the network
  "mathematically verifies transactions without revealing the underlying data."
  Transactions, balances, and activity "remain fundamentally private."
- **Programmable privacy balanced with auditable security** — "control what you
  share on your terms" (selective disclosure / compliance optionality).
- **xReserve minimizes bridge trust** via **cryptographic attestations** verifying
  deposits/withdrawals, and enables seamless 1:1 transfers between USDCx and the
  broader USDC ecosystem.
- **Acquisition:** bridge existing USDC from a supported network (e.g. Ethereum) to
  Aleo via xReserve.
- **Caveat:** USDCx is private ONLY on Aleo. "Transactions involving USDCx on
  non-Aleo chains are not private by default."
- Hardware-wallet support exists: private USDCx transactions on **Ledger** (per
  Aleo/Ledger coverage).

## Why it matters for Nito.cash

USDCx validates the core thesis of the **Privacy / Nito Cash rail**: a USD
stablecoin whose transfers are shielded by ZK, with opt-in auditability. It is the
strongest "private USD" rail available today because it combines:

1. **Circle trust/liquidity** (real USDC backing, not an algorithmic or niche asset), and
2. **purpose-built ZK privacy** (Aleo's record model + selective disclosure), and
3. **compliance optionality** (auditable when needed).

This is exactly the UX Milestone 1 targets (hold USD privately, pay out as needed).

## vs the BCH-native options (PUSD / MUSD)

| Axis | USDCx (Aleo) | PUSD (BCH mainnet) | Chipnet stand-in (our pool) |
|------|--------------|--------------------|-----------------------------|
| Backing | Circle USDC 1:1 | PayonUSD reserves | valueless test token |
| Privacy | Aleo ZK (native) | none (transparent CashToken) | our Groth16 covenant pool |
| Chain | Aleo | BCH | BCH Chipnet |
| Maturity | Mainnet, live | Mainnet | PoC (TX-S1/T1/U1 proven) |
| Wallet cost | Aleo acct + xReserve bridge + Aleo proving | BCH CashTokens | BCH + our covenant |

USDCx/Aleo is the **production-grade private-USD rail**; our BCH covenant pool is
the **sovereign BCH-native** path (no foreign-chain bridge, keeps value on BCH).
They are complementary: USDCx for mainstream private-USD, the BCH pool for
BCH-native privacy. Both fit the 4-wallet model as "Privacy" rail options.

## Integration implications (if adopted)

- Aleo account support (Aleo key/address scheme, record model, view keys).
- xReserve bridging (USDC from Ethereum → Aleo).
- Aleo client-side proving (SnarkVM) — analogous to our `lib/pool/prover.js` but
  for Aleo's zkVM.

## Sources

- `https://aleo.org/usdcx/` (authoritative — backing, xReserve, ZK privacy, mainnet).
- Corroborating coverage: Cointelegraph ("Circle Develops Privacy-Focused USDCx With
  Aleo"), Tangem ("Aleo and Circle Unveil Privacy-First USDCx Stablecoin"), Ledger
  coverage (private USDCx on hardware wallets).
