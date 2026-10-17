# The Circuit

The pool's rules are encoded as a **BN254 Groth16** circuit written in **Circom**.

## Public inputs — exactly two

The circuit has exactly **2 public inputs**:

```
[ merkleRoot, actionHash ]
```

- **`merkleRoot`** — the root of the note-commitment Merkle tree (depth 20, Poseidon). The
  covenant checks this against the pool's stored state.
- **`actionHash`** — a Poseidon commitment that binds every other logical value of the action:

```
actionHash = Poseidon(7)( nf0, nf1, cm0, cm1, publicValueAbs, publicValueSign, assetCategory )
```

where `nf*` are the input-note **nullifiers**, `cm*` are the new output-note **commitments**,
`publicValue*` encode a public deposit/withdrawal (0 for a pure shielded transfer), and
`assetCategory` is the PUSD CashToken category.

All of those values are **private witnesses** inside the circuit; the circuit **constrains**
`actionHash` to be the Poseidon hash of exactly those witnesses. The covenant recomputes
`actionHash` from the values it enforces, so the packed values can't be forged.

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
- **Action binding** — `actionHash` is the Poseidon hash of the exact witnesses above.

## Stats

| Metric | Value |
| ------ | ----- |
| Curve  | BN254 (bn-128) |
| Constraints | 26,189 (12,192 non-linear + 13,997 linear) |
| Public inputs | 2 |
| Private inputs | 105 |
| Wires | 26,243 |
| Prove time (4 vCPU) | ~2.8 s |
| Verify time (snarkjs) | ~28 ms |

The ~2.8 s prove time on 4 vCPUs confirms that **client-side, in-browser WASM proving is viable**.
