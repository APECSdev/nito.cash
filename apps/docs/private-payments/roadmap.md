# Roadmap

## Private Payments — build status

| Stage | Status |
| ----- | ------ |
| Circom circuit (2 public inputs) | ✅ compiles — 26,189 constraints |
| Trusted setup (PoC 1-of-1) | ✅ done |
| snarkjs prove / verify | ✅ ~2.8 s prove, ~28 ms verify |
| On-chain verifier (our key) | ✅ **PASS on the BCH 2026 VM** — one standard tx |
| BCH covenant (CashScript) | ✅ **built + PASS on the BCH 2026 VM** — 117 B, 3/3 paths |
| actionHash binding | ⬜ **in design** (see below) |
| Note-detection infra (Fulcrum + Chaingraph) | ⬜ |
| Wallet wiring (UI + client proving + note store) | ⬜ |

### Done: the covenant

The **BCH covenant** (`asset-pool.cash`) is the CashScript contract that turns "a proof verifies
on BCH" into "a private PUSD pool on BCH." It holds the pool's **PUSD CashTokens** and its
**state** (`{merkleRoot, nullifierSetHash}`) in a mutable CashToken NFT commitment, and only
allows a spend accompanied by a valid verifier transaction. It is a **separate 6th input** in the
same transaction as the 5 verifier inputs, and it **passes on the standard BCH 2026 VM** on all
three spend paths. See [The Covenant](/private-payments/covenant).

### Next: the actionHash binding

The covenant binds the proven `merkleRoot` (`n0`) and enforces the state transition by
introspection. The remaining coupling step ties the enforced `(nf0, nf1, cm0, cm1, publicValue,
assetCategory)` to the proof's `actionHash` (`n1`). On-chain Poseidon is infeasible and the
verifier's MSM is fixed at 2 public inputs, so the sound resolution is to make `actionHash` a
SHA256 the covenant can recompute — a circuit change that re-runs the pipeline. Then: stand up
**Fulcrum + Chaingraph** for note detection, and wire the wallet (shield / transfer / unshield UI,
client-side WASM proving, local encrypted note store).

## Product roadmap (post-hackathon)

Informed by a feature-parity review of the Selene wallet:

- **Stablecoin mode** — hold incoming BCH as a USD stablecoin (PUSD, later MUSD) and pay out as
  plain BCH.
- **WizardConnect** — an HD-wallet-aware BCH dApp-connect standard. Closely related: **Cauldron
  in-wallet token swaps** and **multi-fiat pricing** (144 currencies).
- **"Coming Soon" stablecoin** — exactly one additional stablecoin signalled as Coming Soon.
  **MUSD** (Moria Protocol, a BCH CashTokens stablecoin) is the recommended pick for technical
  coherence with PUSD; fUSD (Zano) is the "exploring" cross-chain alternative. *(Decision pending.)*
