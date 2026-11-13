<template>
    <main class="flex-1 flex flex-col items-center justify-between h-full short:pt-[40px] px-0 overflow-y-auto">
        <BlazeBanner />

        <div class="w-full max-w-[560px] flex-1 flex flex-col items-center justify-center px-[20px] py-[28px]">
            <!-- Hero mark -->
            <div class="relative">
                <div class="absolute inset-0 rounded-full bg-[#4cc3ff]/20 blur-2xl" aria-hidden="true"></div>
                <svgicon icon="rocketman" width="180" height="180" :fill="false" :original="true" class="relative"></svgicon>
            </div>

            <!-- Onboarding card -->
            <div class="w-full mt-[20px] rounded-2xl border border-input-border/60 bg-white/10 dark:bg-white/5 backdrop-blur-md shadow-[0_18px_50px_-12px_rgba(20,40,80,0.35)] p-[20px] md:p-[26px] entrance">
                <div class="flex items-center gap-[12px]">
                    <span class="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full bg-secondary text-secondary-fg text-[16px] shrink-0">!</span>
                    <h2 class="text-[18px] md:text-[20px] font-semibold text-trinary">Before you start</h2>
                </div>

                <p class="text-[12px] leading-[18px] mt-[12px] text-primary-fg/90">
                    Nito.cash is a low-security wallet built for the <strong class="font-semibold">CONVENIENCE</strong>
                    and <strong class="font-semibold">EDUCATION</strong> of newcomers to the Wonderful World of Crypto.
                </p>

                <p class="text-[12px] leading-[18px] mt-[10px] text-primary-fg/90">
                    We highly recommend that you <strong class="font-semibold">ONLY</strong> send &amp; receive
                    small amounts of crypto(currency).
                </p>

                <ul class="mt-[14px] grid grid-cols-1 sm:grid-cols-3 gap-[10px]">
                    <li class="rounded-xl bg-white/10 dark:bg-black/20 px-[12px] py-[10px] text-[11px] leading-[15px] text-primary-fg/85">
                        🔐 Your keys stay on this device — encrypted, never uploaded
                    </li>
                    <li class="rounded-xl bg-white/10 dark:bg-black/20 px-[12px] py-[10px] text-[11px] leading-[15px] text-primary-fg/85">
                        🕶️ Shield stablecoins in the private pool — sender, receiver &amp; amount hidden
                    </li>
                    <li class="rounded-xl bg-white/10 dark:bg-black/20 px-[12px] py-[10px] text-[11px] leading-[15px] text-primary-fg/85">
                        ⚡ Payments verify with zero-knowledge proofs, right in your browser
                    </li>
                </ul>

                <div class="mt-[18px] flex flex-col gap-[10px]">
                    <Button @click.native="create" label="Create a NEW wallet" />

                    <button
                        @click="$router.push('connect')"
                        class="text-[12px] text-trinary underline underline-offset-4 bg-transparent hover:text-primary-fg transition-colors"
                    >
                        …or connect an existing wallet (WizardConnect)
                    </button>
                </div>
            </div>
        </div>
    </main>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters, mapState } from 'vuex'

/* Import components. */
import { BlazeBanner, Button } from '@/components'

/* Import icons. */
import '@/compiled-icons/alarm'
import '@/compiled-icons/rocketman'

export default {
    components: {
        BlazeBanner,
        Button,
    },
    data: () => {
        return {
            bitbox: null,
        }
    },
    computed: {
        ...mapState({
            masterIV: state => state.profile.miv,
            masterSeed: state => state.profile.ms,
        }),

        ...mapGetters('wallets', [
            'getAccountsByWallet',
        ]),
    },
    methods: {
        ...mapActions('profile', [
            //
        ]),

        ...mapActions('wallets', [
            'addImportedSeed',
            'createWallet',
        ]),

        async create() {
            /* Create new wallet. */
            this.createWallet()

            /* Continue to the default wallet. */
            setTimeout(() => {
                /* Redirect to the default wallet (Nito Cash). */
                this.$router.replace('/wallets/nito-cash')
            }, 1000)
        },

        /**
         * Initialize Scan Data
         *
         * For Android devices, we will use ZXing to scan QR Codes.
         * This is the return data from the app.
         */
        initScanData() {
            /* Parse the query string for shortcut. */
            if (window.location && window.location.search) {
                /* Set param (remove &). */
                const param = window.location.search.substr(1)

                if (param.slice(0, 4) === 'scan') {
                    const address = decodeURIComponent(param.slice(5))
                    console.log('SCAN ADDRESS', address)

                    // FIXME: Validate bitcoin cash address

                    /* Redirect to payment. */
                    this.$router.replace('pay')

                    return true
                }
            }

            return false
        },

        /**
         * Initialize Sponsored Wallet
         *
         * These wallets are received by attaching a UUID to the wallet URL.
         *
         * eg. https://nito.cash?47a49dfe-2fe4-4343-b81e-947580f243f0
         *     will generate a new seed `47a49dfe-2fe4-4343-b81e-947580f243f0`
         */
        initSponsorWallet() {
            /* Parse the query string for shortcut. */
            if (window.location && window.location.search) {
                /* Set param (remove &). */
                const param = window.location.search.substr(1)

                /* Handle uuid wallet seeds. */
                if (param.length === 36) {
                    /* Add sponsor wallet (private key) seed. */
                    this.addImportedSeed(param)

                    /* Sponsorship DOES exist. */
                    // NOTE: We must notify the user.
                    return true
                }
            }

            /* Sponsorship DOES NOT exists. */
            return false
        },

    },
    created: function () {
        /* Initialize scan data. */
        if (this.initScanData()) {
            return
        }

        /* Initialize sponsored wallet. */
        this.initSponsorWallet()

        /* Validate wallet accounts. */
        if (this.getAccountsByWallet('BCH')) {
            /* Redirect to the default wallet (Nito Cash). */
            return this.$router.replace('/wallets/nito-cash')
        }
    },
}
</script>

<style scoped>
.entrance {
    animation: rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

@keyframes rise {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
}

/* Scoped child-root rule: styles the svgicon's root <svg> (a child component's
   root receives this scope's data attribute). */
main > div > div > svg {
    height: auto;
}
</style>
