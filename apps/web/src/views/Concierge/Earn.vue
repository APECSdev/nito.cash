<!-- apps/web/src/views/Concierge/Earn.vue

     MOCKUP — "The Vault Desk" (the Earn wing of the Concierge).

     This screen is a DESIGN MOCKUP: every figure on it is transcribed from
     published research, and NOTHING here contacts a relay, a coordinator or
     the chain. The only side effects are local (`displayNotification`).

     Sources for every claim rendered below (all verified 2026-11-22):
       - CANONICAL: /research/shielded-pool — topic 01 of the 5-topic hub
         ("the Groth16 shielded pool: built, deployed and measured").
         Local source of truth: /Workspace/apecsdev/hushyourmoney
           web/pages/research/shielded-pool.vue (STATS, RESULTS, LIFECYCLE,
           GATES — 866 lines)
           web/pages/research/index.vue:25 (TOPICS entries 01 + 05)
       - /ceremony — topic 05, "The Hush Ceremony" (Gate 7, the multi-party
         trusted setup). Page live; its monitor figures are marked [demo]:
           web/pages/ceremony.vue:23 ("All numbers below marked 'demo' are
           MOCK placeholders until the machine ships").
       - apps/web/src/lib/pool/{merkle,notes,prover,seal}.js  (in-wallet pool
         library — note commitments, nullifiers, client-side prover and the
         AES-256-GCM local seal; shield/transfer/unshield UI is NOT wired).

     PRESERVED from the original Earn screen (1:1 logic parity):
       - the display-only interest counter (`interestInterval`, 100 ms ticks,
         cleared in `beforeUnmount` — the session-20 leak fix),
       - `interestCore` / `interestRunning` computed pair,
       - `addFunds` / `withdrawFunds` (still `console.log` first) and the
         `isInvested` withdraw gate.
     The fake DeFi figures ("4.73%", "$914.20") were placeholders; the counter
     stays, re-labelled as the honest local demo it is.

     Tailwind only (Phase D): no scoped CSS, all colours via @theme tokens so
     the light/dark switch keeps working.
-->
<template>
    <main class="flex flex-col flex-1 min-h-0 px-[20px] pb-[max(24px,env(safe-area-inset-bottom))] overflow-y-auto [-webkit-overflow-scrolling:touch]">

        <!-- ============================================================
             RIBBON — an unmissable "this is a mockup" marker.
             ============================================================ -->
        <div class="flex items-center justify-between gap-[10px] pt-[10px]">
            <span class="inline-flex items-center gap-[6px] rounded-full bg-secondary px-[10px] py-[3px] text-[9px] font-bold uppercase tracking-[0.18em] text-secondary-fg">
                Mockup
            </span>

            <span class="text-[9px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                Vault desk &middot; by appointment
            </span>
        </div>

        <!-- ============================================================
             BRASS PLAQUE — the vault itself.

             NOTE: `shrink-0` is REQUIRED. `main` is a fixed-height flex
             column; when the content overflows, flex-shrink squishes the
             items — and an `overflow-hidden` item collapses to its automatic
             minimum size of ZERO (measured on the Desk: 2px of borders).
             ============================================================ -->
        <section class="shrink-0 mt-[12px] overflow-hidden rounded-[18px] border border-hr border-t-[3px] border-t-secondary bg-box-bg">
            <div class="flex items-start gap-[14px] p-[16px]">
                <!-- Deposit-box dial (inline: no vault glyph exists in compiled-icons). -->
                <div class="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-secondary text-secondary-fg shadow-[0_10px_24px_-14px_rgba(0,0,0,0.8)]">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
                        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z" />
                        <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
                        <path d="M12 12l2.3-2.3" />
                    </svg>
                </div>

                <div class="min-w-0">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        The Vault Desk
                    </div>

                    <h1 class="mt-[2px] text-[20px] font-bold leading-[26px]">
                        Park value where the chain can&rsquo;t read it.
                    </h1>

                    <p class="mt-[5px] text-[12px] leading-[17px] text-fg-muted">
                        The vault is the shielded pool &mdash; a Groth16 joinsplit that hides sender,
                        receiver and amount inside zero-knowledge proofs. Every figure below is
                        transcribed from published research; nothing is deposited, proved or
                        broadcast from this screen.
                    </p>
                </div>
            </div>

            <div class="flex gap-[10px] border-t border-hr p-[14px]">
                <Button
                    @click.native="bookBox"
                    label="Book a deposit box"
                    small />

                <Button
                    @click.native="houseRules = !houseRules"
                    label="House rules"
                    small
                    blank />
            </div>
        </section>

        <!-- ============================================================
             HOUSE RULES — the mockup's disclaimer, in hotel voice.
             ============================================================ -->
        <section v-if="houseRules" class="mt-[10px] rounded-[14px] border border-dashed border-hr bg-box-bg p-[14px]">
            <ul class="flex flex-col gap-[6px] text-[12px] leading-[17px] text-fg-muted">
                <li v-for="(rule, index) of houseRulesList" :key="index" class="flex gap-[8px]">
                    <span class="text-fg-muted">&mdash;</span>
                    <span>{{ rule }}</span>
                </li>
            </ul>
        </section>

        <!-- ============================================================
             VAULT SERVICES — the two featured suites (01 + 05).
             ============================================================ -->
        <div class="mt-[18px] flex items-baseline justify-between gap-[10px]">
            <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                Vault services
            </div>
            <div class="text-[9px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                Suites 01 + 05 &middot; two wings
            </div>
        </div>

        <div class="mt-[8px] flex flex-col gap-[10px]">
            <article
                v-for="service of services"
                :key="service.id"
                class="overflow-hidden rounded-[16px] border border-hr bg-box-bg">

                <div class="flex items-start gap-[10px] p-[14px]">
                    <!-- Door number (the research site's topic number). -->
                    <div class="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] border border-hr text-[13px] font-bold tabular-nums">
                        {{ service.suite }}
                    </div>

                    <div class="min-w-0 flex-1">
                        <div class="flex items-start justify-between gap-[8px]">
                            <h2 class="text-[15px] font-semibold leading-[20px]">
                                {{ service.name }}
                            </h2>

                            <span class="shrink-0 rounded-full px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.12em]" :class="toneClass(service.tone)">
                                {{ service.status }}
                            </span>
                        </div>

                        <p class="mt-[3px] text-[12px] leading-[16px] text-fg-muted">
                            {{ service.tagline }}
                        </p>
                    </div>
                </div>

                <!-- Front-desk card: label/value rows (a hotel key card). -->
                <dl class="border-t border-hr px-[14px] py-[10px] text-[11px] leading-[15px]">
                    <template v-for="fact of service.facts" :key="fact.k">
                        <div class="flex gap-[10px] py-[3px]">
                            <dt class="w-[78px] shrink-0 text-fg-muted">{{ fact.k }}</dt>
                            <dd class="min-w-0 flex-1">{{ fact.v }}</dd>
                        </div>
                    </template>
                </dl>

                <div class="flex gap-[10px] border-t border-hr p-[12px]">
                    <!-- 05: link out to the ceremony page (honest — the
                         ceremony machine is in design, monitor figures are
                         marked [demo] on the page itself). -->
                    <Button
                        v-if="service.id === 'ceremony'"
                        @click.native="openCeremony"
                        :label="service.action"
                        small
                        blank />

                    <Button
                        v-else
                        @click.native="toggleLedger"
                        :label="openLedger === service.id ? 'Close the vault ledger' : service.action"
                        small
                        secondary />
                </div>
            </article>
        </div>

        <!-- ============================================================
             THE VAULT LEDGER — itinerary, register and house boundaries.
             All values are measured numbers from the published research.
             ============================================================ -->
        <section v-if="openLedger === 'pool'" class="mt-[10px] rounded-[16px] border border-hr bg-box-bg">

            <!-- The vault itinerary: one pass through the pool. -->
            <div class="p-[14px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    The vault itinerary
                </div>

                <div class="mt-[3px] text-[12px] leading-[16px] text-fg-muted">
                    One full pass through the pool. Inside it, notes are commitments &mdash;
                    value, owner and history are never visible on-chain.
                </div>

                <ol class="mt-[10px] flex flex-col">
                    <li
                        v-for="step of itinerary"
                        :key="step.n"
                        class="flex items-start gap-[10px] border-t border-hr py-[8px] first:border-t-0 first:pt-0">

                        <span class="w-[18px] shrink-0 text-[11px] font-bold tabular-nums text-fg-muted">
                            {{ step.n }}
                        </span>

                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-[8px]">
                                <span class="text-[13px] font-semibold">{{ step.name }}</span>

                                <span class="rounded-full px-[7px] py-[1px] text-[8px] font-bold uppercase tracking-[0.12em]" :class="toneClass(step.tone)">
                                    {{ step.state }}
                                </span>
                            </div>

                            <p class="mt-[2px] text-[11px] leading-[15px] text-fg-muted">
                                {{ step.detail }}
                            </p>
                        </div>
                    </li>
                </ol>
            </div>

            <!-- House register: the measured numbers. -->
            <div class="border-t border-hr p-[14px]">
                <div class="flex items-baseline justify-between gap-[8px]">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        House register
                    </div>

                    <a
                        href="https://hushyourmoney.com/research/shielded-pool#evidence"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-link">
                        Gate evidence &rarr;
                    </a>
                </div>

                <div class="mt-[8px] flex flex-col gap-[6px] text-[11px] leading-[15px]">
                    <div v-for="row of register" :key="row.k" class="flex gap-[10px]">
                        <div class="w-[86px] shrink-0 font-semibold">{{ row.k }}</div>
                        <div class="min-w-0 flex-1 text-fg-muted">{{ row.v }}</div>
                    </div>
                </div>
            </div>

            <!-- Do not disturb: what the vault does NOT give you. -->
            <div class="border-t border-hr p-[14px]">
                <h6 class="dark">DO NOT DISTURB</h6>

                <ul class="flex flex-col gap-[5px] text-[11px] leading-[15px] text-fg-muted">
                    <li v-for="(item, index) of boundaries" :key="index" class="flex gap-[8px]">
                        <span>&middot;</span>
                        <span>{{ item }}</span>
                    </li>
                </ul>
            </div>

            <!-- In this wallet: the honest wiring state. -->
            <div class="border-t border-hr p-[14px] text-[11px] leading-[15px]">
                <div class="font-semibold">In this wallet</div>

                <p class="mt-[3px] text-fg-muted">
                    The PUSD note library and local sealing are wired (AES-256-GCM via WebCrypto,
                    key derived from the wallet entropy); the shield / transfer / unshield UI is
                    still pending.
                </p>
            </div>

            <!-- The canonical source. -->
            <div class="border-t border-hr p-[14px] text-[11px] leading-[15px]">
                <a
                    href="https://hushyourmoney.com/research/shielded-pool"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-semibold text-fg-link underline decoration-hr underline-offset-2">
                    Read topic 01 (The Shielded Pool) &rarr;
                </a>
            </div>
        </section>

        <!-- ============================================================
             THE HOUSE COUNTER — the original display-only interest
             ticker, preserved (and honestly labelled).
             ============================================================ -->
        <section class="shrink-0 mt-[16px] rounded-[16px] border border-hr bg-box-bg p-[14px]">
            <div class="flex items-baseline justify-between gap-[8px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    The house counter
                </div>

                <span class="rounded-full bg-secondary px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.12em] text-secondary-fg">
                    Display only
                </span>
            </div>

            <div class="mt-[3px] text-[11px] leading-[15px] text-fg-muted">
                All-time Nito community earnings &mdash; a local timer ticks the digits; no bank
                backs this counter and no deposit feeds it.
            </div>

            <div class="mt-[8px] text-[2.0em] tabular-nums leading-[30px]">
                ${{interestCore}}<span class="text-fg-muted">{{interestRunning}}</span>
            </div>
        </section>

        <!-- ============================================================
             TELLER SERVICE — the original Earn actions, still mock.
             ============================================================ -->
        <Footer>
            <Button @click.native="addFunds" label="Add Funds" double secondary />
            <Button @click.native="withdrawFunds" label="Withdraw Funds" double secondary :disabled="!isInvested" />
        </Footer>

        <Footer>
            <p class="text-[11px] leading-[15px] text-fg-muted">
                The vault desk runs on mock data. No note was created, no proof was generated,
                and no coin left this device.
            </p>
        </Footer>
    </main>
</template>

<script>
/* Initialize vuex. */
import { mapActions } from 'vuex'

/* Import components. */
import { Button, Footer } from '@/components'

export default {
    components: {
        Button,
        Footer,
    },
    data: () => {
        return {
            isInvested: false,
            interestAmount: 12.5415397484,
            interestIncrement: 0,

            /* House-rules panel visibility. */
            houseRules: false,

            /* Which suite's ledger is open (null = all closed). */
            openLedger: null,

            /* House rules (mockup disclaimers, hotel voice). */
            houseRulesList: [
                'This desk is a mockup. Every figure is transcribed from published research; no chain is contacted.',
                'Nothing here moves coins: no note is created, no proof is generated, nothing is broadcast.',
                'The house counter ticks from a local timer — no bank backs it, and the vault never asks for your seed phrase.',
            ],

            /* The two featured suites (research topics 01 and 05). */
            services: [
                {
                    id: 'pool',
                    suite: '01a',
                    name: 'The Shielded Pool',
                    tagline: 'A Groth16 joinsplit for CashTokens — built, deployed and measured.',
                    status: 'Chipnet · mainnet demo',
                    tone: 'gold',
                    action: 'Open the vault ledger',
                    facts: [
                        { k: 'Circuit', v: '183,472 constraints · 107 private inputs · 2 public inputs' },
                        { k: 'Verifier', v: '35,626 B — the full on-chain verifier in ONE standard tx' },
                        { k: 'Lifecycle', v: 'SHIELD → TRANSFER → UNSHIELD, all confirmed on chipnet' },
                    ],
                },
                {
                    id: 'ceremony',
                    suite: '05',
                    name: 'The Hush Ceremony',
                    tagline: 'The multi-party trusted setup gating any mainnet deployment of the pool.',
                    status: 'In design',
                    tone: 'muted',
                    action: 'Read about the ceremony',
                    facts: [
                        { k: 'Gate', v: 'Gate 7 — the last gate before mainnet' },
                        { k: 'Today', v: 'Every setup so far was a disclosed 1-of-1 — testnet grade only' },
                        { k: 'Design', v: 'Perpetual Powers-of-Tau; one honest participant is all it takes' },
                    ],
                },
            ],

            /* One pass through the pool (research §lifecycle) — all three
               operations are CONFIRMED chipnet transactions. */
            itinerary: [
                {
                    n: '01', name: 'Shield', state: 'Confirmed', tone: 'gold',
                    detail: '500,000 units of the stand-in asset enter publicly; afterwards the chain sees a note commitment only.',
                },
                {
                    n: '02', name: 'Transfer', state: 'Confirmed', tone: 'gold',
                    detail: 'Shielded → shielded; sender, receiver and amount are invisible. Three chained transfers settled in ONE block (329764), ~36.8 KB each, no public value moved.',
                },
                {
                    n: '03', name: 'Unshield', state: 'Confirmed', tone: 'gold',
                    detail: 'The note is spent and the covenant pays the public leg; the Groth16 proof authorizes it, nullifiers block double-spends, stale roots block replay.',
                },
            ],

            /* Measured results (research STATS + RESULTS tables). */
            register: [
                { k: 'Circuit', v: '183,472 constraints · 107 private inputs · 181,959 wires' },
                { k: 'Multi-asset', v: '186,007 constraints (+1.38%) — Poseidon(6) binds the full 256-bit category' },
                { k: 'Public inputs', v: '2 — [merkleRoot, actionHash]' },
                { k: 'Verifier', v: '35,626 B inside one standard transaction' },
                { k: 'Red team', v: '5/5 valid proofs accepted · 9/9 mutated inputs rejected · 26/26 attack runs rejected' },
                { k: 'Proof time', v: '16.967 s measured on the build runner (hardware spec unmeasured)' },
                { k: 'Pool-op size', v: '~36.8 – 37.8 KB per shielded operation' },
            ],

            /* What the vault does NOT give you (research §limits). */
            boundaries: [
                'The mainnet matrix is DEMO grade — a solo 1-of-1 ceremony with published entropy; production stays gated on Gate 7.',
                'No audits yet; /ceremony is the path to mainnet.',
                'The pool cannot convert value across asset categories — per-category conservation is enforced in-circuit.',
                'Network-layer metadata (IP-linked propagation) is not addressed by the pool.',
            ],
        }
    },
    computed: {
        interestCore() {
            /* Set core amount. */
            // NOTE: Format to 2 decimal places.
            const core = this.interestAmount.toFixed(2)

            /* Return parsed value. */
            return parseFloat(core)
        },

        interestRunning() {
            /* Set running amount. */
            // NOTE: Format to 8 decimal places.
            const running = (this.interestAmount - this.interestCore).toFixed(10)

            /* Calculate display value. */
            const display = parseFloat(running) * 10000000000

            /* Calculate adjusted value. */
            const adjusted = display + this.interestIncrement

            /* Return (adjusted) display value. */
            return adjusted
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
         * Book a Deposit Box (MOCKUP)
         */
        bookBox() {
            this.displayNotification('Vault desk · your deposit box is a mockup — nothing was deposited. (No relay, no chain.)')
        },

        /**
         * Toggle the Vault Ledger
         */
        toggleLedger() {
            this.openLedger = this.openLedger === 'pool' ? null : 'pool'
        },

        /**
         * Open the Ceremony page (topic 05)
         *
         * The ceremony machine is in design (its monitor figures are marked
         * [demo] on the page itself), so the desk hands you the reading.
         */
        openCeremony() {
            window.open('https://hushyourmoney.com/ceremony', '_blank', 'noopener,noreferrer')
        },

        /**
         * Add Funds
         */
        addFunds() {
            console.log('ADDING FUNDS')

            this.displayNotification('Vault desk · mockup — no funds were added to the vault.')
        },

        /**
         * Withdraw Funds
         */
        withdrawFunds() {
            console.log('WITHDRAWING FUNDS')

            this.displayNotification('Vault desk · mockup — the vault holds nothing of yours yet.')
        },

    },
    created: function () {
        /* Start the (display) interest counter. */
        this.interestInterval = setInterval(() => {
            this.interestIncrement++
        }, 100)
    },
    beforeUnmount() {
        /* Stop the (display) interest counter (previously it ticked — and
           leaked — forever, even after leaving the screen). */
        clearInterval(this.interestInterval)
    },
}
</script>
