# On-chain Verifier

The Groth16 proof is verified **directly on the BCH VM** — there is no trusted off-chain verifier.
This is what makes the pool trustless.

## The verifier

We use the **`densless-msm`** verifier from the
[`zk-verifier-bench`](https://github.com/) benchmark suite, wired to **our** verifying key. It is a
chunked, intra-transaction Groth16 verifier built for the BCH 2026 VM:

- The pairing is split across **5 chained steps** within a single transaction (the BCH VM's
  per-script op-cost and byte limits are worked around by carrying the Miller-loop state between
  inputs).
- The public-input MSM is the **2-scalar** computation `vk_x = IC0 + n0·IC1 + n1·IC2`, which is
  exactly why the circuit exposes [exactly 2 public inputs](/private-payments/circuit).

## Proven on the BCH 2026 VM

The verifier, wired to our verifying key and fed real proofs from our circuit, **passes** on the
BCH 2026 VM:

```
bch-groth16-intratx-pairfold5-densless-msm  BN254  PASS (5/5✗)  5 steps  35,627 B  24.40M op  @10KB:1  BCH compatible: yes
```

| Property | Result |
| -------- | ------ |
| Correctness | **PASS** — 5/5 valid proofs accepted |
| Total size | **35,627 B** — fits in **one standard transaction** |
| Op-cost | 24.40M (within the loosened 2026 VM limits) |
| Standardness | **standard** — relayable under default mempool policy |
| Proof generality | runtime-general — one fixed locking verifies 4/4 distinct proofs |
| Cross-stage binding | **BOUND** — every stage pinned to one proof |
| Public inputs | **bound** — all 9 mutated-input claims rejected |

In short: a real proof from our circuit, under our verifying key, is **accepted by the on-chain BCH
verifier in a single, standard, relayable transaction** — and tampered inputs are rejected.

## Why the 2026 VM

This verifier is only possible on the **BCH 2026 VM** (live on Chipnet). The current mainnet VM's
script-size and op-cost limits are too tight for an on-chain Groth16 pairing. That is why the pool
targets **Chipnet for the hackathon** and mainnet only after the 2026 upgrade activates.

> Note: a `densless-msm-spec` variant exists that is smaller (33,640 B) but requires a *proposed*
> 100 kB-script VM that is not yet on BCH — so we stay on the `densless-msm` variant that is valid
> today.
