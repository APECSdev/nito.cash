# The Circuit

The pool's rules are encoded as a **BN254 Groth16** circuit written in **Circom**.

## Public inputs — exactly two

The circuit has exactly **2 public inputs**:

```
[ merkleRoot, actionHash ]
```

- **`merkleRoot`** — the root of the note-commitment Merkle tree (depth 20, Poseidon). The
  covenant checks this against the pool's stored state.
- **`actionHash`** — a SHA256 commitment that binds every other logical value of the action:

```
actionHash = Bits2Num(253)( SHA256( nf0 | nf1 | cm0 | cm1 |
                                    publicValueAbs | publicValueSign |
                                    assetCategory | newMerkleRoot ) )
```

where `nf*` are the input-note **nullifiers**, `cm*` are the new output-note **commitments**,
`publicValue*` encode a public deposit/withdrawal (0 for a pure shielded transfer),
`assetCategory` is the PUSD CashToken category, and `newMerkleRoot` is the post-transition tree
root. Each field is encoded as 32 bytes **big-endian** (a 256-byte preimage), and the 256-bit
digest is **truncated to 253 bits** (top 3 bits cleared) so it is always a valid BN254 field
element.

All of those values are **private witnesses** inside the circuit; the circuit **constrains**
`actionHash` to be the SHA256 of exactly those witnesses. The covenant recomputes `actionHash`
from the values it enforces (using native `OP_SHA256`), so the packed values can't be forged.

> **Why SHA256, not Poseidon?** The covenant must recompute `actionHash` on-chain to bind the
> proof to the transition it applies. Poseidon(7) needs thousands of BN254 field multiplications
> — infeasible in the covenant's op-cost budget — whereas SHA256 is a single native opcode. The
> trade-off is that SHA256 is SNARK-unfriendly, so the circuit is much larger (~183k constraints
> vs ~26k for the Poseidon version). See the 253-bit note below.

> **Why 253 bits?** The BN254 scalar-field prime is `p ≈ 2^253.6 < 2^254`. Truncating to 254 bits
> can still exceed `p`, and the circuit (which packs bits into a field signal that auto-reduces
> mod `p`) would then disagree with a covenant/client that masks without reducing. Truncating to
> 253 bits guarantees the value is always `< p`, so circuit, client, and covenant agree exactly
> with no modular reduction anywhere.

### Why two public inputs ("Option 2")

The on-chain verifier is hardcoded to a **2-scalar** public-input MSM
(`vk_x = IC0 + n0·IC1 + n1·IC2`). Rather than rewrite that battle-tested, red-team-hardened
verifier for 8 public inputs (a risky 16-point GLV-Straus rewrite that would likely blow the
consensus/standardness budget), we **kept the verifier unchanged** and reduced the circuit to 2
public inputs by packing the rest into `actionHash`. This is the conventional engineering solution
and eliminates the riskiest part of the build.

## What the circuit proves

For a 2-in / 2-out transfer:

- **Membership** — each input note's commitment is in the Merkle tree under `merkleRoot`
  (a depth-20 Poseidon Merkle path check).
- **Ownership & nullifiers** — each input note opens to a value/owner/randomness the prover knows,
  and its nullifier is derived correctly from the owner's nullifier key.
- **Value conservation** — `inValue[0] + inValue[1] = outValue[0] + outValue[1] + publicValue`.
- **Output well-formedness** — the new commitments are computed correctly.
- **Action binding** — `actionHash` is the SHA256 of the exact witnesses above.

## Stats

| Metric | Value |
| ------ | ----- |
| Curve  | BN254 (bn-128) |
| Constraints | 183,469 |
| Public inputs | 2 |
| Private inputs | 106 |
| Wires | 181,956 |
| Trusted setup | 2^18 phase-2 (phase-1 `pot18` reused) |
| Verifying key | 3 IC points (`build/verification_key.json`) |

The constraint count is dominated by the in-circuit SHA256 (the actionHash binding). Proving is
heavier than the Poseidon version but remains practical for client-side WASM proving; the on-chain
side only verifies the Groth16 proof and never re-hashes inside the circuit's trust assumptions.
