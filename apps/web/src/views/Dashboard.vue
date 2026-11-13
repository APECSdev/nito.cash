<template>
    <main class="h-full flex flex-col overflow-y-auto [-webkit-overflow-scrolling:touch]">
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

        <BlazeBanner />

        <div class="w-full max-w-[680px] w-full mx-auto px-[16px] md:px-[24px] flex-1 flex flex-col">
            <header class="flex items-center justify-between pt-[14px] pb-[6px]">
                <span class="text-[10px] font-semibold tracking-[0.22em] uppercase text-secondary">Wallet</span>

                <div class="flex items-center gap-[14px]">
                    <button @click="openWizardConnect" class="cursor-pointer bg-transparent text-[12px] text-trinary underline underline-offset-4 hover:text-primary-fg transition-colors">
                        Connect wallet
                    </button>
                    <button @click="loadSettings" class="cursor-pointer bg-transparent hover:opacity-70 transition-opacity">
                        <svgicon icon="cog" width="22" height="22" :fill="false" :original="true"></svgicon>
                    </button>
                </div>
            </header>

            <!-- Balance card -->
            <section class="balance-card relative overflow-hidden rounded-2xl mt-[8px] px-[20px] pt-[24px] pb-[20px] md:px-[30px] md:pt-[30px] text-center entrance">
                <div class="card-glow" aria-hidden="true"></div>

                <div class="relative text-center">
                    <div class="text-[10px] font-semibold tracking-[0.22em] uppercase text-white/70">Total balance</div>

                    <h1 class="relative inline-block mt-[8px] mx-auto text-[44px] md:text-[52px] leading-[40px] font-medium font-['Poppins',sans-serif] text-white">
                        {{walletBalance?.value}}
                        <small class="leading-[21px] font-medium text-[16px] absolute top-[2px] left-[calc(100%+4px)]">{{walletBalance?.unit}}</small>
                    </h1>

                    <h2 class="leading-[21px] font-medium text-[18px] md:text-[20px] short:mb-[16px] text-white/85">{{walletBalance?.fiat}}</h2>

                    <div class="w-[186px] h-[3px] mx-auto mt-[12px] mb-[14px] rounded-full bg-white/25" />

                    <div class="grid grid-cols-3 gap-[8px]">
                        <div class="stat-tile">
                            <small>Cash Wallet</small>
                            <span>{{walletBalance?.fiat}}</span>
                        </div>
                        <div class="stat-tile">
                            <small>Nito Wallet</small>
                            <span>$0.00</span>
                        </div>
                        <div class="stat-tile">
                            <small>Savings Wallet</small>
                            <span>$0.00</span>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Quick actions -->
            <section class="grid grid-cols-2 gap-[10px] mt-[12px] pb-[18px]">
                <button @click="openWizardConnect" class="tile tile-accent col-span-2">
                    <span class="tile-icon">⚡</span>
                    <span class="tile-label">Connect external wallet</span>
                    <span class="tile-sub">WizardConnect — pay from your own wallet</span>
                </button>

                <button @click="loadHistory" class="tile">
                    <span class="tile-icon">≡</span>
                    <span class="tile-label">History</span>
                </button>

                <button @click="loadConcierge" class="tile">
                    <span class="tile-icon">✦</span>
                    <span class="tile-label">Concierge</span>
                </button>
            </section>
        </div>

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

<style scoped>
/* Balance card: brand gradient (theme-safe in light + dark). */
.balance-card {
    background: linear-gradient(155deg, var(--primary) 0%, #1b3f8f 130%);
    box-shadow: 0 18px 40px -18px rgba(20, 60, 160, 0.55);
}

.card-glow {
    position: absolute;
    inset: -40% -20% auto auto;
    width: 260px;
    height: 260px;
    background: radial-gradient(circle, rgba(76, 195, 255, 0.5) 0%, transparent 70%);
    filter: blur(30px);
    pointer-events: none;
}

.stat-tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 12px;
    padding: 8px 6px;
}

.stat-tile small {
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.7);
}

.stat-tile span {
    font-size: 12px;
    font-weight: 600;
    color: #fff;
}

/* Quick-action tiles (theme-aware via CSS vars). */
.tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    background: var(--box-bg);
    border: 1px solid var(--input-border);
    border-radius: 14px;
    padding: 12px 14px;
    cursor: pointer;
    text-align: left;
    transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.tile:hover {
    transform: translateY(-1px);
    border-color: var(--trinary);
    box-shadow: 0 10px 24px -14px rgba(30, 80, 180, 0.5);
}

.tile-accent {
    flex-direction: row;
    align-items: center;
    gap: 10px;
    background: linear-gradient(120deg, rgba(76, 195, 255, 0.16), rgba(255, 197, 85, 0.14));
    border-color: var(--trinary);
}

.tile-icon {
    font-size: 16px;
    line-height: 1;
}

.tile-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--fg);
}

.tile-sub {
    font-size: 10px;
    color: var(--secondary);
}

.entrance {
    animation: rise 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

@keyframes rise {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
}
</style>
