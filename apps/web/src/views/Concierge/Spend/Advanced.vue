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

        <Modal :label="$t('concierge-spend-advanced-view.title')" secondary>
            <Tabs :tabs="tabs" :tab="tab" v-on:tab-change="updateTab" />

            <div class="settings">
                <section v-if="tab === 'Active'">
                    <label>Language</label>

                    <p>Visual theme optimised for night time use</p>

                    <hr />


                    <hr />
                </section>

                <div v-if="tab === 'Locked'">
                    <section>
                        <article>
                            <svgicon icon="vault" width="54" height="54" :fill="false" :original="true"></svgicon>

                            <div>
                                <h6 class="dark">MANAGE YOUR SPENDABLES</h6>
                                <p>
                                    You can unlock spendables that have been previously locked.
                                    Their value will then be added back to your total balance; which you can then freely spend.
                                </p>

                            </div>
                        </article>

                        <Button
                            @click.native="showWarning = true"
                            warning
                            label="Unlock this Spendable" />
                        <Button
                            @click.native="ledgerConnect"
                            label="Ledger Connect" />
                        <!-- <Button
                            @click.native="backup"
                            label="Create SeedVault" /> -->
                    </section>

                </div>
            </div>
        </Modal>
    </main>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters } from 'vuex'

/* Import components. */
// import { Button, Dropdown, Footer, Modal, Tabs, Toggle, Warning } from '@/components'
import { Button, Modal, Tabs, Warning } from '@/components'

/* Import icons. */
import '@/compiled-icons/alarm'
import '@/compiled-icons/vault'

// FOR DEVELOPMENT PURPOSES ONLY
import LedgerTransport from '@ledgerhq/hw-transport-webusb'
import LedgerBtc from '@ledgerhq/hw-app-btc'

export default {
    components: {
        Button,
        // Dropdown,
        // Footer,
        Modal,
        Tabs,
        // Toggle,
        Warning,
    },
    data: () => {
        return {
            cc: null,
            // darkMode: null,
            fiatCurrency: null,
            showNotifications: null,

            tab: 'Active',
            tabs: ['Active', 'Locked'],
            showWarning: false,
            showExport: false,
            disabledNotifications: null,
        }
    },
    computed: {
        ...mapGetters([
            'getDarkMode',
        ]),

    },
    methods: {
        ...mapActions([
            'displayError',
            'displayNotification',
        ]),

        destroy() {

        },

        /**
         * Update Tab
         */
        updateTab(_tab) {
            /* Update tab. */
            this.tab = _tab
        },

        ledgerConnect() {
            const getBtcAddress = async () => {
                const transport = await LedgerTransport.create()
                const btc = new LedgerBtc(transport)

                const result = await btc.getWalletPublicKey(`44'/145'/0'/0/0`)
                // const result = await btc.getWalletPublicKey(`44'/145'/0'/0/1`)

                return result.bitcoinAddress
            }

            getBtcAddress().then(addr => console.log('ADDRESS', addr))

        },

    },
    created: function () {

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
