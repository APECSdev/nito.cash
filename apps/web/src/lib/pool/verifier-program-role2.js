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

export const ROLE2_PROGRAM = {
    id: 'role2-tagged',
    lockingBytecode: 'aa203e40b64cff154d4b3305e8c8cc4e3174bc595ad74342a8445a9a7798b7be3a2987',
    programBytes: 7834,
    codePin: 'd71851a1ce6d795c0aa40ab055faac1000755d474313f16e6cd34855ffbfff41',
    txInputCount: 3,
    carrierBytes: 169,
    vkSha256: '05250429…',
    zkeySha256: '4a4e2543dbe640de7a59e23cc652b89a50034898757efff22242eafec0f7b7c0',
    wasmSha256: '8595b434…',
    hookChecks: '1–11 + 4c/4g (deposit tags)',
}

export const ROLE2_GUARD = {
    lockingBytecode: 'aa2066a238ad4109a3093c34fd4cf9b4167b0058375d4ad1c5cc44cd253d3664f0c187',
    redeemBytes: 5103,
    batchSize: 64,
}

export const ROLE2_VENDING = {
    lockingBytecode: 'aa206b51396304b3bd4e0e9c254f84d1ee80d83a5c7ccaf3750883d00866480d981287',
    redeemBytes: 157,
    priceSats: 1000,
}
