<template>
    <main>
        <Backup
            v-if="backupReminder"
            :showBackup="showBackup"
            v-on:close-backup="showBackup = false"
        />

        <Import
            v-if="showImport"
            v-on:close-import="showImport = false"
        />

        <div>
            <header>
                <button @click="loadSettings">
                    <svgicon icon="cog" width="24" height="24" :fill="false" :original="true"></svgicon>
                </button>
            </header>

            <div class="balance">
                <h1>
                    {{walletBalance.value}}
                    <small>{{walletBalance.unit}}</small>
                </h1>

                <h2>{{walletBalance.fiat}}</h2>

                <div class="divider" />

                <h4>
                    <small>Cash Wallet</small>
                    {{walletBalance.fiat}}
                </h4>

                <h4>
                    <small>Nito Wallet</small>
                    $0.00
                </h4>

                <h4>
                    <small>Savings Wallet</small>
                    $0.00
                </h4>

                <footer>
                    <Button @click.native="loadHistory" label="History" double secondary small />
                    <Button @click.native="loadConcierge" label="Concierge" double secondary small />
                </footer>
            </div>
        </div>

        <!-- <chart>
            <h3>Trading price</h3>
            <Chart />
        </chart> -->

        <Footer>
            <Button @click.native="loadReceive" label="Receive" double :disabled="!masterSeed" />
            <Button @click.native="loadSend" label="Send" double />
        </Footer>
    </main>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters, mapState } from 'vuex'

/* Import components. */
import { Backup, Button, Footer, Import } from '@/components'

/* Import icons. */
import '@/compiled-icons/cog'
import '@/compiled-icons/fire'

export default {
    components: {
        Backup,
        Button,
        Footer,
        Import,
    },
    data: () => {
        return {
            backupReminder: false,
            showBackup: false,
            showImport: false,
            walletBalance: null,
        }
    },
    computed: {
        ...mapState({
            /* Profile */
            masterSeed: state => state.profile.ms,

            /* Wallets */
            // accounts: state => state.wallets.a,
        }),

        ...mapGetters('wallets', [
            'getAccounts',
            'getBalance',
        ]),
    },
    methods: {
        ...mapActions('blockchain', [
            //
        ]),

        /**
         * Load Send Screen
         */
        loadSend() {
            this.$router.push('send')
        },

        /**
         * Load Receive Screen
         */
        loadReceive() {
            this.$router.push('receive')
        },

        /**
         * Load Settings Screen
         */
        loadSettings() {
            this.$router.push('settings')
        },

        /**
         * Load History Screen
         */
        loadHistory() {
            this.$router.push('history')
        },

        /**
         * Load Concierge Screen
         */
        loadConcierge() {
            this.$router.push('concierge')
        },
    },
    created: async function () {
        // FOR DEVELOPMENT PURPOSES ONLY
        console.log('DEBUG: ACCOUNTS', this.getAccounts)

        /* Initialize balance display (values). */
        this.walletBalance = {
            value: 0,
            rounded: 0,
            unit: '',
            fiat: 0
        }

        /* Retrieve current (wallet) balance. */
        this.walletBalance = await this.getBalance('BCH', 'USD')
    },
    mounted: function () {
        //
    },
}
</script>

<style scoped>
main {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
}

header {
    text-align: right;
    padding: 18px 17px 16px;
}
header button {
    cursor: pointer;
    background: none;
}

.balance {
    display: block;
    text-align: center;
    margin-bottom: 40px;
}
.balance h1 {
    position: relative;
    display: inline-block;
    margin: 0 auto 10px;
    font-size: 48px;
    line-height: 40px;
    font-weight: 500;
    font-family: 'Poppins', sans-serif;
}

.balance h1 small,
.balance h2 {
    line-height: 21px;
    font-weight: 500;
}

.balance h1 small {
    font-size: 16px;
    position: absolute;
    top: 2px;
    left: calc(100% + 3px);
}

.balance h2 {
    font-size: 20px;
    /* margin-bottom: 10px; */
}

.balance .divider {
    width: 100%;
    height: 3px;
    margin-top: 10px;
    margin-bottom: 10px;
    background-color: rgba(255, 255, 255, 0.7);
}

.balance h4 {
    font-size: 14px;
    margin-bottom: 10px;
}

@media only screen and (max-height: 600px) {
    .balance h2 {
        margin-bottom: 16px;
    }
}

.balance div {
    max-width: 186px;
    margin: 0 auto;
}

h3 {
    color: var(--chart-title);
    font-size: 14px;
    font-weight: 600;
    text-align: center;
}
</style>
