# Private Payments — Overview

**Nito Cash — Private Payments** is the first **shielded pool for PayonUSD (PUSD) on Bitcoin
Cash**. It hides the **sender, receiver, and amount** of every transfer, using a zero-knowledge
proof verified **directly on the BCH VM**.

This is the project's submission for the **BCH Blaze 2026** hackathon, and it runs on **Chipnet**
(the BCH test network where the 2026 VM upgrade is already live).

## How it works (the shape)

The pool is a set of **variable-amount notes**. Each note commits to a value, an owner, and some
randomness. To spend notes you produce a **Groth16 proof** that:

- you own the input notes and they exist in the pool's **note-commitment Merkle tree**,
- the input **nullifiers** (which prevent double-spends) are computed correctly,
- **value is conserved** (inputs = outputs + any public deposit/withdrawal), and
- the new output notes are well-formed.

The chain never sees the values, owners, or which notes were spent — only the **public inputs** to
the proof and the resulting state transition.

## The three pieces

1. **The circuit** — a BN254 Groth16 circuit (written in Circom) that encodes the pool's rules.
   It has exactly **2 public inputs**: the current `merkleRoot` and an `actionHash` that binds
   everything else. See [The Circuit](/private-payments/circuit).
2. **The on-chain verifier** — a Groth16 verifier that runs **on the BCH VM** and checks the proof
   in a single standard transaction. See [On-chain Verifier](/private-payments/verifier).
3. **The covenant** — a CashScript contract that holds the pool's PUSD CashTokens and its state
   (`{merkleRoot, nullifierSet}`) and only allows a spend that is accompanied by a valid proof.
   See [The Covenant](/private-payments/covenant).

## Privacy properties

| Property | Hidden? |
| -------- | ------- |
| Sender   | ✅ masked |
| Receiver | ✅ masked |
| Amount   | ✅ masked |

## Status

- ✅ Circuit compiles (26,189 constraints) and proves/verifies with snarkjs.
- ✅ On-chain verifier **passes on the BCH 2026 VM** with our verifying key.
- ✅ Covenant (CashScript) **built and passing on the BCH 2026 VM** — 117 bytes, all three
  spend paths accepted within op-cost budget.
- ⬜ actionHash binding (tie the enforced transition to the proof).
- ⬜ Note-detection infra (Fulcrum + Chaingraph).
- ⬜ Wallet wiring (shield / transfer / unshield UI + client-side proving).

See the [Roadmap](/private-payments/roadmap) for detail.
