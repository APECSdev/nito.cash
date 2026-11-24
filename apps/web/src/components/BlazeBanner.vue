<template>
    <!-- Floating overlay badge (bottom-right, above the footer, below modals).
         The `.blaze-layer` hook marks this as an INTENTIONAL overlay layer for
         the text-overlap auditor (overlay-vs-page pairs are by design). -->
    <div class="blaze-layer fixed z-[900] bottom-[58px] right-[10px] md:right-[14px] flex flex-col items-end gap-[6px]">

        <div
            v-show="open"
            class="w-[272px] md:w-[300px] rounded-[14px] border border-white/15 bg-[#0a1020]/92 text-white shadow-[0_12px_32px_rgba(0,0,0,0.4)] backdrop-blur-md p-[12px]"
        >
            <div class="text-[11px] leading-[16px] font-semibold tracking-[0.08em] uppercase text-[#9fd8ff]">
                ★ BCH BLAZE 2026
            </div>

            <div class="text-[11px] leading-[16px] text-white/85 mt-[2px]">
                Private payments on Bitcoin Cash
            </div>

            <div class="mt-[8px] flex flex-col gap-[6px]">
                <div
                    :title="emberTitle"
                    class="flex items-center justify-between rounded-[8px] border border-white/15 px-[10px] py-[6px] text-[11px] leading-[16px]"
                >
                    <span class="text-white/70">Embers received</span>
                    <span class="font-semibold tabular-nums text-[#9fd8ff]">{{ emberLabel }}</span>
                </div>

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
            :title="emberTitle"
            class="rounded-full border border-white/15 bg-[#0a1020]/92 text-white text-[11px] leading-[16px] font-semibold px-[10px] py-[5px] shadow-[0_6px_18px_rgba(0,0,0,0.35)] cursor-pointer"
        >
            ★ BLAZE 2026 {{ open ? '▾' : '▴' }}
            <span class="text-white/70">&middot; 🔥 {{ emberLabel }}</span>
        </button>
    </div>
</template>

<script>
import { getCluster } from '@/lib/bch/provider.js'

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
   (token-aware p2pkh; checksum verified via @bitauth/libauth decode).
   The address is DEDICATED to EMBER2026: every fungible token amount held
   there is an ember, so the badge can sum the token UTXOs directly. */
const EMBER_ADDRESS = 'bitcoincash:zzhndl6y6a82gp0376meu4t2q0kwh0pxfy85da4574'

/* Refresh the on-chain ember count once a minute. */
const EMBER_REFRESH_MS = 60 * 1000

export default {
    data: () => ({
        deckUrl: DECK_URL,
        repoUrl: REPO_URL,
        ember: EMBER_ADDRESS,
        copied: false,
        copiedTimer: null,
        open: true,

        /* Live EMBER2026 tracking (null = not loaded yet). */
        emberCount: null,
        emberLoading: true,
        emberError: false,
        emberTimer: null,
    }),
    computed: {
        /* Truncated address for the compact row (full address is copied). */
        emberShort() {
            return this.ember.slice(12, 20) + '…' + this.ember.slice(-6)
        },

        /* Formatted ember count for the badge + panel row. */
        emberLabel() {
            if (this.emberCount === null) {
                return this.emberLoading ? '…' : '—'
            }

            return this.emberCount.toLocaleString()
        },

        /* Tooltip shared by the badge and the panel row. */
        emberTitle() {
            return this.emberError ? 'Ember tracking unavailable' : 'Embers received: ' + this.emberLabel
        },
    },
    methods: {
        /* Fetch the live EMBER2026 balance at the donation address.
         *
         * Fulcrum's `include_tokens` filter returns token-bearing UTXOs with
         * `token_data.amount` (a decimal string); the address is dedicated to
         * EMBER2026, so the ember count is the sum of every token amount.
         * A failure keeps the last good count (or shows "—" on first load). */
        async refreshEmbers() {
            this.emberLoading = true

            try {
                const cluster = await getCluster('mainnet')
                const utxos = await cluster.getUtxosWithTokens(this.ember)

                let total = 0n

                for (const utxo of utxos || []) {
                    const amount = utxo && utxo.token_data && utxo.token_data.amount

                    if (amount) {
                        total += BigInt(amount)
                    }
                }

                this.emberCount = total
                this.emberError = false
            } catch (e) {
                this.emberError = true
            } finally {
                this.emberLoading = false
            }
        },

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
    mounted() {
        this.refreshEmbers()

        this.emberTimer = setInterval(() => {
            this.refreshEmbers()
        }, EMBER_REFRESH_MS)
    },
    beforeUnmount() {
        clearTimeout(this.copiedTimer)
        clearInterval(this.emberTimer)
    },
}
</script>
