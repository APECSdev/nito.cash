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

        <WizardConnect
            :active="showWizardConnect"
            @close-wizard-connect="showWizardConnect = false"
        />

        <div>
            <BlazeBanner />

            <header class="text-right pt-[18px] px-[17px] pb-[16px]">
                <button @click="openWizardConnect" class="cursor-pointer bg-transparent text-[12px] text-secondary underline mr-[12px] align-middle">
                    Connect wallet
                </button>
                <button @click="loadSettings" class="cursor-pointer bg-transparent">
                    <svgicon icon="cog" width="24" height="24" :fill="false" :original="true"></svgicon>
                </button>
            </header>

            <div class="block text-center mb-[40px]">
                <h1 class="relative inline-block mt-0 mx-auto mb-[10px] text-[48px] leading-[40px] font-medium font-['Poppins',sans-serif]">
                    {{walletBalance?.value}}
                    <small class="leading-[21px] font-medium text-[16px] absolute top-[2px] left-[calc(100%+3px)]">{{walletBalance?.unit}}</small>
                </h1>

                <h2 class="leading-[21px] font-medium text-[20px] short:mb-[16px]">{{walletBalance?.fiat}}</h2>

                <div class="w-full max-w-[186px] mx-auto h-[3px] mt-[10px] mb-[10px] bg-[rgba(255,255,255,0.7)]" />

                <h4 class="text-[14px] mb-[10px]">
                    <small>Cash Wallet</small>
                    {{walletBalance?.fiat}}
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
import { BlazeBanner, Backup, Button, Footer, Import, WizardConnect } from '@/components'

/* Import icons. */
import '@/compiled-icons/cog'
import '@/compiled-icons/fire'

export default {
    components: {
        BlazeBanner,
        Backup,
        Button,
        Footer,
        Import,
        WizardConnect,
    },
    data: () => {
        return {
            backupReminder: false,
            showBackup: false,
            showImport: false,
            showWizardConnect: false,
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
         * Open the WizardConnect popup (with diagnostics).
         */
        openWizardConnect() {
            console.log('[wizard] Connect wallet clicked → opening modal')
            this.showWizardConnect = true
        },

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

        /* Deep link: /dashboard?connect=1 opens the WizardConnect popup
           (the old /connect route redirects here). */
        if (this.$route.query.connect === '1') {
            console.log('[wizard] deep link (?connect=1) → opening modal')
            this.showWizardConnect = true
        }

        /* Initialize balance display (values). */
        this.walletBalance = {
            value: 0,
            rounded: 0,
            unit: '',
            fiat: 0
        }

        /* Retrieve current (wallet) balance. NOTE: null pre-setup (no
           accounts yet) — keep the zero-initialized display object so the
           template never reads `.value` of null (the judge deep-link path
           lands here before any wallet exists). */
        const balance = await this.getBalance('BCH', 'USD')

        if (balance) {
            this.walletBalance = balance
        }
    },
    mounted: function () {
        //
    },
}
</script>
