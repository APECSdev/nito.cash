# Reading a Pool Transaction

This page explains what a live shielded-pool transaction looks like on a block explorer, and why
the values you see there are **not** the transfer. It uses real Chipnet transactions as the
reference.

The short version: **sender, receiver, and amount are hidden.** What an explorer shows is the
pool's public *plumbing* — the pool's total balance and the fee/change outputs — which is public
by design. The actual transfer is a handful of opaque hashes.

## Inputs & outputs (by operation)

Every pool transaction spends the same **6 pinned inputs** — `in[0..4]`, the 5 verifier
stages, plus `in[5]`, the pool covenant — and re-creates the pool covenant (`out[0]`) and
the 5 verifier scripts. Everything else is **funding** the covenant never reads, and it is
that funding that makes the exact input/output count differ by operation:

```
INPUTS (pinned, all txs)               OUTPUTS
in[0..4] 5 verifier P2SH32 inputs     out[0]   pool covenant (perpetuated, new state)
         (proof-specific unlocking,    + the 5 verifier re-creations (fixed P2SH32):
         ~6–9 KB each)                   shield/transfer → out[1,2,3] 3× executor,
in[5]   pool covenant (~520 B)                     out[4] terminal, out[5] genesis
                                       unshield       → out[2,3,4] 3× executor,
+ funding (per operation):                         out[5] terminal, out[6] genesis
  SHIELD   in[6]  PUSD deposit being
           shielded · in[7] sats       + the operation-specific funding / payout:
  TRANSFER in[6]  sats                  SHIELD   out[6] token change · out[7] sats change
  UNSHIELD in[6]  sats                  TRANSFER out[6] sats change
                                       UNSHIELD out[1] public payout (P2PKH) inserted,
                                                shifting the rest down · out[7] sats change
```

So the counts are **SHIELD 8 in / 8 out**, **TRANSFER 7 in / 7 out**, **UNSHIELD 7 in / 8
out**. A TRANSFER is the bare minimum: the 6 pinned inputs + one sats input, and the 6
pinned outputs + one sats change.

- **Group 1 — the ZK verifier (in[0–4]).** The Groth16 verifier *executing on-chain*. It
  spends the previous pool transaction's 5 verifier UTXOs and re-creates them with the same
  locking scripts. Pure machinery — no user data. It must be public: it *is* the trustless
  verification.
- **Group 2 — the pool covenant (in[5] → out[0]).** The state transition. `out[0]` carries the
  pool's mutable NFT whose commitment is the new `{merkleRoot, nullifierSetHash}` state — just
  hashes.
- **Group 3 — the funding.** The wallet's *public* sats pay the fee (and, for a SHIELD, a
  token input supplies the PUSD being deposited). Not part of the private action. A TRANSFER or
  UNSHIELD carries **no fungible-token pass-through** — the covenant never validated that
  net-zero self-transfer, so it has been removed as structurally meaningless.

The covenant only ever reads `in[0..5]`: itself (`in[5]`, via `this.activeInputIndex`) and the
verifier **genesis** stage (`in[3]`, for the proven `n0`/`n1`). It requires `out[0]` (its own
re-creation) and — only when unshielding — `out[1]` (the payout). It **never references the
funding inputs** — those exist purely to fund the fee (and, for a SHIELD, to supply the tokens
being deposited), and could be replaced by any other funding source without the covenant
caring.

The verifier UTXOs are **self-perpetuating**: consumed as `in[0..4]`, re-created with the same
(fixed, verifying-key-derived) locking scripts. Each transaction advances the chain one step,
so the pool and verifier outpoints move forward together.

## The transfer payload = 6 opaque hashes + zero public value

The *entire* private action of a TRANSFER lives in the covenant input's (in[5]) unlocking
bytecode. From the live TRANSFER
([`6745f445…`](https://chipnet.imaginary.cash/tx/6745f445ef414cfaa544004cf3e3ea3a8681ba0d1218d523c462fc7ffd6732b7)):

```
isUnshield      = 0          ← a transfer, not an unshield
publicValueAbs  = 0          ← NO public value moved (the key point)
newMerkleRoot   = 0183d8f7…  ← updated note-tree root (a hash)
cm0, cm1        = 2aa24e69… / 056bc7e0…   ← 2 NEW note commitments (hashes)
nf0, nf1        = 2b9324a2… / 09656c28…   ← 2 SPENT-note nullifiers (hashes)
```

That is everything. The amount, sender, and receiver never appear. The value moved lives *inside*
the note commitments (`cm0`/`cm1`) as hashes; the spent notes are referenced only by nullifiers
(`nf0`/`nf1`), which are unlinkable to the original notes. The ZK proof attests "the spent notes
exist in the tree, value-in = value-out, the nullifiers/commitments are well-formed" — without
revealing any of it.

## Why you "see values" on the explorer

Two reasons, and neither is the transfer:

1. **`out[0]` shows the pool's total shielded balance** (e.g. `1,000,000` units). A transfer moves
   value *within* the pool, so this total is **unchanged** by the transfer — it was 1M after the
   shield and is still 1M after. This number is necessarily public: it is the token amount sitting
   on the pool's UTXO.
2. **At the public boundary, the crossing value is visible** — but a TRANSFER crosses no
   boundary. The reference TRANSFER therefore shows **no public token movement at all**: its only
   visible amount is the unchanged pool total. (A SHIELD still shows the deposit entering, plus
   the wallet's leftover token change; an UNSHIELD shows the payout at `out[1]`.)

The ~1,000-sat outputs are just dust carrying the tokens/NFTs. Explorers that decode CashTokens (the chipnet
explorer linked above does) render those fungible-token amounts — which is why they look like "the transfer."
On a TRANSFER the single visible amount is the *pool total*, not the transfer.

## Visibility by operation

The amount is visible only at the **public boundary**, where value crosses between public and
shielded:

| Operation | `publicValueAbs` | Amount visible? | Why |
| --------- | ---------------- | --------------- | --- |
| SHIELD (public → pool) | deposit amount | ✅ entering | value crosses in |
| TRANSFER (pool → pool) | `0` | ❌ hidden | nothing crosses the boundary |
| UNSHIELD (pool → public) | payout amount | ✅ exiting | value crosses out |

What the pool **always** hides is the **linkage**: which deposit corresponds to which transfer or
withdrawal. That unlinkability — not amount-hiding at the boundary — is the privacy guarantee.

## The mental model

Think of the pool as a **black box holding N units**. An explorer sees the box and its total, but
not what's inside. A transfer = dropping a sealed envelope in and taking a sealed envelope out:
the box's total is unchanged, and the envelopes (commitments/nullifiers) are opaque. The public
change output is a *separate* transparent wallet sitting next to the box, untouched.

## The verifier stages: genesis, executors, terminal

The on-chain verifier is split across **5 chained inputs**, each computing one slice and passing
an intermediate "state push" to the next (see [On-chain Verifier](/private-payments/verifier)).
The stage names:

- **Genesis** — **input 3**, the anchor/first stage. (A naming collision: this is *not* the
  CashTokens "genesis" = token creation.) It carries the **public inputs** `n0` = merkleRoot and
  `n1` = actionHash as witness pushes, defines the **shared MSM helper code + tables** (once) that
  the other stages borrow, holds the `vk_x` the pairing consumes, and runs the first MSM slice
  (positions 63..26). The pool covenant reads `n0`/`n1` out of genesis's witness (byte offsets
  **1825** / **1792**) to bind the proof to the pool state transition.
- **Executors** — **inputs 0, 1, 2**. They run consecutive MSM slices (positions 25..18, 17..10,
  9..4). All three share **one identical script** (hence the identical P2SH32 hashes on
  `out[1,2,3]`); the script reads its own `OP_INPUTINDEX` to decide which slice to run. One
  bytecode, three roles — a byte-size optimization.
- **Terminal** — **input 4**, the final stage. It runs the last MSM slice (positions 3..0),
  converts to affine, checks the result equals genesis's `vk_x`, verifies the GLV decomposition
  reconstructs exactly `n0` and `n1` (the soundness fix that ties the proof to the *claimed*
  public inputs), emits the final accept/reject, and **pins the transaction shape** — exactly 5
  inputs and every worker's locking script — so the verifier can't be reordered or malleated.

## The minimal structure (and why it barely matters)

The reference transactions **are** the practical minimum. Reading the covenant's requirements:

- **Inputs.** Six are pinned by the covenant/verifier at fixed positions: `in[0..4]` (the 5
  verifier stages — genesis must sit at `in[3]`) and `in[5]` (the pool covenant). Everything
  else is fee funding. A TRANSFER or UNSHIELD therefore needs **7 inputs** (the 6 + one sats
  input); a SHIELD needs **8** (the 6 + the token deposit being shielded + one sats input).
  (Earlier reference transactions *also* carried a net-zero fungible-token pass-through that the
  covenant never read; that structurally-meaningless I/O has been removed from the TRANSFER and
  UNSHIELD reference transactions.)
- **Outputs.** `out[0]` (covenant re-creation) plus the 5 verifier re-creations are required
  = **6 outputs**. An UNSHIELD adds the public payout = **7**. Change outputs (token/sats) are
  optional — droppable when the funding is exact; the reference transactions keep one sats
  change output for practical fee funding.

But trimming the funding I/O barely changes the size, because the transaction is dominated by
the verifier:

| Component | Bytes (TX-T2) | Share |
| --------- | ------------- | ----- |
| 5 verifier inputs (unlocking bytecode) | 35,453 | **~96%** |
| pool covenant input | ~561 | ~1.5% |
| sats funding input | ~141 | ~0.4% |
| 7 outputs + overhead | ~627 | ~1.7% |

The verifier is *fixed* overhead — the price of verifying a Groth16 proof trustlessly on-chain.
It does not shrink with fewer funding inputs or smaller transfers. Removing the fungible-token
pass-through is therefore about **structural clarity** — carrying only meaningful I/O — not a
meaningful size or fee reduction.

## The pool's token supply

- **Chipnet** — a stand-in CashToken was minted (category
  `0x8c73ff150fbc5d1599d2de187c3382c5926cc5c9c2621cdc2cac1fc14cd93144`, 100,000,000 fungible
  units) purely to develop and demo against. PUSD is mainnet-only, so a lookalike was needed on
  Chipnet. The exact figure is arbitrary — chipnet tokens have no value.
- **Mainnet** — the pool mints **zero**. It does not create PUSD; it shields *existing* PUSD
  (category `0x2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544`, issued by
  PayonUSD). The pool is a privacy layer on top of an existing CashToken: users deposit PUSD they
  already hold, and the pool's balance is simply the sum of deposits. The pool never holds PUSD's
  minting capability — that stays with the issuer.
