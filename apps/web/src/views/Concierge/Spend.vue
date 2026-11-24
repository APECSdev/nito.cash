<!-- apps/web/src/views/Concierge/Spend.vue

     MOCKUP — "The Courier Desk" (the Spend wing of the Concierge).

     This screen is a MIX of one REAL feature and design-mockup suites:
       - REAL: the paste-drop ("Payment Processor"). Pasting an encoded
         payment request parses it LOCALLY (store getter `getParsedInfo`),
         shows the parsed outputs in the Concierge popup, and hands the
         receiver to the Send screen via the `to` query parameter. No
         network call is made.
       - MOCKUP: the two "quiet delivery" suites (03 + 04). Every figure on
         them is transcribed from published research and NOTHING here
         contacts a relay, a coordinator or the chain. The only side
         effects are local (`displayNotification`).

     Sources for every mockup claim rendered below (all verified 2026-11-22):
       - CANONICAL: /research/shielded-addresses — topic 03 of the 5-topic
         hub (ECDH one-time P2PKH addresses; a survey of the EXTERNAL
         00-Wallet implementation — "not our implementation, and we claim
         no credit for it"). Local source of truth:
           /Workspace/apecsdev/hushyourmoney
           web/pages/research/shielded-addresses.vue (STEALTH_FACTS + the
           "where it meets the pool" panel — 160 lines)
       - CANONICAL: /research/coinjoin — topic 04 ("the technique":
         collaborative transactions; "privacy by ambiguity — many parties,
         one transaction, no map"; live on BCH today through CashFusion).
           web/pages/research/coinjoin.vue (110 lines)
           web/pages/research/index.vue:25 (TOPICS entries 03 + 04)

     PRESERVED from the original Spend screen (1:1 logic parity):
       - the ENTIRE paste flow: `handlePastedNote` (with every debug log),
         `acceptNote`, the Concierge confirmation popup and its bindings,
       - `shopping` / `giving` / `loadAdvancedSpending` (still `console.log`
         first), `hasFunds`, and the `getParsedInfo` / `getFormattedValue`
         getter mappings.
     The lorem-ipsum filler and the "Welcome to the SPEND Center!" banner
     were placeholders; the paste-drop stays, front and centre.

     Tailwind only (Phase D): no scoped CSS, all colours via @theme tokens so
     the light/dark switch keeps working.
-->
<template>
    <main class="flex flex-col flex-1 min-h-0 px-[20px] pb-[max(24px,env(safe-area-inset-bottom))] overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <Concierge
            :active="showConcierge"
            v-on:confirm="acceptNote"
            v-on:cancel="showConcierge = false"
        >
            <h3>Accept the recommendation?</h3>

            <p v-if="parsedNote && parsedNote.outputs">
                <span v-for="(output, index) of parsedNote.outputs" :key="index">
                    Send {{output.value}} to {{output.address}}<br />
                </span>
            </p>
            <p v-else>No payment details could be parsed from the pasted data.</p>
        </Concierge>

        <!-- ============================================================
             RIBBON — an unmissable "this is a mockup" marker (the
             paste-drop below it is the real part of this screen).
             ============================================================ -->
        <div class="flex items-center justify-between gap-[10px] pt-[10px]">
            <span class="inline-flex items-center gap-[6px] rounded-full bg-secondary px-[10px] py-[3px] text-[9px] font-bold uppercase tracking-[0.18em] text-secondary-fg">
                Mockup
            </span>

            <span class="text-[9px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                Courier desk &middot; same-day delivery
            </span>
        </div>

        <!-- ============================================================
             BRASS PLAQUE — the courier desk itself.

             NOTE: `shrink-0` is REQUIRED. `main` is a fixed-height flex
             column; when the content overflows, flex-shrink squishes the
             items — and an `overflow-hidden` item collapses to its automatic
             minimum size of ZERO (measured on the Desk: 2px of borders).
             ============================================================ -->
        <section class="shrink-0 mt-[12px] overflow-hidden rounded-[18px] border border-hr border-t-[3px] border-t-secondary bg-box-bg">
            <div class="flex items-start gap-[14px] p-[16px]">
                <!-- Paper plane (inline: no plane glyph exists in compiled-icons). -->
                <div class="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-secondary text-secondary-fg shadow-[0_10px_24px_-14px_rgba(0,0,0,0.8)]">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
                        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M21 4L3 11l6 2.5L11.5 20 15 14.5 21 4Z" />
                        <path d="M9 13.5L21 4" />
                    </svg>
                </div>

                <div class="min-w-0">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        The Courier Desk
                    </div>

                    <h1 class="mt-[2px] text-[20px] font-bold leading-[26px]">
                        Pay without leaving a forwarding address.
                    </h1>

                    <p class="mt-[5px] text-[12px] leading-[17px] text-fg-muted">
                        The paste-drop below is REAL &mdash; it parses a payment request locally and
                        hands it to the Send screen. The quiet-delivery suites beneath it are
                        mockup entries transcribed from published research.
                    </p>
                </div>
            </div>

            <div class="flex gap-[10px] border-t border-hr p-[14px]">
                <Button
                    @click.native="ringCourier"
                    label="Ring for the courier"
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
             THE PASTE-DROP — the REAL feature this screen ships.
             ============================================================ -->
        <div class="shrink-0 mt-[16px] rounded-[16px] border border-hr bg-box-bg p-[14px]">
            <div class="flex items-baseline justify-between gap-[8px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    The paste-drop
                </div>

                <span class="rounded-full bg-primary px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.12em] text-primary-fg">
                    Real &middot; parses locally
                </span>
            </div>

            <label>Payment Processor</label>
            <small>Copy encoded data from your payment source, then paste it in the form field below <em>(eg. Invoice, Flipstarter campaign, etc).</em></small>
            <div class="w-full h-[3px] mt-[10px] mb-[10px] bg-[rgba(255,255,255,0.7)]" />
            <textarea
                placeholder="Enter your payment details here"
                type="text"
                v-model="note"
                @paste="handlePastedNote"
                class="input-base h-[65px] inline-block align-middle py-[5px] px-[15px]"
            />
        </div>

        <Footer>
            <Button @click.native="shopping" label="Shopping" double :disabled="!hasFunds" />
            <Button @click.native="giving" label="Giving" double :disabled="!hasFunds" />
        </Footer>

        <!-- ============================================================
             QUIET DELIVERY SERVICES — the two featured suites (03 + 04).
             ============================================================ -->
        <div class="mt-[18px] flex items-baseline justify-between gap-[10px]">
            <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                Quiet delivery services
            </div>
            <div class="text-[9px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                Suites 03 + 04 &middot; two wings
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
                    <!-- 04: link out to the survey (honest — the technique is
                         live on BCH through CashFusion, not built here). -->
                    <Button
                        v-if="service.id === 'coinjoin'"
                        @click.native="openCoinjoin"
                        :label="service.action"
                        small
                        blank />

                    <Button
                        v-else
                        @click.native="toggleDossier"
                        :label="openDossier === service.id ? 'Close the dossier' : service.action"
                        small
                        secondary />
                </div>
            </article>
        </div>

        <!-- ============================================================
             THE DOSSIER — the stealth-address scheme, register and house
             boundaries. All values are cited from the published survey.
             ============================================================ -->
        <section v-if="openDossier === 'stealth'" class="mt-[10px] rounded-[16px] border border-hr bg-box-bg">

            <!-- The scheme, as implemented (cited: topic 1773). -->
            <div class="p-[14px]">
                <div class="flex items-baseline justify-between gap-[8px]">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        The scheme, as implemented
                    </div>

                    <a
                        href="https://bitcoincashresearch.org/t/ecdh-stealth-addresses-on-bitcoin-cash-implementation-code/1773"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-[9px] font-semibold uppercase tracking-[0.12em] text-fg-link">
                        Report &rarr;
                    </a>
                </div>

                <div class="mt-[8px] flex flex-col gap-[6px] text-[11px] leading-[15px]">
                    <div v-for="row of scheme" :key="row.k" class="flex gap-[10px]">
                        <div class="w-[86px] shrink-0 font-semibold">{{ row.k }}</div>
                        <div class="min-w-0 flex-1 text-fg-muted">{{ row.v }}</div>
                    </div>
                </div>
            </div>

            <!-- Where it meets the pool: the design direction. -->
            <div class="border-t border-hr p-[14px] text-[11px] leading-[15px]">
                <div class="font-semibold">Where it meets the pool</div>

                <p class="mt-[3px] text-fg-muted">
                    Pool notes commit to an owner public key &mdash; Poseidon(value, ownerPub, rho,
                    r). A stealth-derived one-time key is a natural fit for ownerPub: a payer
                    could route value to a recipient&rsquo;s note without ever learning a reusable
                    address. Status: design direction, NOT built yet.
                </p>
            </div>

            <!-- Do not disturb: what the scheme does NOT give you. -->
            <div class="border-t border-hr p-[14px]">
                <h6 class="dark">DO NOT DISTURB</h6>

                <ul class="flex flex-col gap-[5px] text-[11px] leading-[15px] text-fg-muted">
                    <li v-for="(item, index) of boundaries" :key="index" class="flex gap-[8px]">
                        <span>&middot;</span>
                        <span>{{ item }}</span>
                    </li>
                </ul>
            </div>

            <!-- The canonical source. -->
            <div class="border-t border-hr p-[14px] text-[11px] leading-[15px]">
                <a
                    href="https://hushyourmoney.com/research/shielded-addresses"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-semibold text-fg-link underline decoration-hr underline-offset-2">
                    Read topic 03 (Shielded Addresses) &rarr;
                </a>
            </div>
        </section>

        <!-- ============================================================
             COURIER SERVICE — the original Spend actions, still mock.
             ============================================================ -->
        <Footer>
            <Button @click.native="loadAdvancedSpending" label="Advanced Spending" />
        </Footer>

        <Footer>
            <p class="text-[11px] leading-[15px] text-fg-muted">
                The courier desk runs on mock data. The paste-drop parses locally; no relay was
                contacted and no coin left this device.
            </p>
        </Footer>
    </main>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters } from 'vuex'

/* Import components. */
import { Button, Concierge, Footer } from '@/components'

export default {
    components: {
        Button,
        Concierge,
        Footer,
    },
    data: () => {
        return {
            note: null,
            hasFunds: true,
            showConcierge: false,
            parsedNote: null,

            /* House-rules panel visibility. */
            houseRules: false,

            /* Which service dossier is open (null = all closed). */
            openDossier: null,

            /* House rules (mockup disclaimers, hotel voice). */
            houseRulesList: [
                'The suites on this screen are a mockup. Every figure is transcribed from published research; no chain is contacted.',
                'Nothing here hides a payment by itself: no output is mixed, no key is derived, nothing is broadcast.',
                'The paste-drop is real and parses locally — the courier never asks for your seed phrase.',
            ],

            /* The two featured suites (research topics 03 and 04). */
            services: [
                {
                    id: 'stealth',
                    suite: '03',
                    name: 'Shielded Addresses',
                    tagline: 'A fresh one-time P2PKH address per payment — receiver privacy, no new opcodes.',
                    status: 'External survey',
                    tone: 'muted',
                    action: 'Open the dossier',
                    facts: [
                        { k: 'Scheme', v: 'ECDH stealth: P_stealth = B + c·G → a standard P2PKH address' },
                        { k: 'Tweak', v: 'c = SHA256( SHA256(ECDH_x) ‖ outpoint ) — unique per transaction' },
                        { k: 'Status', v: 'External implementation (00-Wallet) — surveyed here, not built in Nito' },
                    ],
                },
                {
                    id: 'coinjoin',
                    suite: '04',
                    name: 'CoinJoin',
                    tagline: 'Many strangers, one transaction, no map.',
                    status: 'Live on BCH',
                    tone: 'gold',
                    action: 'Read the survey',
                    facts: [
                        { k: 'Technique', v: 'Collaborative transaction — privacy by ambiguity, not cryptography' },
                        { k: 'On BCH', v: 'Live today through CashFusion' },
                        { k: 'Where it ends', v: 'Amounts stay public; privacy rests on heuristic resistance' },
                    ],
                },
            ],

            /* The scheme facts (research STEALTH_FACTS — cited topic 1773). */
            scheme: [
                { k: 'Keys', v: "m/44'/145'/0'/2'/0 → scan (a, A) · …/2'/1 → spend (b, B) — same BIP44 seed" },
                { k: 'Tweak', v: 'c = SHA256( SHA256(ECDH_x) ‖ outpoint ) — unique nonce per transaction' },
                { k: 'Address', v: 'P_stealth = B + c·G → RIPEMD160(SHA256(P_stealth)) — a standard P2PKH address' },
                { k: 'Scan', v: 'Receiver computes ECDH(a, sender_pub) per transaction, derives the expected address, matches outputs' },
            ],

            /* What the suite does NOT give you (research §survey). */
            boundaries: [
                'Not our implementation — the desk claims no credit for it.',
                'The pool integration is a design direction, not built yet.',
                'Open questions: derivation inside the note protocol vs. at the wallet layer, and the scan UX for note detection.',
            ],
        }
    },
    computed: {
        ...mapGetters('concierge', [
            'getParsedInfo',
        ]),

        ...mapGetters('utils', [
            'getFormattedValue',
        ]),

    },
    methods: {
        ...mapActions([
            'displayError',
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
         * Ring for the Courier (MOCKUP)
         */
        ringCourier() {
            this.displayNotification('Courier desk · a mock courier will be with you shortly. (Nothing was sent.)')
        },

        /**
         * Toggle the Stealth Dossier
         */
        toggleDossier() {
            this.openDossier = this.openDossier === 'stealth' ? null : 'stealth'
        },

        /**
         * Open the CoinJoin survey (topic 04)
         *
         * The technique is live on BCH through CashFusion, not built in this
         * wallet, so the desk hands you the reading instead.
         */
        openCoinjoin() {
            window.open('https://hushyourmoney.com/research/coinjoin', '_blank', 'noopener,noreferrer')
        },

        shopping() {
            console.log('SHOPPING')

            this.displayNotification('Courier desk · mockup — no shopping run was arranged.')
        },

        giving() {
            console.log('GIVING')

            this.displayNotification('Courier desk · mockup — no donation was arranged.')
        },

        /**
         * Load Advanced Spending Screen
         */
        loadAdvancedSpending() {
            this.$router.push('concierge/spend/advanced')
        },

        /**
         * Handle Pasted Note
         */
        handlePastedNote() {
            /* Wait a bit for pasted data to register. */
            setTimeout(() => {
                console.log('Pasted Note', this.note) // eslint-disable-line no-console

                /* Retrieve note from the Concierge. */
                const note = this.getParsedInfo(this.note)

                console.log('NOTE (from Concierge)', note) // eslint-disable-line no-console

                const outputs = note && note.outputs
                console.log('NOTE (outputs)', outputs) // eslint-disable-line no-console

                const output = outputs && outputs[0]

                const value = output && output.value
                console.log('NOTE (output.value)', value) // eslint-disable-line no-console

                const address = output && output.address
                console.log('NOTE (output.address)', address) // eslint-disable-line no-console

                const data = note && note.data
                console.log('NOTE (data)', data) // eslint-disable-line no-console

                const donation = note && note.donation
                console.log('NOTE (donation)', donation) // eslint-disable-line no-console

                const expires = note && note.expires
                console.log('NOTE (expires)', expires) // eslint-disable-line no-console

                /* Validate (parsed) note. */
                if (!output) {
                    return this.displayError('Could not parse the pasted payment details.')
                }

                /* Keep the (parsed) note + show the (confirmation) popup. */
                this.parsedNote = note
                this.showConcierge = true
            }, 10)
        },

        /**
         * Accept (parsed) Note
         *
         * Hands the parsed payment details to the Send screen (the receiver
         * is prefilled via the `to` query parameter).
         */
        acceptNote() {
            /* Hide the (confirmation) popup. */
            this.showConcierge = false

            /* Retrieve (primary) output. */
            const output = this.parsedNote && this.parsedNote.outputs
                ? this.parsedNote.outputs[0]
                : null

            /* Validate (primary) output. */
            if (!output || !output.address) {
                return this.displayError('No payment address in the pasted details.')
            }

            /* Load the Send screen (prefilled receiver). */
            this.$router.push({ path: 'send', query: { to: output.address } })
        },

    },
}
</script>
