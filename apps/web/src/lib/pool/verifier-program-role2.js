// src/lib/pool/verifier-program-role2.js
//
// The role-2 tagged pool — the deployed program/guard/vending descriptor.
//
// This is the PROGRAM-LEVEL descriptor the wallet uses to recognise the pool
// and its two sibling covenants (the minting guard and the blank vending
// machine). The 3-input role-2 WITNESS GENERATOR is the separate rewrite
// (lib/pool/verifier.js) and requires the Hush proving assets; until they are
// handed over, the registry entry stays walletProverCompatible: false.
//
// Facts from the handoff (POOL-HANDOFF-2026-11-24-NITO-ROLE2-TAGGED.md §2,
// §4.1, §5) — every value is a live on-chain artifact.
//
// CORRECTION (role2-proving-assets-v1 HANDOVER §4): the earlier `codePin`
// d71851a1… is the hooked program's code hash for the CANONICAL SWEEP category
// 2469acc5… — a source-drift pin, NOT the deployed code identity. The deployed
// category 480e30ff… produces code hash f12f9094… (7,834 B), which is what the
// on-chain R redeem commits to.

export const ROLE2_PROGRAM = {
    id: 'role2-tagged',
    lockingBytecode: 'aa203e40b64cff154d4b3305e8c8cc4e3174bc595ad74342a8445a9a7798b7be3a2987',
    programBytes: 7834,
    codePin: 'f12f90947e09a635f98a2938fedac58b7548c36edead44aecc38564967bce116',
    sweepCodePin: 'd71851a1ce6d795c0aa40ab055faac1000755d474313f16e6cd34855ffbfff41',
    txInputCount: 3,
    carrierBytes: 169,
    vkSha256: '05250429214cd82eac6540459a564c223c2b3f985122fbe5369b2eac7546bd19',
    zkeySha256: '4a4e2543dbe640de7a59e23cc652b89a50034898757efff22242eafec0f7b7c0',
    wasmSha256: '8595b43409370c83f371e16408cde85d88382f6fa66f406404071fb38efa7a48',
    hookChecks: '1–11 + 4c/4g (deposit tags)',
}

/* The 3-out v3 demo pool (chipnet, 2026-11-26). Same reviewed program
   generation under the NEW 3-out VK (d4ed12ee…); 201-B carrier; 9-field
   actionHash. The live UNSHIELD ec31a41c… is the byte-exact oracle. */
export const ROLE2_PROGRAM_3OUT = {
    id: 'role2-3out',
    lockingBytecode: 'aa204a6ce339fb62b7b2ebb502c9bf642d3221620e6f5ded619ce8a39110e35182ea87',
    programBytes: 7848,
    codePin: '73cb0ccb01791d37bea2289fc809211296685896ed8ca16ea260a666ede67971',
    txInputCount: 3,
    outputs: 3,
    carrierBytes: 201,
    vkSha256: 'd4ed12eefea550d20fb17b34303fa1446af204b182d58c4807f36944f0d04861',
    zkeySha256: 'b0177dbe5bb1bf7e9122a00953a2facd3d05b0405fee6c1a59d0da55cfb81659',
    wasmSha256: 'c806e561d9466ec25f437d6dfe659ce97e73a3f65359449bcc35deb9c81910fb',
    hookChecks: '1–11 + 4c/4g + the 201-B carrier / 9-field actionHash',
}

export const ROLE2_GUARD = {
    lockingBytecode: 'aa2066a238ad4109a3093c34fd4cf9b4167b0058375d4ad1c5cc44cd253d3664f0c187',
    redeemBytes: 5103,
    batchSize: 64,
}

export const ROLE2_GUARD_3OUT = {
    lockingBytecode: 'aa20e33ce1810617ea549e24b7aa66c9291c9e9b79aa8dc006501d8a2b2b2990dce887',
    redeemBytes: 5103,
    batchSize: 64,
}

export const ROLE2_VENDING = {
    lockingBytecode: 'aa206b51396304b3bd4e0e9c254f84d1ee80d83a5c7ccaf3750883d00866480d981287',
    redeemBytes: 157,
    priceSats: 1000,
}

/* The v3 (pool4) chipnet pool (deployed 2026-11-27T05:38Z, the LIVE build —
   NOT the aborted v3.0 attempt 03af2eda…). Both drains closed at consensus:
   the append proof (R3: newMerkleRoot circuit-constrained) + the nullifier
   SMT (R2: walkA's 0-walk rejects replays; nf0≠nf1 in-circuit) + the DEPOSIT
   path (the empty genesis tree, no bootstrap seeds). The 5-input shape (the
   graph pins NROLES+2): fuel0/fuel1/state + the two walk-data UTXOs at the
   P2SH32 walk wraps (v3.1 — the raw scripts are relay-nonstandard, "code 64";
   the scripts ride the action unlockings as the redeem push; the hook 4w /
   graph pins hash the WRAPS). The program hash is VK-BOUND: the MPC cascade
   (pool4_0001_nito.zkey + the Hush contribution + the tail) rebuilds it with
   the final vk.ic[0] — the walk scripts + every spec are unchanged. */
export const ROLE2_PROGRAM_V3 = {
    id: 'role2-v3',
    lockingBytecode: 'aa206dc915cef6f1343b7d170caaf79346072222d66fd3285fcb4d506f184069e8cb87',
    programBytes: 7998,
    codePin: '27b904a2ddec9e6b4ad5a261084be6ed18e59420e5e41e9400f72586bda88510',
    codePieces: [4111, 3887],
    txInputCount: 5,
    outputs: 3,
    carrierBytes: 201,
    /* the walk UTXOs' ON-CHAIN lockings (the P2SH32 wraps) + the deployed pins
       (sha256 of each wrap — the v3.1 form; the client reproduces the raw
       278/291-B scripts from the category, byte-exact per the spec) */
    walkLockings: [
        'aa20f823d16d3cab573069ba562afb2bfb9a5bcb72bdae85218132e1e12e6bfeaded87',
        'aa206ae3e5fb435b33afd6e907c9beae8e139a3ea85c90d57f026e99fc4bdbb31a0687',
    ],
    walkPins: [
        '9f0a1a9827c5c9889a888a71d8ac8ebc35e8819f8f097fb72a69cd64dab507f8',
        '338f4d86798584041cb87801f3b15ccdd656a1be8313bdd29c3d5b69e26ffd6f',
    ],
    walkSats: 2000,
    fuelSats: 23000,
    /* the CHIPNET-ONLY 1-of-1 trio (published entropy — the testnet norm) —
       superseded by the POST-MPC trio at the M2 release (a B4 data edit) */
    vkSha256: '07638f101038418d7b97ba46871476edaf3f6c63086fa9e984a2aa33e530b704',
    zkeySha256: '942f8fc5327191da4a98bfbd81b74f87bd6f79267efb2d3067ac6cd0175a723a',
    wasmSha256: 'a9b4b03d17c614ba920c45df5c34949e26ce8cdbdeb3d6b145476a2857289395',
    hookChecks: '1–11 + 4w (the walk-locking pins); the fold check 7 GONE — the SMT replaces it; check 10 splits the 64-B commitment',
}

/* ── THE V4H (the C architecture — the MAINNET Preview v0 pool) ─────────────
 * The "no-issuer" fix: the pool keeps its OWN fresh valueless category (the
 * state NFT + the blanks — our key, no third party) and the ASSET (a category
 * we do NOT own — real ParyonUSD 2469acc5…) rides the H-covenant holdings
 * pair (in5/in6). The 96-B state commitment [noteRoot ‖ nullSetRoot ‖
 * balance32] carries the AUTHENTICATED balance chain; the check-6 category
 * field binds the ASSET (the Hush fix after the Nito review caught the live
 * bug). The program is per-category (the deployed mainnet build of record —
 * role2-pool4-state.mainnet-v4h.json, h 979,219) and VK-BOUND to the
 * THREE-CONTRIBUTION post-MPC chain (Nito → Hush → user). */
export const ROLE2_PROGRAM_V4H = {
    id: 'role2-v4h',
    lockingBytecode: 'aa2006d764d4a149900fe8cbe2a0b01753643b21bda74b0fc76018172bfc098dc3c987',
    programBytes: 8078,
    codePin: '4f096247c5b56ab682119cb4446289598b48d374bb30d10e9ad43ee23dab4493',
    codePieces: [4151, 3927],
    txInputCount: 7,
    outputs: 3,
    carrierBytes: 201,
    progLockingHash: '90f104a34677e1abf90a2e1ad6eddaeece258f6d647b41c94ee563fa0e4946cb',
    /* the commit96 walks (282/295 B) + the wraps + the pins (sha256 of each wrap). */
    walkLockings: [
        'aa20cf645a0a3d532c3ea8c485a349e2550bde67725dc8cc3ef3cbbb9a67bec3fc6587',
        'aa2045a64214753dac303d84bb9e55cff327d1d9b2bc1d1e820822ca02fac955b09687',
    ],
    walkPins: [
        '1255489f8168c4110094b0701617278133aa31f43ae4cb341f2f7bdb0f21a002',
        'b476695026823fb3466d543ec61bf468fbe434a9c1c861233f3ca2ff09ad8312',
    ],
    walkSats: 2000,
    fuelSats: 23000,
    holdingsSats: 1000,
    /* the H covenant (211-B script; inputs 5/6 pinned to each other by
       byte-compare — the theft-guard shape pin: H pins the program by hash,
       the program never pins H — no circular hash). */
    hLockingHex: 'aa2006fa0f9ebadd88eaac1b8801c69329c6c3e6d9209bced65ed01340a6e4e19b2087',
    hScriptBytes: 211,
    /* THE POST-MPC THREE-CONTRIBUTION TRIO (Nito → Hush → user; the mainnet
       pool's VK): zkey pool4_0003_user.zkey, VK verification_key_user3.json.
       The wasm NEVER changes (a phase-2 MPC never touches the circuit). These
       are the M2 release targets — the Worker's /assets pool4 pins re-point
       at M2 (the current pins serve the CHIPNET trio). */
    vkSha256: 'f6b49cc06c474fd25fe749d5b1cf42947696fe0bfa6eecec2b4c25a1c08b9148',
    zkeySha256: 'de7875e33fa1625daad812fbeddc82901aef0e6adedd11dbf58c53bfad3844cc',
    wasmSha256: 'a9b4b03d17c614ba920c45df5c34949e26ce8cdbdeb3d6b145476a2857289395',
    fixturesSha256: 'e74555dd84811e84c9c18c9a5f71bba0d2742957803d9f2a6e6878f1fb45c9a6',
    hookChecks: '1–11 + 4w (the walk pins) + the holdings checks (5/9/9h: the 96-B balance chain + out2) + the check-6 ASSET category; the fold check 7 GONE',
}

/* The mainnet pool's minting guard (born-guarded at the deploy, batch
   48994625…: 16 blanks minted + confirmed — pool-agnostic shape,
   category-pinned). */
export const ROLE2_GUARD_V4H = {
    lockingBytecode: 'aa20cdbef76ccc03f58dd62ad31f6ca0e233935f8533ea88d43fc0398979f56ec18087',
    redeemBytes: 1359,
    batchSize: 16,
}

/* The v3 pool's minting guard (born-guarded at the deploy, batch a98ee616…:
   64 blanks minted + confirmed — pool-agnostic shape, category-pinned). */
export const ROLE2_GUARD_V3 = {
    lockingBytecode: 'aa20401034041652ad938c67c8636c9a8c62ba5691936a21abebd507f6d7424f01c487',
    redeemBytes: 5103,
    batchSize: 64,
}
