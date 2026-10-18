# Roadmap

## Private Payments — build status

| Stage | Status |
| ----- | ------ |
| Circom circuit (2 public inputs, SHA256 actionHash) | ✅ compiles — 183,469 constraints |
| Trusted setup (PoC 1-of-1, 2^18 phase-2) | ✅ done |
| snarkjs prove / verify | ✅ done |
| On-chain verifier (our key) | ✅ **PASS on the BCH 2026 VM** — one standard tx, 26 red-team rejected |
| BCH covenant (CashScript) | ✅ **built + PASS on the BCH 2026 VM** — 222 B, 3/3 paths |
| actionHash binding | ✅ **done** — 253-bit SHA256, covenant-enforced (see below) |
| Note-detection infra (Fulcrum + Chaingraph) | ⬜ |
| Wallet wiring (UI + client proving + note store) | ⬜ |

### Done: the covenant

The **BCH covenant** (`asset-pool.cash`) is the CashScript contract that turns "a proof verifies
on BCH" into "a private PUSD pool on BCH." It holds the pool's **PUSD CashTokens** and its
**state** (`{merkleRoot, nullifierSetHash}`) in a mutable CashToken NFT commitment, and only
allows a spend accompanied by a valid verifier transaction. It is a **separate 6th input** in the
same transaction as the 5 verifier inputs, and it **passes on the standard BCH 2026 VM** on all
three spend paths. See [The Covenant](/private-payments/covenant).

### Done: the actionHash binding

The covenant now binds the enforced `(nf0, nf1, cm0, cm1, publicValue, assetCategory,
newMerkleRoot)` to the proof's `actionHash` (`n1`). Because on-chain Poseidon is infeasible and
the verifier's MSM is fixed at 2 public inputs, `actionHash` is a **SHA256 the covenant
recomputes** with native `OP_SHA256`, truncated to **253 bits** so it is always a valid BN254
field element (see [The Circuit](/private-payments/circuit) for why 253 and not 254). This
required a full pipeline re-run — circuit recompile, new 2^18 phase-2 trusted setup, new
verifying key, verifier re-benchmark (PASS), covenant recompile — all complete and passing 3/3
spend paths on the standard BCH 2026 VM.

### Next: infrastructure and wallet

Stand up **Fulcrum + Chaingraph** for note detection, and wire the wallet (shield / transfer /
unshield UI, client-side WASM proving, local encrypted note store).

## Product roadmap (post-hackathon)

Informed by a feature-parity review of the Selene wallet:

- **Stablecoin mode** — hold incoming BCH as a USD stablecoin (PUSD, later fUSD) and pay out as
  plain BCH.
- **WizardConnect** — an HD-wallet-aware BCH dApp-connect standard. Closely related: **Cauldron
  in-wallet token swaps** and **multi-fiat pricing** (144 currencies).
- **"Coming Soon" stablecoin** — exactly one additional stablecoin signalled as Coming Soon.
  **DECIDED: fUSD** ([Zano](https://zano.org) — a Confidential Asset with protocol-level privacy:
  hidden sender, receiver, amounts, and asset type). The multi-coin strategy intentionally spans
  **different networks**, so fUSD not being a BCH CashToken is the point of the signal, not a
  blocker. (MUSD was considered and ruled out by the operator.)
- **Community trusted-setup ceremony** — the chipnet PoC uses a single-party (1-of-1) setup. For
  mainnet, coordinate a public **phase-2 MPC ceremony** with the Bitcoin Cash community (the
  phase-1 powers-of-tau can be imported from an existing public ceremony). A contribution page at
  **`nito.cash/ceremony`** (contribute-randomness flow, transcript attestation, 1-of-N honest
  explainer) is planned, modeled on the Tornado Cash trusted-setup ceremony. **Phase-1 source
  DECIDED:** the [Perpetual Powers of Tau](https://pse.dev/projects/powers-of-tau) ceremony (PSE,
  ongoing since 2019, 86 participants) — specifically `ppot_0080_18.ptau` (2^18, prepared from
  contribution #0080 plus a public Ethereum-beacon randomness beacon), which transitively includes
  the operator's own contribution **#0023** (attested March 2020).
