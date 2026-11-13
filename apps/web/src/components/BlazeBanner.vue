<template>
    <div class="w-full flex flex-wrap items-baseline justify-center gap-x-[12px] gap-y-[2px] text-center text-[11px] leading-[15px] font-medium bg-primary text-primary-fg border-b border-input-border py-[6px] px-[10px]">
        <span class="text-secondary whitespace-nowrap">★ BCH BLAZE 2026 — private payments on Bitcoin Cash</span>

        <a :href="deckUrl" target="_blank" rel="noopener" class="underline whitespace-nowrap">Deck</a>

        <a :href="repoUrl" target="_blank" rel="noopener" class="underline whitespace-nowrap">Source</a>

        <button
            @click="copyAddress"
            :title="'Click to copy the EMBER2026 donation address'"
            class="underline bg-transparent cursor-pointer break-all text-left"
        >
            {{ copied ? 'copied ✓' : `EMBER2026: ${ember}` }}
        </button>
    </div>
</template>

<script>
/* BCH BLAZE 2026 submission banner (home-page eligibility banner).
   The three required elements per the BLAZE brief: the Widget Factory
   presentation link, the source-repo link, and a CashTokens address for
   EMBER2026 donations (Community Choice voting). */

/* TODO(blaze): swap DECK_URL for the team's published deck copy — this
   currently points at the Widget Factory TEMPLATE (deck not yet made). */
const DECK_URL = 'https://docs.google.com/presentation/d/1Yfuk9CJkf4U9M_WukcELhumWgj3Ak6345Ewy8hSp-Hk/edit'

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
    }),
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
