<!-- apps/web/src/views/Concierge/Desk/Quantumroot.vue

     PREVIEW — the Quantumroot guest service (the desk's NEW orchestration).

     Sources (all transcribed from the published developer preview):
       - https://blog.bitjson.com/quantumroot/  (Jason Dreyzehner, 2025-07-01)
         · 256-bit classical / 128-bit quantum security (Grover), SHA256 only.
         · LM-OTS (RFC 8554): 2,144-byte signature, ~2.5 KB unlock per signer.
         · Introspection aggregation: 71 B per additional UTXO; 15% smaller
           per additional input after 8 UTXOs.
         · 400+ unique addresses or 800+ inputs in one <100 KB transaction.
         · CashToken-based delegation, privacy nonces, 30+ quantum signers.
         · Developer preview; not yet reviewed/audited; targeting BCH May 2026.
       - https://github.com/bitjson/quantumroot  (the reference implementation)
       - https://ide.bitauth.com/import-gist/60e779f718515b83fb80706e078acdb3

     NOTHING here derives, signs or broadcasts: the orchestration is a local
     timed preview and the only side effect is a displayNotification toast.

     Tailwind only (Phase D): no scoped CSS, all colours via @theme tokens so
     the light/dark switch keeps working.
-->
<template>
    <div class="flex flex-col shrink-0">

        <!-- Back to the guest-services landing. -->
        <div class="flex items-center justify-between gap-[10px] pt-[10px]">
            <Button
                @click="$emit('back')"
                label="← Guest services"
                small
                blank />

            <span class="text-[9px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                Desk &middot; Guest services
            </span>
        </div>

        <!-- The service plaque. -->
        <section class="shrink-0 mt-[12px] overflow-hidden rounded-[18px] border border-hr border-t-[3px] border-t-secondary bg-box-bg">
            <div class="flex items-start gap-[14px] p-[16px]">
                <!-- Vault glyph: a Merkle root over two leaves. -->
                <div class="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-secondary text-secondary-fg shadow-[0_10px_24px_-14px_rgba(0,0,0,0.8)]">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
                        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 3.2 19 7v10l-7 3.8L5 17V7l7-3.8Z" />
                        <path d="M12 12v8.8" />
                        <path d="M5 7l7 5 7-5" />
                    </svg>
                </div>

                <div class="min-w-0">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        Guest service &middot; 01
                    </div>

                    <div class="mt-[2px] flex items-start justify-between gap-[8px]">
                        <h1 class="text-[20px] font-bold leading-[26px]">
                            Quantumroot
                        </h1>

                        <span class="shrink-0 rounded-full px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.12em]" :class="toneClass('gold')">
                            New orchestration
                        </span>
                    </div>

                    <p class="mt-[5px] text-[12px] leading-[17px] text-fg-muted">
                        Quantum-secure vaults for Bitcoin Cash. A Merkle-root vault with a pre-quantum
                        Schnorr leaf and a post-quantum LM-OTS leaf &mdash; SHA256 only, no new cryptography.
                    </p>
                </div>
            </div>

            <div class="flex flex-wrap items-center gap-[10px] border-t border-hr p-[14px]">
                <Button
                    @click="runPreview"
                    :label="previewLabel"
                    :loading="previewState === 'running'"
                    loading-label="Orchestrating…"
                    small
                    :disabled="previewState === 'running'" />

                <span class="text-[10px] leading-[14px] text-fg-muted">
                    Preview &middot; nothing derived, signed or broadcast
                </span>
            </div>
        </section>

        <!-- ============================================================
             THE ORCHESTRATION — derive -> fund -> sweep.
             A local timed preview; every step is a transcription of the
             published design, never a chain action.
             ============================================================ -->
        <section class="shrink-0 mt-[10px] overflow-hidden rounded-[16px] border border-hr bg-box-bg">
            <div class="flex items-center justify-between gap-[10px] border-b border-hr p-[14px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    The orchestration
                </div>

                <span class="rounded-full px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.12em]" :class="toneClass(previewTone)">
                    {{ previewState === 'done' ? 'Preview complete' : previewState === 'running' ? 'In session' : 'Idle' }}
                </span>
            </div>

            <ol class="p-[14px]">
                <li
                    v-for="(step, index) of steps"
                    :key="step.n"
                    class="flex items-start gap-[10px] border-t border-hr py-[9px] first:border-t-0 first:pt-0">
                    <span class="w-[18px] shrink-0 text-[11px] font-bold tabular-nums text-fg-muted">
                        {{ step.n }}
                    </span>

                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-[8px]">
                            <span class="text-[13px] font-semibold">{{ step.name }}</span>

                            <span class="rounded-full px-[7px] py-[1px] text-[8px] font-bold uppercase tracking-[0.12em]" :class="toneClass(stepTone(index))">
                                {{ stepState(index) }}
                            </span>
                        </div>

                        <p class="mt-[2px] text-[11px] leading-[15px] text-fg-muted">
                            {{ step.detail }}
                        </p>
                    </div>
                </li>
            </ol>

            <div v-if="previewState === 'done'" class="border-t border-hr p-[14px]">
                <p class="text-[10px] leading-[14px] text-fg-muted">
                    The vault is ready for a quantum sweep: one Leaf Spend proves the vault, matching
                    UTXOs use 71-byte introspection spends, and 400+ addresses or 800+ inputs fit in
                    a single &lt;100 KB transaction. This preview never touched the chain.
                </p>
            </div>
        </section>

        <!-- ============================================================
             VAULT RECORD — the published figures and the honest gaps.
             ============================================================ -->
        <section class="shrink-0 mt-[10px] overflow-hidden rounded-[16px] border border-hr bg-box-bg">
            <div class="p-[14px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    Vault record
                </div>

                <div class="mt-[8px] flex flex-col gap-[6px] text-[11px] leading-[15px]">
                    <div v-for="row of facts" :key="row.k" class="flex gap-[10px]">
                        <div class="w-[86px] shrink-0 font-semibold">{{ row.k }}</div>
                        <div class="min-w-0 flex-1 text-fg-muted">{{ row.v }}</div>
                    </div>
                </div>
            </div>

            <div class="border-t border-hr p-[14px]">
                <h6 class="dark">DO NOT DISTURB</h6>

                <ul class="flex flex-col gap-[5px] text-[11px] leading-[15px] text-fg-muted">
                    <li v-for="(item, index) of boundaries" :key="index" class="flex gap-[8px]">
                        <span>&middot;</span>
                        <span>{{ item }}</span>
                    </li>
                </ul>
            </div>

            <div class="border-t border-hr p-[14px] text-[11px] leading-[15px]">
                <a
                    href="https://blog.bitjson.com/quantumroot/"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-semibold text-fg-link underline decoration-hr underline-offset-2">
                    Read the Quantumroot developer preview &rarr;
                </a>
            </div>
        </section>
    </div>
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
            /* Mock orchestration lifecycle: null -> 'running' -> 'done'. */
            previewState: null,

            /* Which orchestration step is in session (-1 = idle). */
            previewStep: -1,

            /* The three-stage Quantumroot orchestration (published design). */
            steps: [
                {
                    n: '01', name: 'Derive',
                    detail: 'The vault root commits to a Schnorr leaf and an LM-OTS quantum leaf; receive addresses are shared as P2SH32.',
                },
                {
                    n: '02', name: 'Fund',
                    detail: 'Receive addresses accept BCH; the vault’s CashToken sits in the Quantum Lock, known only to the vault.',
                },
                {
                    n: '03', name: 'Sweep',
                    detail: 'One Leaf Spend proves the vault; matching UTXOs use 71-byte introspection spends. Up to 400+ addresses or 800+ inputs fit in <100 KB.',
                },
            ],

            /* Published developer-preview figures. */
            facts: [
                { k: 'Security', v: '256-bit classical · 128-bit quantum (Grover)' },
                { k: 'Primitive', v: 'SHA256 only — no new cryptography' },
                { k: 'Signature', v: 'LM-OTS (RFC 8554) · 2,144-byte signature · ~2.5 KB unlock per signer' },
                { k: 'Aggregation', v: '71 B per additional UTXO · 15% smaller per input after 8 UTXOs' },
                { k: 'Sweep', v: '400+ unique addresses or 800+ inputs in one <100 KB transaction' },
                { k: 'Delegation', v: 'CashToken-based · privacy nonces · 30+ quantum signers' },
                { k: 'Status', v: 'Developer preview (2025-07-01) · not yet reviewed/audited · targeting the May 2026 upgrade' },
            ],

            /* What this developer preview does NOT give you. */
            boundaries: [
                'The template has not yet been reviewed by anyone else; security audits are planned before practical deployments.',
                'LM-OTS is one-time: each quantum leaf is used once.',
                'The 2026 CHIPs (Loops, Functions, P2S, Bitwise) are required for the preview’s size reductions.',
                'This wallet does not implement Quantumroot yet; the desk is a preview.',
                'The canonical implementation is CashAssembly + Libauth; no chain call is made here.',
            ],
        }
    },
    computed: {
        /* The run/reset label for the orchestration preview. */
        previewLabel() {
            return this.previewState === 'done' ? 'Reset the preview' : 'Run the preview'
        },

        /* The header chip tone. */
        previewTone() {
            if (this.previewState === 'done') {
                return 'gold'
            } else if (this.previewState === 'running') {
                return 'primary'
            }

            return 'muted'
        },
    },
    methods: {
        ...mapActions([
            'displayNotification',
        ]),

        /**
         * Tone → Tailwind classes
         *
         * NOTE: the class strings are literal here (not built by string
         *       concatenation) so Tailwind's source scan emits them.
         */
        toneClass(_tone) {
            if (_tone === 'gold') {
                return 'bg-secondary text-secondary-fg'
            } else if (_tone === 'primary') {
                return 'bg-primary text-primary-fg'
            }

            return 'bg-tab-bg text-fg-muted'
        },

        /**
         * Run the orchestration preview (MOCKUP)
         *
         * Advances the three stages on a local timer. No key is derived, no
         * vault is funded and no sweep is built — the only side effect is the
         * final displayNotification toast.
         */
        runPreview() {
            /* A finished preview resets from the same button. */
            if (this.previewState === 'done') {
                this.resetPreview()

                return
            }

            /* Ignore re-taps while the preview is already running. */
            if (this.previewState === 'running') {
                return
            }

            this.previewState = 'running'
            this.previewStep = 0

            this.previewTimer = setInterval(() => {
                /* Last stage done — settle the preview. */
                if (this.previewStep >= this.steps.length - 1) {
                    clearInterval(this.previewTimer)
                    this.previewTimer = null

                    this.previewState = 'done'

                    this.displayNotification('Quantumroot · orchestration preview complete (nothing was derived, signed or broadcast).')

                    return
                }

                this.previewStep++
            }, 900)
        },

        /**
         * Reset the orchestration preview (MOCKUP)
         *
         * Clears the timer and returns the card to its resting state.
         */
        resetPreview() {
            clearInterval(this.previewTimer)
            this.previewTimer = null

            this.previewState = null
            this.previewStep = -1
        },

        /**
         * Step Tone (MOCKUP)
         *
         * Done steps earn the gold chip; the step in session runs blue;
         * queued steps stay muted.
         */
        stepTone(_index) {
            if (this.previewState === 'done' || _index < this.previewStep) {
                return 'gold'
            } else if (this.previewState === 'running' && _index === this.previewStep) {
                return 'primary'
            }

            return 'muted'
        },

        /**
         * Step State (MOCKUP)
         *
         * Human label matching `stepTone` above.
         */
        stepState(_index) {
            if (this.previewState === 'done' || _index < this.previewStep) {
                return 'Done'
            } else if (this.previewState === 'running' && _index === this.previewStep) {
                return 'In session'
            }

            return 'Queued'
        },
    },
    beforeUnmount() {
        /* Never leave the orchestration timer behind (the Splash/Earn timer
           leaks were exactly this bug). */
        clearInterval(this.previewTimer)
    },
}
</script>
