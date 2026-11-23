# HANDOFF — generalized BN254 shielded pool (for the hushyourmoney team)

Status: **the previous shape is verified end-to-end on chain; the generalized
shape you asked for is DEPLOYED but not yet exercised by the wallet.**
Both facts are stated precisely below — do not read the second as "working".

## 1. What is verified live (chipnet)

Pool `chipnet-pusd-v4` (fixture shape: steps at inputs 0..4, covenant at 5),
category `2d7cae869dac55fbdefca88c005267ecde29ce8a038143674c877e5290e34fc7`:

| action | txid | status |
| --- | --- | --- |
| SHIELD | `23d59900004e89a4da58093cfd0745f195004d4ca1faf12cd077a9b6d3f4e9d4` | confirmed |
| SHIELD | `fd85cf4127fd31f8adf005a3362bc1912434bd46dd97bc2727b4919c281d8ced` | confirmed |
| **TRANSFER** | `8dd3ce638b47efc17e7d8318a5376c29784c1c26d6e02b3387babd09eb917e40` | **confirmed** |

The transfer: 37,977 B, 7 inputs / 8 outputs. Inputs = 5 verifier steps +
covenant + 1 funding. Outputs = pool continuity (state NFT), 5 re-created step
UTXOs, the NP01 carrier (nulldata, the recipient's encrypted note), BCH change.
Sender, recipient and amount are not on chain.

Explorer: `https://chipnet.chaingraph.cash/tx/<txid>`

## 2. THE CRITICAL FINDING — the program is VK-SPECIFIC

`chunked/bn254/pairfold5-msm/vkx-msm.mjs:30`

```js
export const FINAL = mm.vk.ic[0].subtract(G1.BASE.multiply(1n << 64n)).toAffine();
```

`mm.vk` comes from `$VERIFIER_DIR/src/checkpoints/pairing-vectors.json`. That
constant is baked into the **genesis and terminal redeems**, so a program built
with key A can NEVER be satisfied by a witness computed for key B.

This cost several deployments. **Before you deploy anything, substitute your own
verifying key into `pairing-vectors.json`, then run `build.mjs`.**

```bash
# 1. back up
cp $VERIFIER_DIR/src/checkpoints/pairing-vectors.json /tmp/pv-backup.json
# 2. write YOUR vk + proof + publicInputs into it (snarkjs shapes:
#    vk_alpha_1/vk_beta_2/vk_gamma_2/vk_delta_2/IC, pi_a/pi_b/pi_c)
# 3. build
VERIFIER_DIR=$HOME/zkb/zk-verifier-bench \
  node chunked/bn254/densless-msm/build.mjs out.json
# 4. restore
cp /tmp/pv-backup.json $VERIFIER_DIR/src/checkpoints/pairing-vectors.json
```

The three EXEC redeems are vk-independent (identical lockings either way); only
genesis and terminal change.

**Ground truth check:** with your key substituted, `produceTransaction` from the
same tree emits the exact expected unlockings. `lib/pool/verifier.js`
(`produceVerifierInputs`) must reproduce them **byte-for-byte**. That equality
is the acceptance gate — it was verified here for all five steps
(`6717, 6480, 6409, 7904, 8965`).

## 3. The generalized shape (deployed, awaiting funds)

Requested revision: covenant at input 0, steps at 1..5, outputs in program order.

Pool `chipnet-pusd-v4` (generalized), category
`0717e1a1d4db6c1f06d99f4578f5c4ab54085f4169e5ff6c94ea109d27f9d9a4`:

```
deploy   47497625252d913b53b21db2420dc581e9945b3545a7c377d926ff75a1773ffa
mint     5615725dbce75ad42042606f7c20dc85d8c7fad4f8c9de5d2db72c0737722a63
lockings ae48c2c2… (exec x3)  916f4560… (genesis)  e6c6a4f2… (terminal)
```

Transaction shape:

```
in 0    pool covenant          out 0   pool continuity (state NFT)
in 1-3  exec0, exec1, exec2    out 1-3 exec0, exec1, exec2
in 4    genesis                out 4   GENESIS
in 5    terminal               out 5   TERMINAL
in 6    funding (exactly one)  out 6   carrier, out 7 change
```

### Generalization = 10 operand shifts

| redeem | sites | change |
| --- | --- | --- |
| exec0/1/2 | @82 | `OP_3` → `OP_4` |
| terminal | @1500, @2545, @2557, @2782, @3309, @3312, @3315, @3359, @3896 | index +1 |
| terminal | @3304 | self-index `OP_4` → `OP_5` |

`OP_TXINPUTCOUNT` stays **7** (covenant + 5 steps + 1 funding).

The covenant reverts to the **original gate3 bytecode** (unshifted `54ca`) —
the genesis witness is input 4 again, which is exactly what it reads.

### Two program invariants you must not violate

1. **`tx.inputs.length == 7`** (terminal `@1549-1551`: `OP_1 TXINPUTCOUNT OP_7
   EQUALVERIFY`). With 5 steps + covenant that leaves **exactly one** funding
   input, and that single UTXO must carry both the pool tokens and the fee.
2. **`inputs[INPUTINDEX].outpointIndex == INPUTINDEX`** (`@1552-1555`). Each
   step must be re-created at the output index equal to its input index — which
   is why the steps go out at outputs 1..5 in program order.

## 4. Genesis minimality gate (wallet side)

The covenant reads the genesis witness at **fixed** byte offsets (`n1` @1792,
`n0` @1825), forcing fixed 32-byte LE pushes. The program consumes those same
values with **VM arithmetic**, where a 32-byte word with a zero most-significant
byte is a non-minimal VM number and is rejected
(`Invalid input: this operation requires a valid VM Number`, measured at genesis
`ip971`).

The two requirements coincide whenever every fixed-32 value has a non-zero top
byte (~92% of proofs). `submitPoolAction` therefore **rebuilds the witness**
(fresh note randomness — the prover is deterministic per witness, so re-proving
alone cannot change an encoding) until that holds.

## 5. Registry entry (drop-in)

See `registry-entry-v5.json` in the artifacts bundle, and
`apps/web/src/lib/pool/registry.js` (`chipnet-pusd-v4`) for the live form. Fields
that matter: `lockingBytecode`, `covenantRedeem`, `assetCategory`,
`genesisRootLE`, `genesisLeafCount`, `genesisLeaves`, `bootstrapNotes`,
`stepLockings`, `program`.

## 6. Artifacts (on the apecsdev VM, `~/zkb/pool-handoff/`)

| file | what |
| --- | --- |
| `bench-program-vk-correct.json` | `build.mjs` output with OUR vk |
| `ground-truth-unlockings.json` | `produceTransaction` ground truth (5 unlockings) |
| `real-proof.json` | a real proof + vk + publicSignals used for the diff |
| `registry-entry-v5.json` | the generalized pool's registry entry |
| `deploy3.log`, `deploy5.log` | deploy transcripts (vk-correct, generalized) |
| `shield-tx.hex` | a fully built, VM-passing shield transaction |
| `pool-notes.json` | the wallet's persisted shielded notes |
| `pairing-vectors-original.json` | the pristine bench checkpoints file |

Repo: `git@github.com:APECSdev/nito.cash.git`, branch `master`.
Key commits: `7c5231c` (first on-chain action), `b174499` (confirmed transfer),
`4cfac79` (generalized shape).

## 7. Known limitation at handoff

The generalized pool is deployed but **not yet exercised**. Every funded chipnet
key is below the ~38,000-sat action fee (a 37,977 B transaction at the 1 sat/B
floor), and `https://chipnet.bch.ninja` requires a browser-side proof-of-work
challenge. Fund the wallet, then:

```bash
cd apps/web
node --import ./.loader-register.mjs scripts/shield-e2e.mjs \
  --mnemonic "<24 words>" --amount 1000 --action shield
```

A shield needs a single funding UTXO carrying pool tokens **and** >= 50,000 sats
(see `scripts/send-tpusd.mjs --token-sats`). The transfer additionally needs the
recipient's delivery point (`--to <hex>`) and a persisted note store
(`--notes /tmp/pool-notes.json`).
