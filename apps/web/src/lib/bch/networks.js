// apps/web/src/lib/bch/networks.js
/**
 * BCH network definitions (Mainnet + Chipnet).
 *
 * Nito.cash is a client-side SPA with no backend; it talks directly to public
 * Fulcrum (Electrum-protocol) servers over secure websockets. To avoid trusting
 * any single endpoint, every network is configured with a CLUSTER of servers
 * and a QUORUM: a response is only accepted once `quorum` servers agree.
 *
 * Endpoint reachability + chain-tip consensus were verified live (see project
 * notes): mainnet servers agreed on tip 972630, chipnet servers on tip 327628.
 *
 * Chipnet is the BCH testnet. Faucet for testing: https://chipnet.bch.ninja
 */

/* Initialize the Electrum protocol version we negotiate with servers.
   1.5 is required for the CashTokens `include_tokens` UTXO filter (verified
   live: every configured mainnet + chipnet server accepts it). */
export const ELECTRUM_PROTOCOL_VERSION = '1.5'

/* Application name announced to servers during version negotiation. */
export const ELECTRUM_CLIENT_NAME = 'nito.cash'

/* BIP44 coin types (https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki). */
export const COIN_TYPE_MAINNET = 145 // Bitcoin Cash

/*
 * Chipnet intentionally REUSES the BCH coin type (145) rather than the
 * conventional testnet coin type (1): the same seed derives the SAME keys on
 * both networks, so your existing wallet/addresses work on Chipnet for
 * testing — only the CashAddress prefix differs (bitcoincash: vs bchtest:).
 * The distinct prefixes make cross-network sends invalid, so this is safe.
 */
export const COIN_TYPE_TESTNET = 145 // Chipnet reuses BCH keys (see note above)

const networks = {
    mainnet: {
        id: 'mainnet',
        label: 'Mainnet',
        /* CashAddress prefix (Libauth `encodeCashAddress`). */
        addressPrefix: 'bitcoincash',
        /* BIP44 derivation coin type. */
        coinType: COIN_TYPE_MAINNET,
        /* Block explorer base URLs (chaingraph.cash verified reachable; exact
           tx/address path scheme is confirmed when wiring the popup in F5). */
        explorerTx: 'https://chaingraph.cash/tx/',
        explorerAddress: 'https://chaingraph.cash/address/',
        /* Fulcrum WSS cluster — re-verified live over WSS (2026-11-14): the
           three servers below answered server.version + headers.subscribe in
           sync at height 977258. bch.loping.net was REMOVED (its WebSocket
           handshake fails with 1006 — dead since at least 2026-11-14).
           A quorum-2-of-3 cluster tolerates one dead server. */
        servers: [
            { host: 'bch.imaginary.cash', port: 50004 },
            { host: 'electrum.imaginary.cash', port: 50004 },
            { host: 'blackie.c3-soft.com', port: 50004 },
        ],
        /* Minimum agreeing servers required to accept a response. */
        quorum: 2,
        /* CashToken categories tracked by the wallet (by symbol). Fulcrum's
           token_data.category is the BE (display) form of the category.
           Mainnet PUSD (ParyonUSD) — the category declared by the issuer
           (see pusd-shielded-pool COVENANT-DESIGN.md / the retired docs
           on-chain-anatomy page: "category 0x2469acc5…2544, issued by
           ParyonUSD"). This is what the "Naked Cash" transparent PUSD
           balance reads (getTokenBalance). */
        tokens: {
            PUSD: '2469acc5afa4b10cb5b5c04afb89c3a3ffd61c5da9c01e26d00951cae2a02544',
        },
    },

    chipnet: {
        id: 'chipnet',
        label: 'Chipnet',
        addressPrefix: 'bchtest',
        coinType: COIN_TYPE_TESTNET,
        explorerTx: 'https://chipnet.chaingraph.cash/tx/',
        explorerAddress: 'https://chipnet.chaingraph.cash/address/',
        /* Public Chipnet faucet for funding test wallets. */
        faucet: 'https://chipnet.bch.ninja',
        /* Fulcrum WSS cluster (verified live). */
        /* Default server: chipnet.bch.ninja (fulcrum + faucet host).
           chipnet.imaginary.cash is the fallback (and hosts the chipnet
           block explorer used by the docs links). */
        servers: [
            { host: 'chipnet.bch.ninja', port: 50004 },
            { host: 'chipnet.imaginary.cash', port: 50004 },
        ],
        quorum: 2,
        /* CashToken categories tracked by the wallet (by symbol). Fulcrum's
           token_data.category is the BE (display) form of the category.
           Chipnet PUSD is a stand-in for mainnet PUSD — the chipnet-pusd-v3
           pool's category (deployed 2026-11-23: anchor 09268d21…1dbf = the
           category, mint 32f84b41…adab, deploy 56ebf641…489c — see
           src/lib/pool/registry.js). v3 is deployed under
           GENERALIZED_WALLET_PROGRAM (the deployed on-chain LAYOUT + the
           wallet's own bodies), which is the only shape the wallet's witness
           builder can spend. SUPERSEDED stand-ins: 050b5934…504a9 (v2, the
           five-input fixture layout — unspendable as deployed), 8c73ff150fbc…
           (the TX-P3/G3/B3 era — never tracked by any wallet-compatible pool)
           and 479aeebabc… (the faucet token, genesis 4257dbfb…, block 328616). */
        tokens: {
            /* chipnet-pusd-v4 (START OVER 2026-11-23, 3rd deploy = VK-CORRECT):
               a FRESH category under the PUBLIC BENCH program built with the
               WALLET-COMMITTED key (verifier-program-bench.js). The program is
               vk-specific, so the first two v4 deploys (built with the bench's
               own key) were unspendable. Deploy tx 4fa5b159…; the pool UTXO is
               output 0 and the five step UTXOs are outputs 1..5. */
            /* The WORKING pool (fixture shape). The source-generalized pools
               (0717e1a1…, 07a020e9…, 00081625…, 135dc9ed…) are deployed but
               their programs still fail on chain, so they are NOT selected. */
            PUSD: '2d7cae869dac55fbdefca88c005267ecde29ce8a038143674c877e5290e34fc7',
        },
    },
}

/* Ordered list of network ids (used by the Settings toggle). */
export const NETWORK_IDS = Object.keys(networks)

/* The network used when none has been selected/persisted yet. */
export const DEFAULT_NETWORK = 'mainnet'

/**
 * Get the config for a network id, falling back to the default network.
 */
export function getNetwork(id) {
    return networks[id] || networks[DEFAULT_NETWORK]
}

/* Get a tracked CashToken's category for a network (undefined if untracked). */
export function getTokenCategory(networkId, symbol) {
    const net = getNetwork(networkId)
    return (net.tokens && net.tokens[symbol]) || undefined
}

export default networks
