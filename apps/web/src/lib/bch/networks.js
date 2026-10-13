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

/* Initialize the Electrum protocol version we negotiate with servers. */
export const ELECTRUM_PROTOCOL_VERSION = '1.4'

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
        /* Fulcrum WSS cluster (verified live). */
        servers: [
            { host: 'bch.imaginary.cash', port: 50004 },
            { host: 'electrum.imaginary.cash', port: 50004 },
            { host: 'blackie.c3-soft.com', port: 50004 },
            { host: 'bch.loping.net', port: 50004 },
        ],
        /* Minimum agreeing servers required to accept a response. */
        quorum: 2,
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
        servers: [
            { host: 'chipnet.imaginary.cash', port: 50004 },
            { host: 'chipnet.bch.ninja', port: 50004 },
        ],
        quorum: 2,
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

export default networks
