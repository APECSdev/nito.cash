<template>
    <main class="flex-1 flex flex-col items-center justify-between h-full short:pt-[40px] px-0 overflow-y-auto">
        <BlazeBanner />

        <div class="w-full max-w-[560px] flex-1 flex flex-col items-center justify-center px-[20px] py-[28px]">
            <!-- Hero mark (animated Rocketman Lottie — same artwork as Splash) -->
            <div class="relative h-[180px] w-[180px]">
                <div class="absolute inset-0 rounded-full bg-[#4cc3ff]/20 blur-2xl" aria-hidden="true"></div>
                <Animation type="rocketman" />
            </div>

            <!-- Onboarding card (dark surface: readable in light AND dark theme) -->
            <div class="w-full mt-[20px] rounded-2xl border border-white/10 shadow-[0_18px_50px_-12px_rgba(20,40,80,0.45)] p-[22px] md:p-[28px] entrance setup-card">
                <div class="flex items-center gap-[12px]">
                    <span class="inline-flex h-[38px] w-[38px] items-center justify-center rounded-full bg-secondary text-[#4a3410] text-[20px] font-semibold shrink-0">!</span>
                    <h2 class="text-[22px] md:text-[24px] font-semibold text-white">Before you start</h2>
                </div>

                <p class="text-[15px] leading-[22px] mt-[14px] text-white/95">
                    Nito.cash is a low-security wallet built for the <strong class="font-semibold">CONVENIENCE</strong>
                    and <strong class="font-semibold">EDUCATION</strong> of newcomers to the Wonderful World of Crypto.
                </p>

                <p class="text-[15px] leading-[22px] mt-[10px] text-white/95">
                    We highly recommend that you <strong class="font-semibold">ONLY</strong> send &amp; receive
                    small amounts of crypto(currency).
                </p>

                <ul class="mt-[16px] grid grid-cols-1 sm:grid-cols-3 gap-[10px]">
                    <li class="rounded-xl bg-white/10 px-[13px] py-[12px] text-[13px] leading-[18px] text-white/95">
                        🔐 Your keys stay on this device — encrypted, never uploaded
                    </li>
                    <li class="rounded-xl bg-white/10 px-[13px] py-[12px] text-[13px] leading-[18px] text-white/95">
                        🕶️ Shield stablecoins in the private pool — sender, receiver &amp; amount hidden
                    </li>
                    <li class="rounded-xl bg-white/10 px-[13px] py-[12px] text-[13px] leading-[18px] text-white/95">
                        ⚡ Payments verify with zero-knowledge proofs, right in your browser
                    </li>
                </ul>

                <div class="mt-[20px] flex flex-col gap-[12px]">
                    <Button @click.native="create" label="Create a NEW wallet" />

                    <button
                        @click="$router.push('connect')"
                        class="text-[15px] text-fg-link underline underline-offset-4 bg-transparent hover:text-white transition-colors"
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
import Animation from '@/components/Animation.vue'

export default {
    components: {
        BlazeBanner,
        Button,
        Animation,
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

/* Onboarding card surface: fixed dark gradient (independent of the light/dark
   theme so the white text is ALWAYS readable). */
.setup-card {
    background: linear-gradient(170deg, #1a2233 0%, #0d111a 100%);
}

/* Scoped child-root rule: styles the svgicon's root <svg> (a child component's
   root receives this scope's data attribute). */
main > div > div > svg {
    height: auto;
}
</style>
