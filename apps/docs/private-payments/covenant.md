# The Covenant

The **covenant** is the CashScript contract that turns "a proof verifies on BCH" into "a private
PUSD pool on BCH." It holds the pool's **PUSD CashTokens** and its **state** and only allows a
spend that is accompanied by a valid proof.

It lives in a **separate input** from the verifier, in the **same transaction**. The verifier
(5 inputs) checks the Groth16 proof; the covenant (1 input) checks the state transition. Neither
trusts the other — they read each other's witnesses by introspection.

## The contract

`asset-pool.cash` — `contract AssetPool(bytes32 assetCategory)` with a single `spend` function.
The PUSD CashToken category is a **constructor parameter**, so the same contract works for any
CashToken asset.

```
function spend(
    bytes32 nf0,            // spent nullifier 0
    bytes32 nf1,            // spent nullifier 1
    bytes32 newMerkleRoot,  // note-tree root after appending the two new commitments
    int publicValueAbs,     // |public PUSD moved| this transition
    int isUnshield          // 0 = value flows IN (shield/transfer); 1 = OUT (unshield)
)
```

**Compiled size: 117 bytes** (redeem script 150 B, unlocking 101–103 B depending on the path).

## What the covenant enforces

On every spend, by **introspection** (reading the transaction it lives in):

0. **Root binding** — the proof's public input `n0` (the current `merkleRoot`), read from the
   verifier's genesis witness, must equal the pool's stored root. This pins the proof to *this*
   pool's *current* state.
1. **Continuity** — output 0 pays back to the same covenant script, so the pool cannot be drained
   to an arbitrary script.
2. **State update** — output 0's NFT commitment becomes `newMerkleRoot | newNullifierHash`, where
   `newNullifierHash = sha256(oldNullifierHash | nf0 | nf1)` folds the two spent nullifiers into
   the set hash.
3. **Conservation** — the PUSD token balance updates by exactly the public flow:
   `newBalance = currentBalance + publicValueAbs − (2 · isUnshield · publicValueAbs)`, and
   `newBalance ≥ 0`. On an unshield, a public PUSD payout output of `publicValueAbs` must exist.
4. **Asset binding** — the token category on the input and on output 0 equals the pinned
   `assetCategory`.

## State layout

The pool state rides in a **mutable CashToken NFT** on the covenant UTXO. The NFT commitment is
64 bytes:

```
merkleRoot[32]  |  nullifierSetHash[32]
```

- `merkleRoot` — the current note-commitment tree root (stored as the 32-byte little-endian VM
  number, matching the proof's `n0` byte form exactly).
- `nullifierSetHash` — a SHA256 rolling hash over the spent-nullifier set. The full set is held
  off-chain by the indexer; the covenant only needs to *update* the hash.

## Proven on the BCH 2026 VM

The covenant is evaluated as the **6th input** of the combined shielded-pool transaction (the 5
verifier inputs are untouched) on the **standard BCH 2026 VM** — the same VM the verifier is
graded on. All three paths pass, within the per-input op-cost budget `(41 + unlockingLen) × 800`:

| Path | accepted | op-cost / budget | unlocking |
| ---- | -------- | ---------------- | --------- |
| shield / transfer (`isUnshield=0, publicValueAbs=0`) | ✅ | 34,772 / 113,600 | 101 B |
| shield (`isUnshield=0, publicValueAbs=250` deposit) | ✅ | 34,778 / 115,200 | 103 B |
| unshield (`isUnshield=1, publicValueAbs=400` payout) | ✅ | 34,863 / 115,200 | 103 B |

The covenant is tiny and cheap (~35k op-cost) because it uses only native opcodes — introspection
and SHA256 — and no on-chain field arithmetic.

## Integration facts (for the wallet builder)

These are the load-bearing details that make the covenant + verifier work together. They are
documented here so the integration can be reproduced without re-deriving them.

- **VM target** — the covenant (and verifier) validate on the **standard BCH 2026 VM**
  (`createVirtualMachineBch2026(true)`). They do **not** require the proposed `bch-spec` VM, and
  they must **not** be evaluated on the legacy VM (`createVirtualMachineBch()`), which wrongly
  enforces the 520-byte stack-element limit on `OP_INPUTBYTECODE` results. The standard 2026 VM
  does not apply that limit to `OP_INPUTBYTECODE`, which is what lets the covenant read the
  verifier's 7,769-byte genesis witness in-script.
- **Reading the proof's public inputs** — the verifier's genesis step is always **tx input 3**.
  Its unlocking bytecode carries the two public inputs as 32-byte little-endian VM numbers:
  - `n1` (actionHash) **data** starts at byte offset **1792**,
  - `n0` (merkleRoot) **data** starts at byte offset **1825**
    (byte 1824 is the `0x20` push opcode; the 32-byte payload follows it).
- **`tokenCategory` introspection format** — `tx.inputs[i].tokenCategory` /
  `tx.outputs[i].tokenCategory` return the 32-byte category in **on-chain (reversed) byte order**
  **concatenated with the NFT capability byte** (`0x01` mutable, `0x02` minting). A **fungible-only**
  token output returns the bare 32-byte category (no capability byte). So:
  - the pool state NFT (mutable) compares against `assetCategory + 0x01`,
  - the unshield payout output (fungible-only) compares against the bare `assetCategory`,
  - the `assetCategory` constructor argument is supplied in **reversed (on-chain) byte order**.

## The actionHash binding (in progress)

The covenant currently binds the **proven `merkleRoot`** (`n0`) and enforces the **state
transition** by introspection. The remaining coupling step is the **`actionHash` (`n1`) binding** —
tying the exact `(nf0, nf1, cm0, cm1, publicValue, assetCategory)` the covenant enforces to the
proof, so a proof cannot attest to one transition while the covenant applies another.

The constraint space (each verified, not assumed):

- The circuit computes `actionHash = Poseidon(7)(nf0, nf1, cm0, cm1, publicValueAbs,
  publicValueSign, assetCategory)` and exposes it as public input `n1`.
- **On-chain Poseidon is infeasible** — Poseidon(7) needs thousands of BN254 field muls; the
  covenant's per-input op-cost headroom is ~79k, orders of magnitude too small.
- **The verifier's MSM is fixed at exactly 2 public inputs** (`vk_x = IC0 + n0·IC1 + n1·IC2`), so a
  third public input cannot be added without rebuilding the entire MSM chain.
- **`actionHash` uses the full ~253 bits** (it is a Poseidon field element), so there are no spare
  bits to smuggle an on-chain-recomputable tag into `n1`.

The sound resolution is to make `actionHash` a **SHA256 the covenant can recompute** over the
values it enforces (plus `cm0`/`cm1` supplied as new covenant args), keeping the MSM at 2 public
inputs. This is a circuit change and re-runs the pipeline (circuit → trusted setup → verifying key
→ verifier → re-benchmark). See the [Roadmap](/private-payments/roadmap).
