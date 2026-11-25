import { describe, expect, it } from 'vitest'
import { decodeTransaction, hexToBin, instantiateSecp256k1, instantiateSha256, encodeTransactionBCH, generateSigningSerializationBCH, hash256, SigningSerializationTypeBCH } from '@bitauth/libauth'

import { buildRole2Lock, ROLE2_FUEL_SATS } from '@/lib/pool/role2-lock'
import { getPools } from '@/lib/pool/registry'

const POOL = getPools('chipnet').find((pool) => pool.id === 'chipnet-pusd-role2')
const TAG = new Uint8Array(32).fill(0xab)
const KEY = new Uint8Array(32).fill(0x11)
const ADDRESS = 'bchtest:qzzu85xnl99u534d9z40yu7c494hknppx5lu29gl8t'
const CATEGORY = hexToBin(POOL.assetCategory)

const funding = { txid: '11'.repeat(32), vout: 0, sats: 50000n }
const blank = (n) => ({ txid: String(n).repeat(64).slice(0, 64), vout: n, sats: 1000n, token: { category: POOL.assetCategory, amount: '0', nft: { capability: 'mutable', commitment: '' } } })
const supply = { txid: '22'.repeat(32), vout: 0, sats: 1000n, token: { category: POOL.assetCategory, amount: '5000000' } }

describe('lib/pool/role2-lock', () => {
    it('builds 2 tagged fuel UTXOs + change; a transfer has no FT deposit', async () => {
        const lock = await buildRole2Lock({
            pool: POOL, tag: TAG, fundingUtxo: funding, blanks: [blank(1), blank(2)], changeAddress: ADDRESS, privateKey: KEY,
        })
        const decoded = decodeTransaction(hexToBin(lock.hex))
        expect(typeof decoded).not.toBe('string')
        expect(decoded.outputs).toHaveLength(3)
        expect(decoded.outputs[0].valueSatoshis).toBe(ROLE2_FUEL_SATS)
        expect(decoded.outputs[1].valueSatoshis).toBe(ROLE2_FUEL_SATS)
        expect(decoded.outputs[0].token.category).toEqual(CATEGORY)
        expect(decoded.outputs[0].token.amount).toBe(0n)
        expect(decoded.outputs[0].token.nft.commitment).toEqual(TAG)
        expect(decoded.outputs[1].token.nft.commitment).toEqual(TAG)
        expect(lock.fuelOutpoints[0].tag).toBe('ab'.repeat(32))
    })

    it('puts the shield FT deposit on out0 and returns the FT change', async () => {
        const lock = await buildRole2Lock({
            pool: POOL, tag: TAG, shield: 1000000n, fundingUtxo: funding, blanks: [blank(3), blank(4)], supplyUtxo: supply, changeAddress: ADDRESS, privateKey: KEY,
        })
        const decoded = decodeTransaction(hexToBin(lock.hex))
        expect(decoded.outputs[0].token.amount).toBe(1000000n)
        expect(decoded.outputs[1].token.amount).toBe(0n)
        expect(decoded.outputs[3].token.amount).toBe(4000000n)
        expect(lock.deposit).toBe(1000000n)
    })

    it('signs every input with a valid Schnorr signature (allOutputs)', async () => {
        const lock = await buildRole2Lock({
            pool: POOL, tag: TAG, fundingUtxo: funding, blanks: [blank(5), blank(6)], changeAddress: ADDRESS, privateKey: KEY,
        })
        const sha256 = await instantiateSha256()
        const secp = await instantiateSecp256k1()
        const decoded = decodeTransaction(hexToBin(lock.hex))
        const pub = secp.derivePublicKeyCompressed(KEY)
        const sources = [
            { lockingBytecode: decoded.outputs[2].lockingBytecode, valueSatoshis: 50000n },
            ...decoded.inputs.slice(1).map(() => ({ lockingBytecode: decoded.outputs[2].lockingBytecode, valueSatoshis: 1000n, token: { category: CATEGORY, amount: 0n, nft: { capability: 'mutable', commitment: new Uint8Array(0) } } })),
        ]
        for (let i = 0; i < decoded.inputs.length; i += 1) {
            const serialization = generateSigningSerializationBCH(
                { inputIndex: i, sourceOutputs: sources, transaction: decoded },
                { coveredBytecode: decoded.outputs[2].lockingBytecode, signingSerializationType: Uint8Array.of(SigningSerializationTypeBCH.allOutputs) },
                sha256,
            )
            const digest = hash256(serialization, sha256)
            const signature = decoded.inputs[i].unlockingBytecode.slice(1, 66)
            expect(secp.verifySignatureSchnorr(signature.slice(0, 64), pub, digest)).toBe(true)
        }
    })

    it('rejects bad input shapes', async () => {
        await expect(buildRole2Lock({ pool: POOL, tag: TAG, fundingUtxo: funding, blanks: [blank(7)], changeAddress: ADDRESS, privateKey: KEY })).rejects.toThrow('TWO blanks')
        await expect(buildRole2Lock({ pool: POOL, tag: new Uint8Array(31), fundingUtxo: funding, blanks: [blank(8), blank(9)], changeAddress: ADDRESS, privateKey: KEY })).rejects.toThrow('32-byte')
        await expect(buildRole2Lock({ pool: POOL, tag: TAG, shield: 1000000n, fundingUtxo: funding, blanks: [blank(10), blank(11)], changeAddress: ADDRESS, privateKey: KEY })).rejects.toThrow('supply FT')
        await expect(buildRole2Lock({ pool: POOL, tag: TAG, fundingUtxo: { txid: '33'.repeat(32), vout: 0, sats: 100n }, blanks: [blank(12), blank(13)], changeAddress: ADDRESS, privateKey: KEY })).rejects.toThrow('short')
    })
})
