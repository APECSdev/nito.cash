// apps/web/src/lib/cashaccount/chaingraph.js
//
// ChainGraph (Bitauth's BCH GraphQL indexer) client for CashAccounts v2.
//
// Verified live 2026-11-23 against the public mainnet instance:
//   - search_output_prefix(args:{locking_bytecode_prefix_hex:"6a0401010102"})
//     returns the real registrations (e.g. 8267bff0… = "Kallisti",
//     block 978459, transaction_index 41).
//   - output(token_category) exposes the NFT commitment/capability and
//     `spent_by`, so the Identity NFT chain is followable.
//   - transaction.block_inclusions carries the block height/hash and the
//     transaction index (the spec's ordering tiebreaker).
//
// The endpoint reflects the browser Origin (CORS verified) so the SPA can
// query it directly. It indexes MAINNET. The chain's explorer host
// (chaingraph.cash/graphql) answers 402 DEPLOYMENT_DISABLED; the working
// public GraphQL host is gql.chaingraph.pat.mn.
//
// What it is NOT: a CashCode recovery server. CashCode filters by the
// double-SHA256 prefix of each input's outpoint+scriptsig; ChainGraph stores
// the unlocking bytecode but no such hash, and GraphQL cannot hash
// server-side. Identity resolution (this module) and CashCode payment
// discovery are separate infrastructure.

import { normalizeHex } from './identifier.js'
import { REGISTRATION_PREFIX } from './profile.js'

export const CHAINGRAPH_URL = 'https://gql.chaingraph.pat.mn/v1/graphql'

/**
 * A GraphQL/Postgres bytea literal. The JS string carries TWO backslashes
 * before the `x`; JSON.stringify doubles them for the wire, the server's
 * JSON parse restores two, and the GraphQL parser reduces `\\` to one.
 *
 * @param {string} hex
 * @returns {string}
 */
export function byteaLiteral(hex) {
    return `\\\\x${normalizeHex(hex)}`
}

/**
 * A bytea value for a GraphQL VARIABLE. The scalar receives the JSON-decoded
 * string directly, so it needs ONE backslash (the inline literal above needs
 * two for the GraphQL parser to reduce them).
 *
 * @param {string} hex
 * @returns {string}
 */
export function byteaVariable(hex) {
    return `\\x${normalizeHex(hex)}`
}

/**
 * Execute a GraphQL query.
 *
 * @param {string} query
 * @param {object} [variables]
 * @returns {Promise<object>}
 */
export async function graphql(query, variables = {}) {
    const response = await fetch(CHAINGRAPH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
    })

    if (!response.ok) {
        throw new Error(`ChainGraph HTTP ${response.status}: ${await response.text()}`)
    }

    const payload = await response.json()

    if (payload.errors && payload.errors.length > 0) {
        throw new Error(`ChainGraph: ${payload.errors.map((error) => error.message).join('; ')}`)
    }

    return payload.data
}

/* The transaction selection shared by every query. */
const TRANSACTION_FIELDS = `
    hash
    internal_id
    block_inclusions {
        transaction_index
        block { height hash }
    }
    inputs {
        input_index
        outpoint_transaction_hash
        outpoint_index
    }
    outputs {
        output_index
        value_satoshis
        locking_bytecode_hex
        token_category
        fungible_token_amount
        nonfungible_token_capability
        nonfungible_token_commitment
    }
`

const REGISTRATION_QUERY = `
    query Registrations($limit: Int!, $offset: Int!) {
        search_output_prefix(
            args: { locking_bytecode_prefix_hex: "${REGISTRATION_PREFIX}" }
            limit: $limit
            offset: $offset
        ) {
            transaction_hash
            output_index
            transaction { ${TRANSACTION_FIELDS} }
        }
    }
`

const TRANSACTION_QUERY = `
    query Transaction($hash: bytea!) {
        transaction(where: { hash: { _eq: $hash } }, limit: 1) {
            ${TRANSACTION_FIELDS}
        }
    }
`

const CATEGORY_QUERY = `
    query Category($category: bytea!, $limit: Int!) {
        output(where: { token_category: { _eq: $category } }, limit: $limit) {
            output_index
            transaction_hash
            value_satoshis
            locking_bytecode_hex
            token_category
            fungible_token_amount
            nonfungible_token_capability
            nonfungible_token_commitment
            spent_by {
                input_index
                transaction { ${TRANSACTION_FIELDS} }
            }
            transaction { ${TRANSACTION_FIELDS} }
        }
    }
`

/**
 * Convert a ChainGraph transaction row to a plain, hex-normalized object.
 *
 * @param {object} row
 * @returns {object}
 */
export function normalizeTransaction(row) {
    const inclusions = (row.block_inclusions || []).slice().sort((a, b) => Number(a.block.height) - Number(b.block.height))
    const inclusion = inclusions.length > 0 ? inclusions[inclusions.length - 1] : null

    return {
        hash: normalizeHex(row.hash),
        internalId: row.internal_id === undefined ? null : String(row.internal_id),
        block: inclusion
            ? {
                height: Number(inclusion.block.height),
                hash: normalizeHex(inclusion.block.hash),
                transactionIndex: Number(inclusion.transaction_index),
            }
            : null,
        inputs: (row.inputs || []).map((input) => ({
            index: Number(input.input_index),
            outpointTransactionHash: normalizeHex(input.outpoint_transaction_hash),
            outpointIndex: Number(input.outpoint_index),
        })).sort((a, b) => a.index - b.index),
        outputs: (row.outputs || []).map((output) => ({
            index: Number(output.output_index),
            valueSatoshis: Number(output.value_satoshis),
            lockingBytecodeHex: normalizeHex(output.locking_bytecode_hex || ''),
            tokenCategory: output.token_category ? normalizeHex(output.token_category) : null,
            fungibleAmount: output.fungible_token_amount === null ? null : String(output.fungible_token_amount),
            nftCapability: output.nonfungible_token_capability || null,
            nftCommitment: output.nonfungible_token_commitment ? normalizeHex(output.nonfungible_token_commitment) : null,
        })).sort((a, b) => a.index - b.index),
    }
}

/**
 * Fetch one page of registration transactions (the OP_RETURN prefix scan).
 *
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<object[]>} normalized transactions (one per registration)
 */
export async function searchRegistrations({ limit = 100, offset = 0 } = {}) {
    const data = await graphql(REGISTRATION_QUERY, { limit, offset })

    return (data.search_output_prefix || [])
        .map((row) => row.transaction)
        .filter(Boolean)
        .map(normalizeTransaction)
}

/**
 * Fetch every registration, following ChainGraph pagination.
 *
 * @param {{ pageSize?: number, maxPages?: number }} [options]
 * @returns {Promise<object[]>}
 */
export async function loadAllRegistrations({ pageSize = 100, maxPages = 20 } = {}) {
    const registrations = []

    for (let page = 0; page < maxPages; page++) {
        const batch = await searchRegistrations({ limit: pageSize, offset: page * pageSize })

        registrations.push(...batch)

        if (batch.length < pageSize) {
            break
        }
    }

    return registrations
}

/**
 * Fetch one transaction by txid.
 *
 * @param {string} txid
 * @returns {Promise<object|null>}
 */
export async function getTransaction(txid) {
    const data = await graphql(TRANSACTION_QUERY, { hash: byteaVariable(txid) })
    const row = (data.transaction || [])[0]

    return row ? normalizeTransaction(row) : null
}

/**
 * Fetch every output carrying a token category.
 *
 * @param {string} category
 * @param {{ limit?: number }} [options]
 * @returns {Promise<object[]>}
 */
export async function getCategoryOutputs(category, { limit = 100 } = {}) {
    const data = await graphql(CATEGORY_QUERY, { category: byteaVariable(category), limit })

    return (data.output || []).map((row) => ({
        outputIndex: Number(row.output_index),
        transactionHash: normalizeHex(row.transaction_hash),
        valueSatoshis: Number(row.value_satoshis),
        lockingBytecodeHex: normalizeHex(row.locking_bytecode_hex || ''),
        tokenCategory: row.token_category ? normalizeHex(row.token_category) : null,
        fungibleAmount: row.fungible_token_amount === null ? null : String(row.fungible_token_amount),
        nftCapability: row.nonfungible_token_capability || null,
        nftCommitment: row.nonfungible_token_commitment ? normalizeHex(row.nonfungible_token_commitment) : null,
        spentBy: (row.spent_by || []).map((input) => ({
            inputIndex: Number(input.input_index),
            transaction: normalizeTransaction(input.transaction),
        })),
        transaction: normalizeTransaction(row.transaction),
    }))
}

/**
 * The current mainnet tip (the public instance's indexed height).
 *
 * @returns {Promise<{ height: number, hash: string }>}
 */
export async function getTip() {
    const data = await graphql('{ block(limit: 1, order_by: { height: desc }) { height hash } }')
    const row = (data.block || [])[0]

    return { height: Number(row.height), hash: normalizeHex(row.hash) }
}

/**
 * Fetch a block by height.
 *
 * @param {number} height
 * @returns {Promise<{ height: number, hash: string }|null>}
 */
export async function getBlockByHeight(height) {
    const data = await graphql('query Block($height: bigint!) { block(where: { height: { _eq: $height } }, limit: 1) { height hash } }', { height: String(height) })
    const row = (data.block || [])[0]

    return row ? { height: Number(row.height), hash: normalizeHex(row.hash) } : null
}
