<template>
    <!-- Same onboarding-card aesthetic as Setup (fixed dark surface, readable
         in BOTH themes). -->
    <main class="flex-1 flex flex-col items-center justify-center h-full px-0 overflow-y-auto">
        <div class="w-full max-w-[560px] md:max-w-[720px] flex-1 flex flex-col items-center justify-center px-[12px] py-[28px] md:px-[24px]">
            <div class="w-full rounded-2xl border border-white/10 shadow-[0_18px_50px_-12px_rgba(20,40,80,0.45)] p-[22px] md:p-[36px] entrance connect-card">
                <div class="flex items-center gap-[12px]">
                    <span class="inline-flex h-[38px] w-[38px] items-center justify-center rounded-full bg-secondary text-[#4a3410] text-[20px] font-semibold shrink-0">🔑</span>
                    <h2 class="text-[22px] md:text-[28px] font-semibold text-white">Connect with Seed Phrase</h2>
                </div>

                <p class="text-[15px] leading-[22px] md:text-[17px] md:leading-[25px] mt-[14px] text-white/95">
                    Enter the BIP39 recovery phrase of the wallet you want to connect.
                    Phrases from the nito SeedVault and from other BIP39-compatible
                    wallets are both supported.
                </p>

                <p class="text-[13px] leading-[18px] mt-[10px] text-[#fbbf24]">
                    ⚠️ Connecting replaces the wallet currently in this app — its balances,
                    history and pool notes are cleared. Back it up first
                    (Settings → Wallet → Create SeedVault).
                </p>

                <textarea
                    v-model="phrase"
                    class="input-base mt-[16px] w-full"
                    rows="4"
                    placeholder="abandon abandon abandon … about"
                    spellcheck="false"
                    autocomplete="off"
                    autocapitalize="none"
                ></textarea>

                <p class="text-[13px] leading-[18px] mt-[8px]" :class="wordCount ? 'text-white/70' : 'text-white/50'">
                    {{ wordCount }} word{{ wordCount === 1 ? '' : 's' }} — 12, 15, 18, 21 or 24 words
                </p>

                <p v-if="error" class="text-[13px] leading-[18px] mt-[8px] text-[#fbbf24] font-medium">{{ error }}</p>

                <div class="mt-[20px] flex flex-col gap-[12px]">
                    <Button @click.native="connect" label="Connect Wallet" />

                    <Button @click.native="$router.replace('setup')" label="Back" blank />
                </div>
            </div>
        </div>
    </main>
</template>

<script>
/* Initialize vuex. */
import { mapActions } from 'vuex'

/* Import components. */
import { Button } from '@/components'

export default {
    components: {
        Button,
    },
    data: () => {
        return {
            /* The (typed/pasted) seed phrase. */
            phrase: '',

            /* Inline (validation) error. */
            error: null,
        }
    },
    computed: {
        /* Live word count (helps the user see the phrase shape). */
        wordCount() {
            return String(this.phrase || '').trim().split(/\s+/).filter(Boolean).length
        },
    },
    methods: {
        ...mapActions([
            'displayNotification',
        ]),

        ...mapActions('wallets', [
            'restoreWallet',
        ]),

        /**
         * Connect (restore) the wallet from the seed phrase.
         */
        async connect() {
            /* Reset (validation) error. */
            this.error = null

            try {
                /* Validate + restore (throws on an invalid phrase, BEFORE
                   anything is overwritten). */
                await this.restoreWallet(this.phrase)
            } catch (err) {
                /* Display inline error. */
                this.error = err.message ? err.message.split(';')[0] : String(err)

                return
            }

            /* Do not leave the phrase lingering in the input. */
            this.phrase = ''

            /* Display notification. */
            this.displayNotification('Wallet connected')

            /* Continue to the DASHBOARD (home: total balance + actions).
               The wallet screens are modals over it, so landing on one
               directly leaves no dashboard underneath. */
            this.$router.replace('/dashboard')
        },
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

/* Card surface: fixed dark gradient (independent of the light/dark theme
   so the white text is ALWAYS readable) — mirrors Setup's .setup-card. */
.connect-card {
    background: linear-gradient(170deg, #121b30 0%, #0a1020 100%);
}
</style>
