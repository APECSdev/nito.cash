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
