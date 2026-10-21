# Reading a Pool Transaction

This page explains what a live shielded-pool transaction looks like on a block explorer, and why
the values you see there are **not** the transfer. It uses real Chipnet transactions as the
reference.

The short version: **sender, receiver, and amount are hidden.** What an explorer shows is the
pool's public *plumbing* — the pool's total balance and the fee/change outputs — which is public
by design. The actual transfer is a handful of opaque hashes.

## The 8 inputs / 8 outputs

Every pool transaction (shield, transfer, or unshield) has the same shape: **8 inputs, 8
outputs**, in three groups.

```
INPUTS                                  OUTPUTS
in[0..4] 5 verifier P2SH32 inputs      out[0]   pool covenant (perpetuated, new state)
         (proof-specific unlocking,     out[1,2,3] 3× executor script (same P2SH32)
         ~6–9 KB each)                  out[4]   genesis script
in[5]   pool covenant (~520 B)          out[5]   terminal script
in[6]   PUSD fungible-token input      out[6]   fungible-token change (P2PKH)
in[7]   BCH sats input (fee funding)   out[7]   sats change (P2PKH)
```

- **Group 1 — the ZK verifier (in[0–4] → out[1–5]).** The Groth16 verifier *executing on-chain*.
  It spends the previous pool transaction's 5 verifier UTXOs and re-creates them with the same
  locking scripts. Pure machinery — no user data. It must be public: it *is* the trustless
  verification.
- **Group 2 — the pool covenant (in[5] → out[0]).** The state transition. `out[0]` carries the
  pool's mutable NFT whose commitment is the new `{merkleRoot, nullifierSetHash}` state — just
  hashes.
- **Group 3 — the public funding (in[6,7] → out[6,7]).** The wallet's *public* tokens and sats,
  which pay the fee. Not part of the private action.

The verifier UTXOs are **self-perpetuating**: consumed as `in[0..4]`, re-created as `out[1..5]`
with the same (fixed, verifying-key-derived) locking scripts. Each transaction advances the chain
one step, so the pool and verifier outpoints move forward together.

## The transfer payload = 6 opaque hashes + zero public value

The *entire* private action of a TRANSFER lives in the covenant input's (in[5]) unlocking
bytecode. From the live TRANSFER
([`3a8b9287…`](https://chipnet.chaingraph.cash/tx/3a8b9287ea97c050b0110522afa84daf0de90984ef3266db4062768d19adf8a5)):

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
2. **`out[6]` shows a large public balance** (e.g. `99,000,000` units) — the wallet's *separate,
   public* holdings (the un-shielded remainder). It passes straight through (`in[6]` → `out[6]`,
   unchanged) purely to carry sats for the fee. The transfer never touches it.

The ~1,000-sat outputs are just dust carrying the tokens/NFTs. Explorers like Chaingraph decode
CashTokens and render those fungible-token amounts — which is why they look like "the transfer."
They are the *pool total* and the *public change*, not the transfer.

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
