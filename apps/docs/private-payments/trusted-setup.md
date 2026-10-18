# Trusted Setup

Groth16 requires a **trusted setup**. It has two phases.

## Phase 1 — Powers of Tau (reused)

The **Powers of Tau** ceremony is **circuit-agnostic** (it depends only on the curve, BN254, and
the maximum circuit size). We **reuse an existing, publicly attested BN254 Powers of Tau
ceremony** — there is no need to redo it.

Concretely, we use the **[Perpetual Powers of Tau](https://pse.dev/projects/powers-of-tau)**
ceremony (Privacy & Scaling Explorations, ongoing since 2019, 86 participants, security rooted in
the Zcash Powers of Tau): the file **`ppot_0080_18.ptau`** (2^18 = 262,144 points, covering our
183,469 constraints; 302,083,218 bytes), prepared from contribution **#0080** plus a public
Ethereum-beacon randomness beacon (slot 7,325,000, 31 iterations). Because contributions are
sequential, it transitively includes every earlier contribution — among them **#0023, the
nito.cash operator's own** (attested March 6–8, 2020; see `0023_shomari_response` in the
[ceremony repo](https://github.com/privacy-ethereum/perpetualpowersoftau)). The file's structure
was verified byte-by-byte (magic, BN254 prime, power 18, ceremony power 28) and it is consumed
correctly by snarkjs.

## Phase 2 — circuit-specific (our own)

The **Phase 2** ceremony is **specific to our circuit** and **must be our own**. This is where the
toxic-waste assumption lives: as long as **at least one** contributor is honest and destroys their
randomness, the setup is secure.

### Chipnet PoC — disclosed 1-of-1

For the **Chipnet proof-of-concept** we ran a **single local 1-of-1 contribution** (one
contributor, on the build VPS). This is **acceptable for a valueless chipnet demo** and is
**fully disclosed** — it is *not* a decentralized ceremony and must not be treated as one.

### Mainnet — full MPC mandatory

Before any **mainnet** deployment holding real value, a **multi-party computation (MPC) ceremony**
with multiple independent, publicly-attesting contributors is **mandatory**. A 1-of-1 setup is
never acceptable for real funds, because a single compromised contributor could forge proofs and
drain the pool.

## Summary

| Stage | Phase 1 (Powers of Tau) | Phase 2 (circuit-specific) |
| ----- | ----------------------- | -------------------------- |
| Chipnet PoC | Perpetual Powers of Tau `ppot_0080_18.ptau` | **1-of-1 local** (disclosed) |
| Mainnet | Perpetual Powers of Tau `ppot_0080_18.ptau` | **Full MPC** (mandatory) |
