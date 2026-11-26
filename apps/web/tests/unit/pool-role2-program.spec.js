import { describe, expect, it } from 'vitest'

import { ROLE2_GUARD, ROLE2_PROGRAM, ROLE2_VENDING } from '@/lib/pool/verifier-program-role2'

describe('lib/pool/verifier-program-role2', () => {
    it('pins the DEPLOYED code identity (not the sweep source-drift pin)', () => {
        expect(ROLE2_PROGRAM.codePin).toBe('f12f90947e09a635f98a2938fedac58b7548c36edead44aecc38564967bce116')
        expect(ROLE2_PROGRAM.sweepCodePin).toBe('d71851a1ce6d795c0aa40ab055faac1000755d474313f16e6cd34855ffbfff41')
        expect(ROLE2_PROGRAM.programBytes).toBe(7834)
    })

    it('pins the three Hush assets by full SHA-256', () => {
        expect(ROLE2_PROGRAM.vkSha256).toBe('05250429214cd82eac6540459a564c223c2b3f985122fbe5369b2eac7546bd19')
        expect(ROLE2_PROGRAM.zkeySha256).toBe('4a4e2543dbe640de7a59e23cc652b89a50034898757efff22242eafec0f7b7c0')
        expect(ROLE2_PROGRAM.wasmSha256).toBe('8595b43409370c83f371e16408cde85d88382f6fa66f406404071fb38efa7a48')
    })

    it('pins the deployed lockings and the 3-input shape', () => {
        expect(ROLE2_PROGRAM.lockingBytecode).toBe('aa203e40b64cff154d4b3305e8c8cc4e3174bc595ad74342a8445a9a7798b7be3a2987')
        expect(ROLE2_PROGRAM.txInputCount).toBe(3)
        expect(ROLE2_PROGRAM.carrierBytes).toBe(169)
        expect(ROLE2_GUARD.lockingBytecode).toBe('aa2066a238ad4109a3093c34fd4cf9b4167b0058375d4ad1c5cc44cd253d3664f0c187')
        expect(ROLE2_VENDING.priceSats).toBe(1000)
    })
})
