# Trusted Setup

Groth16 requires a **trusted setup**. It has two phases.

## Phase 1 — Powers of Tau (reused)

The **Powers of Tau** ceremony is **circuit-agnostic** (it depends only on the curve, BN254, and
the maximum circuit size). We **reuse an existing, publicly attested BN254 Powers of Tau
ceremony** — there is no need to redo it.

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
| Chipnet PoC | Reuse existing attested ceremony | **1-of-1 local** (disclosed) |
| Mainnet | Reuse existing attested ceremony | **Full MPC** (mandatory) |
