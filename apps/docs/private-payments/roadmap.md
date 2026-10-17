# Roadmap

## Private Payments — build status

| Stage | Status |
| ----- | ------ |
| Circom circuit (2 public inputs) | ✅ compiles — 26,189 constraints |
| Trusted setup (PoC 1-of-1) | ✅ done |
| snarkjs prove / verify | ✅ ~2.8 s prove, ~28 ms verify |
| On-chain verifier (our key) | ✅ **PASS on the BCH 2026 VM** — one standard tx |
| BCH covenant (CashScript) | ⬜ **in design** |
| Note-detection infra (Fulcrum + Chaingraph) | ⬜ |
| Wallet wiring (UI + client proving + note store) | ⬜ |

### Next: the covenant

The **BCH covenant** is the CashScript contract that turns "a proof verifies on BCH" into "a
private PUSD pool on BCH." It:

- holds the pool's **PUSD CashTokens** and its **state** (`{merkleRoot, nullifierSet}`) in a
  CashToken NFT commitment, and
- only allows a spend that is accompanied by a valid verifier transaction whose public inputs are
  `[merkleRoot, actionHash]`, recomputing `actionHash` from the values it enforces (nullifier-set
  updates, new commitments, token balance delta, asset category).

Then: stand up **Fulcrum + Chaingraph** for note detection, and wire the wallet (shield /
transfer / unshield UI, client-side WASM proving, local encrypted note store).

## Product roadmap (post-hackathon)

Informed by a feature-parity review of the Selene wallet:

- **Stablecoin mode** — hold incoming BCH as a USD stablecoin (PUSD, later MUSD) and pay out as
  plain BCH.
- **WizardConnect** — an HD-wallet-aware BCH dApp-connect standard. Closely related: **Cauldron
  in-wallet token swaps** and **multi-fiat pricing** (144 currencies).
- **"Coming Soon" stablecoin** — exactly one additional stablecoin signalled as Coming Soon.
  **MUSD** (Moria Protocol, a BCH CashTokens stablecoin) is the recommended pick for technical
  coherence with PUSD; fUSD (Zano) is the "exploring" cross-chain alternative. *(Decision pending.)*
