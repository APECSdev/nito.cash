/* Unit tests for the ChainGraph client (lib/cashaccount/chaingraph.js).
 *
 * The network is mocked at globalThis.fetch; the fixture shapes match the
 * live public instance (bytea values arrive as `\x…` strings, bigints as
 * decimal strings, block_inclusions carry transaction_index).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    byteaLiteral,
    byteaVariable,
    getBlockByHeight,
    getCategoryOutputs,
    getTip,
    getTransaction,
    graphql,
    loadAllRegistrations,
    normalizeTransaction,
    searchRegistrations,
} from '@/lib/cashaccount/chaingraph.js'
import { KALLISTI_CATEGORY, KALLISTI_TX } from '../fixtures/cashaccount-kallisti.js'

const jsonResponse = (payload, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
})

const rowFromFixture = () => ({
    hash: `\\x${KALLISTI_TX.hash}`,
    internal_id: '123',
    block_inclusions: [{
        transaction_index: String(KALLISTI_TX.block.transactionIndex),
        block: { height: String(KALLISTI_TX.block.height), hash: `\\x${KALLISTI_TX.block.hash}` },
    }],
    inputs: KALLISTI_TX.inputs.map((input) => ({
        input_index: String(input.index),
        outpoint_transaction_hash: `\\x${input.outpointTransactionHash}`,
        outpoint_index: String(input.outpointIndex),
    })),
    outputs: KALLISTI_TX.outputs.map((output) => ({
        output_index: String(output.index),
        value_satoshis: String(output.valueSatoshis),
        locking_bytecode_hex: output.lockingBytecodeHex,
        token_category: output.tokenCategory ? `\\x${output.tokenCategory}` : null,
        fungible_token_amount: output.fungibleAmount,
        nonfungible_token_capability: output.nftCapability,
        nonfungible_token_commitment: output.nftCommitment ? `\\x${output.nftCommitment}` : null,
    })),
})

beforeEach(() => {
    vi.restoreAllMocks()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('cashaccount/chaingraph — bytea helpers', () => {
    it('uses two backslashes for inline literals and one for variables', () => {
        expect(byteaLiteral('abcd')).toBe('\\\\xabcd')
        expect(byteaVariable('abcd')).toBe('\\xabcd')
        expect(byteaLiteral('\\xABCD')).toBe('\\\\xabcd')
    })
})

describe('cashaccount/chaingraph — graphql()', () => {
    it('POSTs the query and returns data', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ data: { block: [{ height: '1' }] } }))
        vi.stubGlobal('fetch', fetchMock)

        const data = await graphql('{ block { height } }', { limit: 1 })

        expect(data).toEqual({ block: [{ height: '1' }] })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, options] = fetchMock.mock.calls[0]
        expect(url).toContain('gql.chaingraph.pat.mn')
        expect(JSON.parse(options.body)).toEqual({ query: '{ block { height } }', variables: { limit: 1 } })
    })

    it('throws on HTTP errors and GraphQL errors', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, false, 500)))
        await expect(graphql('{ x }')).rejects.toThrow(/HTTP 500/)

        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ errors: [{ message: 'bad field' }] })))
        await expect(graphql('{ x }')).rejects.toThrow(/bad field/)
    })
})

describe('cashaccount/chaingraph — normalizeTransaction()', () => {
    it('normalizes bytea/bigint strings and sorts by index', () => {
        const normalized = normalizeTransaction(rowFromFixture())

        expect(normalized.hash).toBe(KALLISTI_TX.hash)
        expect(normalized.block).toEqual(KALLISTI_TX.block)
        expect(normalized.inputs[0]).toEqual(KALLISTI_TX.inputs[0])
        expect(normalized.outputs[0].tokenCategory).toBe(KALLISTI_CATEGORY)
        expect(normalized.outputs[0].nftCapability).toBe('mutable')
        expect(normalized.outputs[0].nftCommitment).toBe(KALLISTI_TX.outputs[0].nftCommitment)
        expect(normalized.outputs[1].valueSatoshis).toBe(0)
    })

    it('takes the highest block inclusion and handles a missing block', () => {
        const row = rowFromFixture()
        row.block_inclusions = [
            { transaction_index: '2', block: { height: '100', hash: `\\x${'11'.repeat(32)}` } },
            { transaction_index: '1', block: { height: '101', hash: `\\x${'22'.repeat(32)}` } },
        ]

        expect(normalizeTransaction(row).block).toEqual({
            height: 101,
            hash: '22'.repeat(32),
            transactionIndex: 1,
        })

        row.block_inclusions = []
        expect(normalizeTransaction(row).block).toBeNull()
    })
})

describe('cashaccount/chaingraph — queries', () => {
    it('searchRegistrations returns the normalized transactions', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            data: { search_output_prefix: [{ transaction_hash: '\\xaa', output_index: '1', transaction: rowFromFixture() }] },
        })))

        const registrations = await searchRegistrations({ limit: 10 })

        expect(registrations).toHaveLength(1)
        expect(registrations[0].hash).toBe(KALLISTI_TX.hash)
    })

    it('getTransaction returns null when no row matches', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { transaction: [] } })))
        expect(await getTransaction('aa')).toBeNull()
    })

    it('getTransaction returns a normalized transaction', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { transaction: [rowFromFixture()] } })))
        expect((await getTransaction(KALLISTI_TX.hash)).hash).toBe(KALLISTI_TX.hash)
    })

    it('getCategoryOutputs maps the NFT output + spent_by', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            data: {
                output: [{
                    output_index: '0',
                    transaction_hash: `\\x${KALLISTI_TX.hash}`,
                    value_satoshis: '1389',
                    locking_bytecode_hex: KALLISTI_TX.outputs[0].lockingBytecodeHex,
                    token_category: `\\x${KALLISTI_CATEGORY}`,
                    fungible_token_amount: '0',
                    nonfungible_token_capability: 'mutable',
                    nonfungible_token_commitment: `\\x${KALLISTI_TX.outputs[0].nftCommitment}`,
                    spent_by: [{ input_index: '0', transaction: rowFromFixture() }],
                    transaction: rowFromFixture(),
                }],
            },
        })))

        const outputs = await getCategoryOutputs(KALLISTI_CATEGORY)

        expect(outputs).toHaveLength(1)
        expect(outputs[0].outputIndex).toBe(0)
        expect(outputs[0].nftCapability).toBe('mutable')
        expect(outputs[0].spentBy[0].transaction.hash).toBe(KALLISTI_TX.hash)
    })

    it('getTip and getBlockByHeight normalize the block rows', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ data: { block: [{ height: '978710', hash: `\\x${'33'.repeat(32)}` }] } })))

        expect(await getTip()).toEqual({ height: 978710, hash: '33'.repeat(32) })
        expect(await getBlockByHeight(978710)).toEqual({ height: 978710, hash: '33'.repeat(32) })
    })

    it('loadAllRegistrations follows pagination until a short page', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ data: { search_output_prefix: [{ transaction: rowFromFixture() }, { transaction: rowFromFixture() }] } }))
            .mockResolvedValueOnce(jsonResponse({ data: { search_output_prefix: [] } }))
        vi.stubGlobal('fetch', fetchMock)

        const registrations = await loadAllRegistrations({ pageSize: 2 })

        expect(registrations).toHaveLength(2)
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})
