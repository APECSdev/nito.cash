# MPC-NITO-CONTRIBUTION-2026-11-27 — the Nito side's phase-2 contribution: DONE

**To: the Hush Your Money team. From: the Nito Cash side.** Per your review's
§5 (the window is open, contribute first as agreed): **our contribution is
DONE — `build4/pool4_0001_nito.zkey` is on the VM, ready for yours.**

- **Command** (your recipe, verbatim):
  `cd ~/zkb/pusd-shielded-pool && snarkjs zkey contribute build4/pool4_0000.zkey build4/pool4_0001_nito.zkey`
  (snarkjs 0.7.6 via `node node_modules/snarkjs/cli.js`).
- **Entropy: UNPUBLISHED** — generated from `/dev/urandom` and piped through
  the encrypted ssh channel straight into snarkjs's stdin; never a file on
  either side, never in any repo/doc/commit/message. Per the agreed hygiene,
  the only artifacts are the printed hashes and the output zkey.
- **Circuit Hash** (the pool4 circuit identity, as printed):
  `69622946 620445cf 135a9b12 cdc8dece dacffbe5 55efb846 7ab3bdcf 075a53ab
   9dc0d6f3 f9009298 6224796a 30fcdc4e 66a54fd3 95c0af2a 82341d11 32b2eff9`
- **Contribution Hash** (ours — the record):
  `ba66883d 462a461c 87edf9ba 0494c3bb ee3e84a6 adfd57bf 4ff45c4d e93d1e19
   b91630e7 7cfe12c2 afe282c9 5347482d 497ae329 3ca9a691 c229bb5b 3b2d10e8`
- **Output**: `build4/pool4_0001_nito.zkey` — 120,818,020 B,
  sha256 `ef4b1ec9a447c8335c3a28f8a7e4fa32c298851830bd96140c77eccb57abc966`
  (the file + this hash are public coordination data; the entropy is not).

**Yours next**: contribute onto `pool4_0001_nito.zkey` (same hygiene), then
`zkey verify` → the VK export → the hash record → the cascade (re-prove the 5
fixtures, program rebuild, 29/29 + red team + sweep) → the M2 release
(`pool4_final.zkey` / `pool4.wasm` / `verification_key_v3.json` under
`role2-proving-assets-v3-v1`) → the B4 data edit on our side (the pin table is
ready; the VK chain in our vendored build is LIVE — the fixtures swap is the
only change at the cascade, and the post-MPC program reproduces byte-exactly
through the same chain).

The user-side third contribution: the user decides whether to take the slot;
you coordinate the ordering tail when your hash is recorded.

— the Nito Cash side, 2026-11-27 (01:29 UTC).
