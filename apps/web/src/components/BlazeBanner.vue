<template>
    <!-- Floating overlay badge (bottom-right, above the footer, below modals).
         The `.blaze-layer` hook marks this as an INTENTIONAL overlay layer for
         the text-overlap auditor (overlay-vs-page pairs are by design). -->
    <div class="blaze-layer fixed z-[900] bottom-[58px] right-[10px] md:right-[14px] flex flex-col items-end gap-[6px]">

        <div
            v-show="open"
            class="w-[272px] md:w-[300px] rounded-[14px] border border-white/15 bg-[#0b1c3f]/95 text-white shadow-[0_12px_32px_rgba(0,0,0,0.4)] backdrop-blur-md p-[12px]"
        >
            <div class="text-[11px] leading-[16px] font-semibold tracking-[0.08em] uppercase text-[#9fd8ff]">
                ★ BCH BLAZE 2026
            </div>

            <div class="text-[11px] leading-[16px] text-white/85 mt-[2px]">
                Private payments on Bitcoin Cash
            </div>

            <div class="mt-[8px] flex flex-col gap-[6px]">
                <a
                    :href="deckUrl"
                    target="_blank"
                    rel="noopener"
                    class="flex items-center justify-between rounded-[8px] bg-white/10 hover:bg-white/20 px-[10px] py-[6px] text-[12px] leading-[17px] text-white"
                >
                    <span>Widget Factory deck</span>
                    <span class="text-white/70">↗</span>
                </a>

                <a
                    :href="repoUrl"
                    target="_blank"
                    rel="noopener"
                    class="flex items-center justify-between rounded-[8px] bg-white/10 hover:bg-white/20 px-[10px] py-[6px] text-[12px] leading-[17px] text-white"
                >
                    <span>Source (GitHub)</span>
                    <span class="text-white/70">↗</span>
                </a>

                <button
                    @click="copyAddress"
                    :title="'Click to copy the EMBER2026 donation address'"
                    class="flex items-center justify-between rounded-[8px] bg-white/10 hover:bg-white/20 px-[10px] py-[6px] text-[12px] leading-[17px] text-white text-left cursor-pointer"
                >
                    <span class="truncate">EMBER2026 · {{ copied ? 'copied ✓' : emberShort }}</span>
                    <span class="text-white/70 shrink-0 ml-[6px]">⧉</span>
                </button>
            </div>
        </div>

        <button
            @click="open = !open"
            class="rounded-full border border-white/15 bg-[#0b1c3f]/95 text-white text-[11px] leading-[16px] font-semibold px-[10px] py-[5px] shadow-[0_6px_18px_rgba(0,0,0,0.35)] cursor-pointer"
        >
            ★ BLAZE 2026 {{ open ? '▾' : '▴' }}
        </button>
    </div>
</template>

<script>
/* BCH BLAZE 2026 submission badge (eligibility elements, floating overlay).
   The three required elements per the BLAZE brief: the Widget Factory
   presentation link, the source-repo link, and a CashTokens address for
   EMBER2026 donations (Community Choice voting). */

/* The official Widget Factory deck: the generated PDF (apps/blaze/deck.pdf,
   printed from apps/blaze/deck-print.html via headless Chrome). The
   interactive HTML deck remains at blaze.nito.cash/deck. */
const DECK_URL = 'https://blaze.nito.cash/deck.pdf'

/* Source repository (public). */
const REPO_URL = 'https://github.com/APECSdev/nito.cash'

/* Official CashTokens address for EMBER2026 community-choice donations
   (token-aware p2pkh; checksum verified via @bitauth/libauth decode). */
const EMBER_ADDRESS = 'bitcoincash:zzhndl6y6a82gp0376meu4t2q0kwh0pxfy85da4574'

export default {
    data: () => ({
        deckUrl: DECK_URL,
        repoUrl: REPO_URL,
        ember: EMBER_ADDRESS,
        copied: false,
        copiedTimer: null,
        open: true,
    }),
    computed: {
        /* Truncated address for the compact row (full address is copied). */
        emberShort() {
            return this.ember.slice(12, 20) + '…' + this.ember.slice(-6)
        },
    },
    methods: {
        /* Copy the EMBER2026 donation address to the clipboard. */
        copyAddress() {
            const done = () => {
                this.copied = true

                clearTimeout(this.copiedTimer)

                this.copiedTimer = setTimeout(() => {
                    this.copied = false
                }, 1600)
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(this.ember).then(done).catch(() => this.legacyCopy(done))
            } else {
                this.legacyCopy(done)
            }
        },

        /* execCommand fallback for non-secure contexts / older browsers. */
        legacyCopy(done) {
            const ta = document.createElement('textarea')
            ta.value = this.ember
            ta.style.position = 'fixed'
            ta.style.opacity = '0'
            document.body.appendChild(ta)
            ta.select()

            try {
                document.execCommand('copy')
            } finally {
                document.body.removeChild(ta)
            }

            done()
        },
    },
    beforeDestroy() {
        clearTimeout(this.copiedTimer)
    },
}
</script>
