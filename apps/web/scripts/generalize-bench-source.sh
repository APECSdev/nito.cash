#!/usr/bin/env bash
# apps/web/scripts/generalize-bench-source.sh
#
# Apply the COVENANT-AT-INPUT-0 generalization to the BENCH GENERATOR SOURCES
# (never to compiled bytecode), rebuild the program, then restore the bench.
#
# TARGET SHAPE (verified live on chipnet, pools 0d31da75…):
#   in  0 covenant   in 1-3 exec0/exec1/exec2   in 4 genesis   in 5 terminal   in 6 funding
#   out 0 continuity   out 1-3 exec steps   out 4 GENESIS   out 5 TERMINAL   out 6 carrier   out 7 change
#
# The generalization touches FIVE source files. Every edit is size-preserving
# (OP_n -> OP_(n+1) or index +1), so the program layout (redeems 574,574,574,
# 6044,4415; fragments 867/982/559; witness sizes 6717/6480/6409/7904/8965)
# is IDENTICAL to the fixture build — only the semantics shift.
#
#   loader.mjs        fragment reads OP_0,1,2 -> OP_1,2,3
#   build.mjs         stage() defs read OP_3 -> OP_4 (genesis input)
#                     sourceA pinEnd.idx 0 -> 1 (pins exec0's state push)
#   vkx-stages.mjs    executors: base next 1 -> 2; if(k==1)/(k==2) -> (k==2)/(k==3);
#                     next 2,4 -> 3,5; sourceFinal genIdx 3 -> 4
#   terminal.mjs      self-index OP_4 -> OP_5; UTXO checks OP_0..3 -> OP_1..4;
#                     vk_x read input 3 -> 4; exec0/1/2 header reads 0,1,2 -> 1,2,3
#   genesis.mjs       exec0 header read input 0 -> 1
#   shared.mjs        THE HIDDEN ONE: the assembled shared program's main
#                     dispatches on k (guard k<3 -> k<4; compares 0,1,2 -> 1,2,3
#                     at 14 sites incl. the first-executor flag + adapter gate)
#                     and reads inputs 0..4 -> 1..5 at 7 sites.
#   genesis-slice.json  sourceGenesisSha256 pin -> the generalized program hash
#
# THE PROGRAM IS VK-SPECIFIC (vkx-msm.mjs:30 FINAL = vk.ic[0] - [2^64]G):
# substitute YOUR verifying key into $VERIFIER_DIR/src/checkpoints/pairing-vectors.json
# before running. The genesis-slice pin must match the built program:
#   generalized genesis hash = 529861d41e32cc59afb6c888bd78c214c6fd63dba85b2296ba53adf9365cdd15
#
# Acceptance (all on the build host, zero deployments):
#   1. densless-msm/transaction.mjs produceTransaction -> the 5 witnesses
#   2. synthetic 7-input tx (covenant 0, steps 1-5, funding 6) -> BCH-2026 VM:
#      ALL step inputs must PASS (exec0 24545 / exec1 22360 / exec2 23375 /
#      terminal 31500 steps; the genesis is proof-cost-marginal: the bench's
#      own test proof exceeds its op-cost budget — a wallet-fresh proof passes).
set -euo pipefail
OUT="${1:-/tmp/bench-generalized.json}"
BENCH="${BENCH:-$HOME/zkb/groth16_cashscript/chunked/bn254}"
export VERIFIER_DIR="${VERIFIER_DIR:?set VERIFIER_DIR to the zk-verifier-bench checkout}"

for f in densless-msm/build.mjs densless-msm/vkx-stages.mjs densless-recovered/terminal.mjs \
         densless-recovered/loader.mjs densless-recovered/shared.mjs \
         densless-recovered/genesis.mjs densless-msm/genesis-slice.json; do
  cp "$BENCH/$f" "/tmp/$(basename "$f").genbak"
done
restore() {
  cp /tmp/build.mjs.genbak "$BENCH/densless-msm/build.mjs"
  cp /tmp/vkx-stages.mjs.genbak "$BENCH/densless-msm/vkx-stages.mjs"
  cp /tmp/terminal.mjs.genbak "$BENCH/densless-recovered/terminal.mjs"
  cp /tmp/loader.mjs.genbak "$BENCH/densless-recovered/loader.mjs"
  cp /tmp/shared.mjs.genbak "$BENCH/densless-recovered/shared.mjs"
  cp /tmp/genesis.mjs.genbak "$BENCH/densless-recovered/genesis.mjs"
  cp /tmp/genesis-slice.json.genbak "$BENCH/densless-msm/genesis-slice.json"
}
trap restore EXIT

python3 - "$BENCH" <<'PY'
import json, sys
B = sys.argv[1]
edits = [
 # loader.mjs — fragment reads (execs at vins 1,2,3)
 ('densless-recovered/loader.mjs',
  '  NUM FRAGMENT_0_BYTES OP_0 CALL fragmentReader\n  NUM FRAGMENT_1_BYTES OP_1 CALL fragmentReader\n  NUM FRAGMENT_2_BYTES OP_2 CALL fragmentReader',
  '  NUM FRAGMENT_0_BYTES OP_1 CALL fragmentReader\n  NUM FRAGMENT_1_BYTES OP_2 CALL fragmentReader\n  NUM FRAGMENT_2_BYTES OP_3 CALL fragmentReader'),
 # build.mjs — the stage() defs read (genesis input) + sourceA pin
 ('densless-msm/build.mjs',
  'OP_3 OP_INPUTBYTECODE OP_SIZE NUM BACK OP_SUB OP_SPLIT OP_NIP NUM LENGTH OP_SPLIT OP_DROP',
  'OP_4 OP_INPUTBYTECODE OP_SIZE NUM BACK OP_SUB OP_SPLIT OP_NIP NUM LENGTH OP_SPLIT OP_DROP'),
 ('densless-msm/build.mjs',
  'pinEnd: {idx: 0, back: backExec, size: STATE_BYTES}',
  'pinEnd: {idx: 1, back: backExec, size: STATE_BYTES}'),
 # vkx-stages.mjs — the executor k-branch chain
 ('densless-msm/vkx-stages.mjs', 'int next = 1; int back = ${backExec};', 'int next = 2; int back = ${backExec};'),
 ('densless-msm/vkx-stages.mjs', 'if (k == 1) { from = ${cuts[1]}; to = ${cuts[2]}; next = 2; }', 'if (k == 2) { from = ${cuts[1]}; to = ${cuts[2]}; next = 3; }'),
 ('densless-msm/vkx-stages.mjs', 'if (k == 2) { from = ${cuts[2]}; to = ${cuts[3]}; next = 4; back = ${backTerminal}; }', 'if (k == 3) { from = ${cuts[2]}; to = ${cuts[3]}; next = 5; back = ${backTerminal}; }'),
 ('densless-msm/vkx-stages.mjs', 'export const sourceFinal = ({ from, genIdx = 3 })', 'export const sourceFinal = ({ from, genIdx = 4 })'),
 # terminal.mjs — the tail checks + the exec/genesis witness reads
 ('densless-recovered/terminal.mjs',
  'OP_INPUTINDEX OP_4 OP_EQUALVERIFY OP_0 OP_UTXOBYTECODE OP_HASH256 OP_1\n    OP_UTXOBYTECODE OP_HASH256 OP_2 OP_UTXOBYTECODE OP_HASH256 OP_3 OP_UTXOBYTECODE OP_HASH256 OP_CAT OP_CAT',
  'OP_INPUTINDEX OP_5 OP_EQUALVERIFY OP_1 OP_UTXOBYTECODE OP_HASH256 OP_2\n    OP_UTXOBYTECODE OP_HASH256 OP_3 OP_UTXOBYTECODE OP_HASH256 OP_4 OP_UTXOBYTECODE OP_HASH256 OP_CAT OP_CAT'),
 ('densless-recovered/terminal.mjs', 'OP_3 OP_INPUTBYTECODE OP_3 OP_SPLIT OP_NIP OP_PUSHBYTES_2 0xc001', 'OP_4 OP_INPUTBYTECODE OP_3 OP_SPLIT OP_NIP OP_PUSHBYTES_2 0xc001'),
 ('densless-recovered/terminal.mjs', 'OP_0 OP_INPUTBYTECODE OP_PUSHBYTES_2 0x3a12', 'OP_1 OP_INPUTBYTECODE OP_PUSHBYTES_2 0x3a12'),
 ('densless-recovered/terminal.mjs', 'OP_PUSHBYTES_2 0x4d11 OP_SPLIT OP_NIP OP_PUSHBYTES_2 0xe004 OP_SPLIT OP_DROP OP_2', 'OP_PUSHBYTES_2 0x4d11 OP_SPLIT OP_NIP OP_PUSHBYTES_2 0xe004 OP_SPLIT OP_DROP OP_3'),
 ('densless-recovered/terminal.mjs', 'OP_PUSHBYTES_2 0x3a12 OP_SPLIT OP_NIP OP_PUSHBYTES_2 0xe004 OP_SPLIT OP_DROP OP_1', 'OP_PUSHBYTES_2 0x3a12 OP_SPLIT OP_NIP OP_PUSHBYTES_2 0xe004 OP_SPLIT OP_DROP OP_2'),
 ('densless-recovered/terminal.mjs', 'OP_3 OP_INPUTBYTECODE OP_PUSHBYTES_2 0xc301', 'OP_4 OP_INPUTBYTECODE OP_PUSHBYTES_2 0xc301'),
 # genesis.mjs — the exec0 header read
 ('densless-recovered/genesis.mjs', 'OP_0 OP_INPUTBYTECODE OP_3 OP_SPLIT OP_NIP OP_PUSHBYTES_2 0x2801', 'OP_1 OP_INPUTBYTECODE OP_3 OP_SPLIT OP_NIP OP_PUSHBYTES_2 0x2801'),
 # shared.mjs — THE HIDDEN ONE: the assembled program's k-dispatch + input reads
 ('densless-recovered/shared.mjs', 'OP_INPUTINDEX OP_DUP OP_3 OP_LESSTHAN OP_VERIFY', 'OP_INPUTINDEX OP_DUP OP_4 OP_LESSTHAN OP_VERIFY'),
 ('densless-recovered/shared.mjs', 'OP_OVER OP_2 OP_NUMEQUAL OP_IF OP_PUSHBYTES_6 0x400402418800', 'OP_OVER OP_3 OP_NUMEQUAL OP_IF OP_PUSHBYTES_6 0x400402418800'),
 ('densless-recovered/shared.mjs', 'OP_OVER OP_1 OP_NUMEQUAL OP_IF OP_PUSHBYTES_6 0x004208018400', 'OP_OVER OP_2 OP_NUMEQUAL OP_IF OP_PUSHBYTES_6 0x004208018400'),
 ('densless-recovered/shared.mjs', 'OP_4 OP_2 OP_PICK OP_1 OP_NUMEQUAL OP_IF OP_DROP OP_14', 'OP_4 OP_2 OP_PICK OP_2 OP_NUMEQUAL OP_IF OP_DROP OP_14'),
 ('densless-recovered/shared.mjs', 'OP_2 OP_PICK OP_2 OP_NUMEQUAL OP_IF OP_PUSHBYTES_1 0x18', 'OP_2 OP_PICK OP_3 OP_NUMEQUAL OP_IF OP_PUSHBYTES_1 0x18'),
 ('densless-recovered/shared.mjs', 'OP_10 OP_3 OP_PICK OP_1 OP_NUMEQUAL OP_IF OP_DROP OP_10', 'OP_10 OP_3 OP_PICK OP_2 OP_NUMEQUAL OP_IF OP_DROP OP_10'),
 ('densless-recovered/shared.mjs', 'OP_3 OP_PICK OP_2 OP_NUMEQUAL OP_IF OP_DROP OP_11', 'OP_3 OP_PICK OP_3 OP_NUMEQUAL OP_IF OP_DROP OP_11'),
 ('densless-recovered/shared.mjs', 'OP_6 OP_PICK OP_2 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0x2801 OP_3 OP_4 CALL', 'OP_6 OP_PICK OP_3 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0x2801 OP_3 OP_5 CALL'),
 ('densless-recovered/shared.mjs', 'OP_6 OP_PICK OP_1 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0x2801 OP_3 OP_2 CALL', 'OP_6 OP_PICK OP_2 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0x2801 OP_3 OP_3 CALL'),
 ('densless-recovered/shared.mjs', 'OP_0 OP_6 OP_PICK OP_0 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0x2801 OP_3 OP_1 CALL', 'OP_0 OP_6 OP_PICK OP_1 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0x2801 OP_3 OP_2 CALL'),
 ('densless-recovered/shared.mjs', 'OP_4 OP_PICK OP_2 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0xa003 OP_PUSHBYTES_2 0x630d OP_2 CALL', 'OP_4 OP_PICK OP_3 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0xa003 OP_PUSHBYTES_2 0x630d OP_3 CALL'),
 ('densless-recovered/shared.mjs', 'OP_4 OP_PICK OP_1 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0x4003 OP_PUSHBYTES_2 0x0a0e OP_1 CALL', 'OP_4 OP_PICK OP_2 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0x4003 OP_PUSHBYTES_2 0x0a0e OP_2 CALL'),
 ('densless-recovered/shared.mjs', 'OP_0 OP_4 OP_PICK OP_0 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0xa003 OP_PUSHBYTES_2 0x970e OP_0 CALL', 'OP_0 OP_4 OP_PICK OP_1 OP_NUMEQUAL OP_IF OP_PUSHBYTES_2 0xa003 OP_PUSHBYTES_2 0x970e OP_1 CALL'),
 ('densless-recovered/shared.mjs', 'OP_PUSHBYTES_2 0xc001 OP_3 OP_3 CALL readBoundedInputSlice', 'OP_PUSHBYTES_2 0xc001 OP_3 OP_4 CALL readBoundedInputSlice'),
 # the first-executor flag + the adapter-path gate (k==0 -> k==1) — the two
 # sites whose absence broke exec0's GLV tail (SIZE(x)==0 leftover invariant)
 ('densless-recovered/shared.mjs', 'OP_0 OP_PUSHBYTES_1 0x17 OP_PICK OP_0 OP_NUMEQUAL OP_IF OP_DROP OP_1 OP_ENDIF', 'OP_0 OP_PUSHBYTES_1 0x17 OP_PICK OP_1 OP_NUMEQUAL OP_IF OP_DROP OP_1 OP_ENDIF'),
 ('densless-recovered/shared.mjs', 'OP_PUSHBYTES_1 0x17 OP_ROLL OP_0 OP_NUMEQUAL OP_IF OP_PUSHBYTES_1 0x16 OP_PICK OP_4 OP_MOD', 'OP_PUSHBYTES_1 0x17 OP_ROLL OP_1 OP_NUMEQUAL OP_IF OP_PUSHBYTES_1 0x16 OP_PICK OP_4 OP_MOD'),
]
for p, a, b in edits:
    path = f'{B}/{p}'
    s = open(path).read()
    assert s.count(a) == 1, (p, a[:50], s.count(a))
    open(path, 'w').write(s.replace(a, b))
pin = f'{B}/densless-msm/genesis-slice.json'
j = json.load(open(pin))
assert j['sourceGenesisSha256'] == '7f7507ca1940748a14fc99812cb49edefd93ea6f1a5714e92536bd759e6b10a6', j['sourceGenesisSha256'])
j['sourceGenesisSha256'] = '529861d41e32cc59afb6c888bd78c214c6fd63dba85b2296ba53adf9365cdd15'
json.dump(j, open(pin, 'w'), indent=2)
print(f'applied {len(edits)} source edits + slice pin (covenant-at-0 complete)')
PY

cd "$BENCH/densless-msm"
node build.mjs "$OUT"
echo "built -> $OUT (expect redeems 574,574,574,6044,4415)"
