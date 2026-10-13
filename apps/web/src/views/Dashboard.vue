<template>
    <main class="h-full flex flex-col justify-between overflow-y-auto [-webkit-overflow-scrolling:touch]">
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
            <header class="text-right pt-[18px] px-[17px] pb-[16px]">
                <button @click="loadSettings" class="cursor-pointer bg-transparent">
                    <svgicon icon="cog" width="24" height="24" :fill="false" :original="true"></svgicon>
                </button>
            </header>

            <div class="block text-center mb-[40px]">
                <h1 class="relative inline-block mt-0 mx-auto mb-[10px] text-[48px] leading-[40px] font-medium font-['Poppins',sans-serif]">
                    {{walletBalance.value}}
                    <small class="leading-[21px] font-medium text-[16px] absolute top-[2px] left-[calc(100%+3px)]">{{walletBalance.unit}}</small>
                </h1>

                <h2 class="leading-[21px] font-medium text-[20px] short:mb-[16px]">{{walletBalance.fiat}}</h2>

                <div class="w-full max-w-[186px] mx-auto h-[3px] mt-[10px] mb-[10px] bg-[rgba(255,255,255,0.7)]" />

                <h4 class="text-[14px] mb-[10px]">
                    <small>Cash Wallet</small>
                    {{walletBalance.fiat}}
                </h4>

                <h4 class="text-[14px] mb-[10px]">
                    <small>Nito Wallet</small>
                    $0.00
                </h4>

                <h4 class="text-[14px] mb-[10px]">
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
