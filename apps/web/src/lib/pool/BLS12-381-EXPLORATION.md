# BLS12-381 vs BN254 — objective comparison plan

Status: **NOT STARTED**. This note exists so the comparison is run on measurements,
not on intuition. It is a task list, not a conclusion.

## Why this note exists

The pool's circuit, proving assets and on-chain verifier are all **BN254**
(`bn128`). That choice is recorded nowhere as a decision — see the "what is
verified" list below. Before committing to BN254 long-term we owe ourselves a
like-for-like measurement against BLS12-381.

## Verified baseline (BN254, as actually deployed)

| fact | source |
| --- | --- |
| proving key is `groth16 / bn128 / nPublic 2` | `public/proving/verification_key.json` |
| circuit is Circom; note/nullifier/merkle primitives are circomlib **Poseidon** + **BabyJubJub** over the BN254 scalar field | `src/lib/pool/notes.js:4-12` |
| deployed bench program redeems | `574, 574, 574, 6044, 4415` B |
| deployed bench program shared fragments | `867, 982, 559` B |
| a live action tx is ~37.9 KB (measured, `chipnet-pusd-v4`) | `/tmp/shield-tx.hex` during the 2026-11-23 session |

## Bench numbers already on record (same repo, same harness)

From `chunked/grouped/README.md` in `mr-zwets/groth16_cashscript` (commit `4571af9`):

| construction | inputs | txs | script B | op-cost |
| --- | --- | --- | --- | --- |
| BN254 grouped (`bch-groth16-grouped`) | 42 | 5 | 328,458 | 261,496,203 |
| BLS12-381 grouped (`bch-groth16-bls12381-grouped`) | 56 | 6 | 475,292 | 377,556,467 |
| **BLS12-381 grouped-residue** (`bch-groth16-bls12381-grouped-residue`) | **26** | **3** | **204,424** | **160,953,436** |

**Read this carefully:** the BLS12-381 *residue* construction is **cheaper** than the
BN254 grouped one on every column. So "BN254 is smaller on-chain" is **false** as a
blanket claim. Any comparison must be like-for-like (grouped vs grouped, residue vs
residue) or it is meaningless.

## The blocking unknown for a real comparison

The pool is not just "a Groth16 verifier" — its data model is
`Poseidon(value, ownerPub, rho, r)` commitments, `Poseidon(nk, rho)` nullifiers, a
depth-20 Poseidon Merkle tree, and `ownerPub = x(nk·G)` on **BabyJubJub**.

circomlib's Poseidon and BabyJubJub are BN254 primitives. A BLS12-381 variant
therefore needs BLS12-381-native equivalents (different hash, different curve for
the owner key), i.e. a **different circuit** — not a recompiled one.

This is the single largest cost of the comparison and must be scoped first.

## Measurement checklist (fill in before deciding anything)

- [ ] constraints: BN254 circuit vs BLS12-381 circuit (same statement, equivalent primitives)
- [ ] proof size (G1/G2 element sizes differ: BN254 G2 is 2×32 B, BLS12-381 G2 is 2×48 B)
- [ ] verifier script bytes for **both** residue variants (not grouped vs residue)
- [ ] tx count / input count under BCH standard-relay limits
- [ ] op-cost under the current BCH limits
- [ ] client-side proving time (browser/WASM) for each
- [ ] on-chain verification cost per action
- [ ] trusted-setup requirement and ceremony story for each
- [ ] toolchain maturity: circom/snarkjs BN254 vs BLS12-381 support, circomlibjs equivalents
- [ ] migration cost for this wallet (circuit + notes.js + verifier program + registry + proving assets)

## Non-goals

This note does not propose changing the live pool. The live pool is BN254 and the
BLS12-381 question is about the *next* pool, if any.
