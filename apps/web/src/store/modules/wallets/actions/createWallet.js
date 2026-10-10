/**
 * Create Wallet
 */
const createWallet = ({ commit }) => {
    console.info('Creating a NEW wallet...') // eslint-disable-line no-console

    try {
        /**
         * (Wallet) Accounts Model
         *
         * (s) Status code
         * (u) Unspent transaction outputs (UTXOs)
         * (c) Comments (optional -- useful for locked accounts/unspents)
         *
         * Status codes:
         *     (a) Active: Public account ready to receive OR spend funds.
         *     (c) Change: Private account ready to received OR spend change.
         *     (d) Disabled: Already received and spent funds (is now empty).
         *     (f) Fusion: Queued for OR already completed CashFusion mixing.
         *     (l) Locked: Received funds that are being held in reserve
         *                 for later use (eg. ANYONECANPAY assurance contract).
         *     (s) Shuffle: Queued for OR already completed CashShuffle mixing.
         *
         * NOTE: Unspent transaction outputs (UTXOs) are objects containing the
         *       status (code) of ALL inputs held by the account.
         *
         * NOTE: Comments MUST be used sparingly, to avoid data storage bloat;
         *       and should be deleted when no longer needed.
         *
         * NOTE: The compacted design of this account model will undoubtably
         *       "leak" (ie. create gaps) in both the receiving and change
         *       address indexes. This is considered an acceptable tradeoff,
         *       considering the ephemeral nature of this wallet.
         *
         * TODO: A workaround of the TOR requirement is required before
         *       the current CashFusion specification can be implemented.
         *       (Nito Cash Exchange is an alternative solution)
         *
         */
        const accountsModel = {
            /**
             * Bitcoin Cash (BCH)
             */
            BCH: {
                0: {
                    s: 'a',
                    u: {},
                },
            },

            /**
             * Ethereum (ETH)
             */
            ETH: {
                0: {
                    s: 'a',
                },
            },

            /**
             * Simple Ledger Protocol (SLP)
             */
            SLP: {
                0: {
                    s: 'a',
                    u: {},
                },
            },
        }

        /* Initialize accounts. */
        commit('setAccounts', accountsModel)

        /* Initialize imported (wallet) seeds. */
        commit('setImportedSeeds', [])
    } catch (err) {
        console.error(err) // eslint-disable-line no-console

        /* Bugsnag alert. */
        throw new Error(err)
    }
}

/* Export module. */
export default createWallet
