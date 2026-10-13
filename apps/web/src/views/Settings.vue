<template>
    <main>
        <Warning
            :class="{ active: showWarning }"
            v-on:confirm="destroy"
            v-on:cancel="showWarning = false"
        >
            <h5>Destroy wallet?</h5>

            <p>
                Your transaction history will be cleared. If you have not backed up, you will permanently lose the tokens in your wallet.
            </p>
        </Warning>

        <Modal :label="$t('settings-view.title')" secondary>
            <Tabs :tabs="tabs" :tab="tab" v-on:tab-change="updateTab" />

            <div class="settings">
                <section v-if="tab === 'Basic'">
                    <label>Language</label>

                    <Dropdown value="United States" flag="United States" disabled />

                    <label>Currency</label>

                    <!-- FIXME: `countries[0]` assumes the wrong index for (default) country. -->
                    <Dropdown
                        :onSelect="changeCurrency"
                        :flag="cc.code(fiatCurrency).countries[0]"
                        :value="cc.code(fiatCurrency).currency"
                        :items="currencies" />

                    <hr />

                    <label class="inline">
                        <span>Dark mode</span>
                        <span>
                            <Toggle :on="darkMode" />
                        </span>
                    </label>

                    <p>Visual theme optimised for night time use</p>

                    <hr />

                    <label class="inline">
                        <span>Notifications</span>
                        <span>
                            <Toggle :disabled="disabledNotifications" :on="showNotifications" />
                        </span>
                    </label>

                    <p v-if="disabledNotifications">Notifications are blocked by your browser. Enable them in the browser settings and restart Spark.</p>
                    <p v-else>Show new and confirmed payment notifications</p>

                    <hr />

                    <label class="inline">
                        <span>Chipnet (testnet)</span>
                        <span>
                            <Toggle :on="isChipnet" @toggle="toggleNetwork" />
                        </span>
                    </label>

                    <p>Experimental test network for development — claim free coins from the Chipnet faucet. Your wallet reloads when you switch.</p>

                    <hr />
                </section>

                <div v-if="tab === 'Wallet'">
                    <section>
                        <article>
                            <svgicon icon="vault" width="54" height="54" :fill="false" :original="true"></svgicon>

                            <div>
                                <h6 class="dark">BACK UP WITH SEEDVAULT</h6>
                                <p>
                                    You can backup this wallet by exporting a seedvault. The exported SeedVault can then be imported into
                                    Trinity wallet.
                                </p>

                            </div>
                        </article>

                        <Button
                            @click.native="backup"
                            label="Create SeedVault" />
                    </section>

                    <Footer tooltip>
                        <article>
                            <svgicon icon="alarm" width="54" height="54" :fill="false" :original="true"></svgicon>

                            <div>
                                <h6>BURN YOUR WALLET</h6>
                                <p>
                                    You can destroy this wallet, but you will lose access to your tokens and transaction history.
                                    <br />
                                    Be sure to back up your wallet before proceeding, otherwise your tokens will be unrecoverable.
                                </p>
                            </div>
                        </article>

                        <Button
                            @click.native="showWarning = true"
                            warning
                            label="Destroy this wallet" />
                    </Footer>
                </div>
            </div>
        </Modal>
    </main>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters } from 'vuex'

/* Import modules. */
import cc from 'currency-codes'

/* Import components. */
import { Button, Dropdown, Footer, Modal, Tabs, Toggle, Warning } from '@/components'

/* Import icons. */
import '@/compiled-icons/alarm'
import '@/compiled-icons/vault'

export default {
    components: {
        Button,
        Dropdown,
        Footer,
        Modal,
        Tabs,
        Toggle,
        Warning,
    },
    data: () => {
        return {
            cc: null,
            // darkMode: null,
            fiatCurrency: null,
            showNotifications: null,

            tab: 'Basic',
            tabs: ['Basic', 'Wallet'],
            showWarning: false,
            showExport: false,
            disabledNotifications: null,
        }
    },
    computed: {
        ...mapGetters([
            'getDarkMode',
        ]),

        ...mapGetters('profile', [
            'getNetwork',
        ]),

        /* Whether the active network is Chipnet (testnet). */
        isChipnet() {
            return this.getNetwork === 'chipnet'
        },

        darkMode() {
            console.log('HOW DO WE HANDLE DARK MODE??')

            if (this.getDarkMode) {
                document.body.classList.add('dark')
            } else {
                document.body.classList.remove('dark')
            }

            return this.getDarkMode
        },

        currencies() {
            /* Initialize currencies. */
            // FIXME: Be sure to set the (default) country id, for currencies with
            //        multiple countries.
            // console.log('Decoded country list', cc.code('EUR'))
            const currencies = this.getCurrencies({
                'USD': 16, // United States Of America (The)
                'EUR': 6, // European Union
                'GBP': 3, // United Kingdom Of Great Britain And Northern Ireland (The)
                'INR': 1, // India
                'AUD': 0, // Malaysia
                'CAD': 0, // Canada
                'SGD': 0, // Singapore
                'CHF': 1, // Switzerland
                'MYR': 0, // Malaysia
                'JPY': 0, // Japan
                'CNY': 0, // China
            })
            // console.log('CURRENCIES', currencies)
            // $: currencies = getCurrencies($marketData.rates)

            return currencies
        },
    },
    methods: {
        ...mapActions([
            'displayError',
            'displayNotification',
        ]),

        ...mapActions('profile', [
            'destroyProfile',
            'initProfile',
            'updateNetwork',
        ]),

        ...mapActions('wallets', [
            'destroyWallet',
        ]),

        getCurrencies(_rates) {
            // console.log('GET CURRENCIES', _rates)

            if (!_rates) {
                return []
            }

            const result = Object.keys(_rates).map((item) => {
                /* Retrieve currency details. */
                const currencyData = cc.code(item)

                // console.log('GET ID', item, _rates[item])

                /* Set flag id. */
                const flagId = _rates[item]

                return {
                    label: currencyData.currency,
                    flag: currencyData.countries[flagId],
                    value: item
                }
            })

            result.sort((a, b) => (a.label > b.label ? 1 : -1))

            return result
        },

        changeCurrency(_currency) {
            console.log('CHANGE CURRENCY', _currency)
            // fiatCurrency.set(_currency)
        },

        /**
         * Toggle Network (Mainnet <-> Chipnet)
         *
         * Persist the newly-selected network, then reload the app so that ALL
         * wallet views re-derive their (network-prefixed) addresses, balances
         * and history against the active network.
         */
        toggleNetwork(_isChipnet) {
            /* Set the (new) network id. */
            const network = _isChipnet ? 'chipnet' : 'mainnet'

            /* Persist the (new) network. */
            this.updateNetwork(network)

            /* Notify the user. */
            this.displayNotification(
                `Switched to ${network === 'chipnet' ? 'Chipnet (testnet)' : 'Mainnet'} — reloading…`)

            /* Reload the app (to apply the network across all wallet views). */
            setTimeout(() => window.location.reload(), 800)
        },

        /**
         * Update Tab
         */
        updateTab(_tab) {
            /* Update tab. */
            this.tab = _tab
        },

        async backup() {
            this.displayError('This feature is coming soon')
        },

        async destroy() {
            try {
                /* Request (total) profile destruction. */
                this.destroyProfile()

                /* Request (total) wallet destruction. */
                this.destroyWallet()

                /* Set flag. */
                this.showWarning = false

                /* Display notification. */
                this.displayNotification('Wallet has been destroyed')

                /* Re-initialize profile. */
                setTimeout(() => {
                    this.initProfile()
                }, 1000)

                /* Load setup. */
                setTimeout(() => {
                    this.$router.replace('setup')
                }, 3000)
            } catch (err) {
                console.error(err) // eslint-disable-line no-console

                /* Display error. */
                this.displayError(err.message ? err.message.split(';')[0] : err)

                /* Bugsnag alert. */
                throw new Error(err)
            }
        },

    },
    created: function () {
        /* Initialize currency codes. */
        this.cc = cc

        // this.disabledNotifications = typeof Notification !== 'function' || Notification.permission === 'denied'
        this.disabledNotifications = false

        // FIXME: Add Vuex for state management.
        console.log('DARK MODE', this.getDarkMode)

        this.fiatCurrency = 'USD'

        // FIXME: We need to detect the user's compatibility.
        this.showNotifications = false
    },
    mounted: function () {
        //
    }
}
</script>

<style scoped>
.settings {
    flex: 1;
    display: flex;
    flex-direction: column;
}
.settings > p {
    font-size: 12px;
    margin-bottom: 24px;
}

section {
    flex: 1;
    padding: 28px 20px;
}

hr {
    display: block;
    width: calc(100% + 40px);
    height: 1px;
    margin: 0 0 20px -20px;
    background: var(--hr);
}

p + hr {
    margin-top: 20px;
}

label.inline {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

article {
    display: flex;
    padding: 12px 15px 24px;
}

article icon {
    width: 110px;
    text-align: center;
}

article div {
    padding-left: 28px;
}

article p {
    font-size: 12px;
    line-height: 18px;
}
h5 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 22px;
}
p {
    line-height: 18px;
}

h6.dark {
    color: var(--fg);
}
</style>
