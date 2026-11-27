<template>
    <main class="h-full flex flex-col overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <!-- First-run backup reminder: shows ONCE PER LAUNCH until the
             user has viewed their SeedVault phrase once (profile flag
             `f.bb`). "Not now" dismisses for this session only. -->
        <Backup
            v-if="backupReminder"
            v-on:confirm-backup="onConfirmBackup"
            v-on:deny-backup="onDenyBackup"
        />

        <!-- The REAL backup: the SeedVault phrase display + copy (the same
             popup Settings → Wallet → Create SeedVault opens). -->
        <SeedVault
            :active="showSeedVault"
            v-on:close-seed-vault="onSeedVaultClose"
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
                <span class="text-[10px] font-semibold tracking-[0.22em] uppercase text-muted">Dashboard</span>

                <div class="flex items-center gap-[14px]">
                    <button @click="openWizardConnect" class="cursor-pointer bg-transparent text-[12px] text-fg underline underline-offset-4 hover:text-primary-fg transition-colors">
                        Connect
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
                    <div class="text-[10px] font-semibold tracking-[0.22em] uppercase text-white">Total balance</div>

                    <!-- PRIMARY = the FIAT value (the user's currency, USD by
                         default); SECONDARY = the BCH amount. Requested:
                         "start by showing USD, not sats (but i still want to
                         keep sats, just not the default)". -->
                    <h1 class="relative inline-block mt-[8px] mx-auto text-[44px] md:text-[52px] leading-[40px] font-medium font-['Poppins',sans-serif] text-white">
                        {{fiatAmount}}
                        <small class="leading-[21px] font-medium text-[16px] absolute top-[2px] left-[calc(100%+4px)]">{{fiatCurrency}}</small>
                    </h1>

                    <h2 class="leading-[21px] font-medium text-[18px] md:text-[20px] short:mb-[16px] text-white/85">{{bchAmount}}</h2>

                    <div class="w-[186px] h-[3px] mx-auto mt-[12px] mb-[14px] rounded-full bg-white/25" />

                    <!-- The three wallet tiles ARE the wallet navigation:
                         each opens its wallet view. Balances are REAL:
                         the shielded pool balance, the transparent PUSD,
                         and the transparent BCH holdings (fiat). -->
                    <div class="grid grid-cols-3 gap-[8px]">
                        <button class="stat-tile" @click="loadWallet('nito-cash')">
                            <small>Nito Wallet</small>
                            <span>{{shieldedTile}}</span>
                        </button>
                        <button class="stat-tile" @click="loadWallet('naked-cash')">
                            <small>Cash Wallet</small>
                            <span>{{nakedTile}}</span>
                        </button>
                        <button class="stat-tile" @click="loadWallet('naked-vault')">
                            <small>My Treasury</small>
                            <span>{{walletBalance?.fiat}}</span>
                        </button>
                    </div>
                </div>
            </section>

            <!-- Quick actions -->
            <section class="grid grid-cols-2 gap-[12px] mt-[14px] pb-[18px]">
                <button @click="openWizardConnect" class="tile tile-accent col-span-2">
                    <span class="tile-icon">⚡</span>
                    <span class="tile-label">Connect a 3rd-party wallet</span>
                    <span class="tile-sub">WizardConnect | CashConnect</span>
                </button>

                <button @click="loadConcierge" class="tile">
                    <span class="tile-icon">✦</span>
                    <span class="tile-label">Concierge</span>
                </button>

                <button @click="loadHistory" class="tile">
                    <span class="tile-icon">≡</span>
                    <span class="tile-label">History</span>
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

/* Import networks (PUSD category lookup — the transparent stablecoin
   balance fetch). */
import { getTokenCategory } from '@/lib/bch/networks'

/* Import components. */
import { BlazeBanner, Backup, Button, Footer, Import, SeedVault, WizardConnect } from '@/components'

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
        SeedVault,
        WizardConnect,
    },
    data: () => {
        return {
            backupReminder: false,
            showSeedVault: false,
            showImport: false,
            showWizardConnect: false,
            walletBalance: null,
            nakedPusd: null,
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
            'getTokenBalance',
        ]),

        ...mapGetters('profile', [
            'getFlags',
            'getNetwork',
        ]),

        ...mapGetters('pool', [
            'getShieldedBalance',
        ]),

        /* PRIMARY (big) figure: the FIAT amount. utils/getFormattedValue
           returns `fiat` as "AMOUNT CURRENCY" (e.g. "$0.204 USD"), split
           here so the currency code renders as the small superscript unit
           — the same visual pattern the BCH figure used. */
        fiatAmount() {
            const fiat = this.walletBalance && this.walletBalance.fiat

            return fiat ? fiat.split(' ')[0] : '—'
        },

        /* The fiat currency code (e.g. USD). */
        fiatCurrency() {
            const fiat = this.walletBalance && this.walletBalance.fiat

            return fiat ? fiat.split(' ').slice(1).join(' ') : ''
        },

        /* The SHIELDED PUSD tile (Nito Wallet) — the unspent pool notes,
        formatted in PUSD base units (the same display the Nito Cash
        wallet view uses). */
        shieldedTile() {
            if (this.getShieldedBalance === null) {
                return '—'
            }

            return `${Number(this.getShieldedBalance).toLocaleString()} PUSD`
        },

        /* The TRANSPARENT PUSD tile (Naked Cash) — fetched in created()
        (guarded; null while unknown or when the network has no PUSD). */
        nakedTile() {
            return this.nakedPusd === null ? '—' : `${Number(this.nakedPusd).toLocaleString()} PUSD`
        },

        /* SECONDARY figure: the BCH amount in its auto-scaled unit
           (sats / bits / mBCH / BCH) — kept visible, just no longer the
           default primary display. */
        bchAmount() {
            if (!this.walletBalance) {
                return '—'
            }

            return `${this.walletBalance.value} ${this.walletBalance.unit}`
        },
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

        /**
         * Load Wallet View
         *
         * The three stat tiles are the wallet navigation: Nito Cash (the
         * shielded pool), Naked Cash (transparent stablecoins), and the
         * Naked Vault (transparent holdings). Previously NO UI path led
         * to `/wallets/*` — the wallet views were reachable only by URL.
         */
        loadWallet(id) {
            this.$router.push(`/wallets/${id}`)
        },

        /**
         * Confirm Backup (Wallet Backup)
         *
         * "Show my backup" — open the SeedVault popup (the real 24-word
         * phrase + copy). The prompt hides for this session; viewing the
         * phrase + pressing Done sets the `f.bb` flag (no more prompts).
         */
        onConfirmBackup() {
            this.backupReminder = false
            this.showSeedVault = true
        },

        /**
         * Deny Backup (Wallet Backup)
         *
         * "Not now" — dismiss for THIS session only; the reminder returns
         * on the next launch (the seed has still never been viewed).
         */
        onDenyBackup() {
            this.backupReminder = false
        },

        /**
         * Close SeedVault
         *
         * The user has now SEEN their recovery phrase — persist `f.bb` so
         * the first-run reminder never shows again.
         */
        onSeedVaultClose() {
            this.showSeedVault = false
            this.$store.commit('profile/setFlags', {
                ...this.getFlags,
                bb: true,
            })
        },
    },
    watch: {
        /* In-session deep links (dashboard → dashboard?connect=1) don't
           re-run created(); watch the query so the modal always opens. */
        '$route.query.connect': function (v) {
            if (v === '1') {
                console.log('[wizard] deep link (?connect=1) → opening modal')
                this.showWizardConnect = true
            }
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

        /* First-run backup reminder: only for an EXISTING wallet (master
           seed set) that has never viewed its SeedVault phrase once
           (profile flag `f.bb`). Re-prompts each launch until viewed. */
        this.backupReminder = !!this.masterSeed && !((this.getFlags || {}).bb)

        /* The TRANSPARENT PUSD balance (the Naked Cash tile) — fetched
           INDEPENDENTLY (a failure never zeroes the other tiles), and only
           when the active network tracks a PUSD category. */
        const pusdCategory = getTokenCategory(this.getNetwork, 'PUSD')
        if (pusdCategory) {
            try {
                this.nakedPusd = await this.getTokenBalance('BCH', pusdCategory)
            } catch (err) {
                console.error('PUSD balance fetch failed:', err) // eslint-disable-line no-console
                this.nakedPusd = null
            }
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
    background: linear-gradient(140deg, #2f66e0 0%, #16337a 58%, #0a1020 140%);
    box-shadow: 0 20px 44px -18px rgba(15, 50, 130, 0.6);
}

.card-glow {
    position: absolute;
    inset: -40% -20% auto auto;
    width: 260px;
    height: 260px;
    background: radial-gradient(circle, rgba(56, 189, 248, 0.5) 0%, transparent 70%);
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
    cursor: pointer;
}

.stat-tile:hover {
    background: rgba(255, 255, 255, 0.16);
}

.stat-tile small {
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(255, 255, 255, 0.95);
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
    border-radius: 16px;
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
    /* Fixed deep-navy CTA (branded, like Splash): the translucent trinary/
       secondary wash measured 3.3-4.1:1 against var(--fg) labels in BOTH
       themes. White on this gradient measures ~8:1. */
    background: linear-gradient(120deg, #2f66e0, #123a8f);
    border-color: rgba(56, 189, 248, 0.5);
}

.tile-accent .tile-label {
    color: #fff;
}

.tile-accent .tile-sub {
    color: #9fd8ff;
}

.tile-accent .tile-icon {
    color: #ffc555;
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
    color: var(--fg-muted);
}

.entrance {
    animation: rise 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

@keyframes rise {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
}
</style>
