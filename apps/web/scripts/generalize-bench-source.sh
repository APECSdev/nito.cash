#!/usr/bin/env bash
# apps/web/scripts/generalize-bench-source.sh
#
# Apply the covenant-at-input-0 generalization to the BENCH GENERATOR SOURCE
# (not to compiled bytecode), rebuild the program, then restore the bench.
#
# Every input index lives in the generator source, so the shift is done there:
#
#   build.mjs        stage()  OP_3 -> OP_4   (helper definitions now live in
#                                            the genesis input, which is 4)
#                    sourceA pinEnd.idx 0 -> 1   (pins exec0's state push)
#                    sliceGenesis carrier offset 3 -> 4
#   vkx-stages.mjs   executors move to inputs 1,2,3 with next = 2,3,5
#                    sourceFinal genIdx 3 -> 4
#   terminal.mjs     self-index OP_4 -> OP_5; UTXO checks 0,1,2,3 -> 1,2,3,4
#   loader.mjs       fragment reads OP_0,OP_1,OP_2 -> OP_1,OP_2,OP_3
#
# Usage (on the build host):
#   VERIFIER_DIR=~/zkb/zk-verifier-bench bash generalize-bench-source.sh <out.json>
#
# NOTE: the program is VK-SPECIFIC (vkx-msm.mjs:30 bakes FINAL = vk.ic[0] -
# [2^64]G), so pairing-vectors.json must hold YOUR verifying key first.
set -euo pipefail
OUT="${1:-/tmp/bench-generalized.json}"
BENCH="${BENCH:-$HOME/zkb/groth16_cashscript/chunked/bn254}"
export VERIFIER_DIR="${VERIFIER_DIR:?set VERIFIER_DIR to the zk-verifier-bench checkout}"

for f in densless-msm/build.mjs densless-msm/vkx-stages.mjs \
         densless-recovered/terminal.mjs densless-recovered/loader.mjs \
         "$VERIFIER_DIR/src/checkpoints/pairing-vectors.json"; do
  cp "$BENCH/$f" "/tmp/$(basename "$f").genbak" 2>/dev/null || cp "$f" "/tmp/$(basename "$f").genbak"
done
restore() {
  cp /tmp/build.mjs.genbak "$BENCH/densless-msm/build.mjs"
  cp /tmp/vkx-stages.mjs.genbak "$BENCH/densless-msm/vkx-stages.mjs"
  cp /tmp/terminal.mjs.genbak "$BENCH/densless-recovered/terminal.mjs"
  cp /tmp/loader.mjs.genbak "$BENCH/densless-recovered/loader.mjs"
  cp /tmp/pairing-vectors.json.genbak "$VERIFIER_DIR/src/checkpoints/pairing-vectors.json"
}
trap restore EXIT

python3 - "$BENCH" <<'PY'
import sys
B = sys.argv[1]
edits = [
 ('densless-msm/build.mjs',
  'OP_3 OP_INPUTBYTECODE OP_SIZE NUM BACK OP_SUB OP_SPLIT OP_NIP NUM LENGTH OP_SPLIT OP_DROP',
  'OP_4 OP_INPUTBYTECODE OP_SIZE NUM BACK OP_SUB OP_SPLIT OP_NIP NUM LENGTH OP_SPLIT OP_DROP'),
 ('densless-msm/build.mjs',
  'pinEnd: {idx: 0, back: backExec, size: STATE_BYTES}',
  'pinEnd: {idx: 1, back: backExec, size: STATE_BYTES}'),
 ('densless-msm/vkx-stages.mjs',
  'int next = 1; int back = ${backExec};',
  'int next = 2; int back = ${backExec};'),
 ('densless-msm/vkx-stages.mjs',
  'if (k == 1) { from = ${cuts[1]}; to = ${cuts[2]}; next = 2; }',
  'if (k == 2) { from = ${cuts[1]}; to = ${cuts[2]}; next = 3; }'),
 ('densless-msm/vkx-stages.mjs',
  'if (k == 2) { from = ${cuts[2]}; to = ${cuts[3]}; next = 4; back = ${backTerminal}; }',
  'if (k == 3) { from = ${cuts[2]}; to = ${cuts[3]}; next = 5; back = ${backTerminal}; }'),
 ('densless-msm/vkx-stages.mjs',
  'export const sourceFinal = ({ from, genIdx = 3 })',
  'export const sourceFinal = ({ from, genIdx = 4 })'),
 ('densless-recovered/terminal.mjs',
  'OP_INPUTINDEX OP_4 OP_EQUALVERIFY OP_0 OP_UTXOBYTECODE OP_HASH256 OP_1\n    OP_UTXOBYTECODE OP_HASH256 OP_2 OP_UTXOBYTECODE OP_HASH256 OP_3 OP_UTXOBYTECODE OP_HASH256 OP_CAT OP_CAT',
  'OP_INPUTINDEX OP_5 OP_EQUALVERIFY OP_1 OP_UTXOBYTECODE OP_HASH256 OP_2\n    OP_UTXOBYTECODE OP_HASH256 OP_3 OP_UTXOBYTECODE OP_HASH256 OP_4 OP_UTXOBYTECODE OP_HASH256 OP_CAT OP_CAT'),
 ('densless-recovered/loader.mjs',
  '  NUM FRAGMENT_0_BYTES OP_0 CALL fragmentReader\n  NUM FRAGMENT_1_BYTES OP_1 CALL fragmentReader\n  NUM FRAGMENT_2_BYTES OP_2 CALL fragmentReader',
  '  NUM FRAGMENT_0_BYTES OP_1 CALL fragmentReader\n  NUM FRAGMENT_1_BYTES OP_2 CALL fragmentReader\n  NUM FRAGMENT_2_BYTES OP_3 CALL fragmentReader'),
]
for p, a, b in edits:
    path = f'{B}/{p}'
    s = open(path).read()
    assert s.count(a) == 1, (p, a[:50], s.count(a))
    open(path, 'w').write(s.replace(a, b))
print(f'applied {len(edits)} source edits')
PY

cd "$BENCH/densless-msm"
node build.mjs "$OUT"
echo "built -> $OUT"
