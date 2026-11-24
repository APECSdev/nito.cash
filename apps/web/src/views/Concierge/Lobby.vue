<!-- apps/web/src/views/Concierge/Lobby.vue

     MOCKUP — "The Concierge Desk" (hotel-style front desk).

     This screen is a DESIGN MOCKUP: every figure on it is transcribed from
     published research, and NOTHING here contacts a relay, a coordinator or
     the chain. The only side effects are local (`displayNotification`).

     Sources for every claim rendered below (all verified 2026-11-22):
       - CANONICAL: /research/cashfusion — topic 02 of the 5-topic hub
         ("CashFusion survey + our P2P-over-Nostr research"). The Nostr
         sections keep their anchors: #six-phases, #gate-evidence, #boundary.
         Local source of truth: /Workspace/apecsdev/hushyourmoney
           web/pages/research/cashfusion.vue (893 lines, 18 Nostr mentions)
           web/pages/research/index.vue:25 (TOPICS entry 02)
       - RETIRED STANDALONE PAGE: commit 7b7c417 deleted
         web/pages/research/nostr-fusion.vue (608 lines) and added
         `'/research/nostr-fusion': { redirect: { to: '/research/cashfusion',
          statusCode: 301 } }` (web/nuxt.config.ts:94).
         - http://127.0.0.1:3100/research/nostr-fusion -> 301 /research/cashfusion
           (local dev server runs the CURRENT tree)
         - http://hushyourmoney.com/research/nostr-fusion -> 301 (scheme
           upgrade) -> https://.../research/nostr-fusion -> HTTP 200 with the
           OLD standalone page: PRODUCTION IS STALE vs 7b7c417. Hence the
           links below point at the canonical /research/cashfusion.
         - /research/nostr-relay (the URL first supplied) -> HTTP 404.
       - apps/web/src/lib/pool/{merkle,notes,prover,seal}.js  (in-wallet pool lib)
       - apps/web/src/store/modules/wallets/actions/createWallet.js:19
         (the `(f) Fusion` ACCOUNT STATUS CODE — the only CashFusion mention
          anywhere in apps/web/src; no fusion client is wired)

     DEMO ROUND ("Request a round"): a purely local, timed simulation of a
     five-party fusion round — peers seat one at a time (the 5-participant
     design floor), the six phases light up in sequence, and the table settles
     with the measured G3 numbers (10 in / 10 out · 1,760 B · fee 5,000 sats
     · 10/10 signatures verified). No relay, coordinator or chain is ever
     contacted; every timer is cleared on unmount.

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
                Front desk &middot; open 24h
            </span>
        </div>

        <!-- ============================================================
             BRASS PLAQUE — the desk itself.

             NOTE: `shrink-0` is REQUIRED. `main` is a fixed-height flex
             column; when the content overflows, flex-shrink squishes the
             items — and an `overflow-hidden` item collapses to its automatic
             minimum size of ZERO (measured: 2px of borders). Without this the
             plaque (and the round table below) silently vanish mid-round.
             ============================================================ -->
        <section class="shrink-0 mt-[12px] overflow-hidden rounded-[18px] border border-hr border-t-[3px] border-t-secondary bg-box-bg">
            <div class="flex items-start gap-[14px] p-[16px]">
                <!-- Desk bell (inline: no bell glyph exists in compiled-icons). -->
                <div class="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-secondary text-secondary-fg shadow-[0_10px_24px_-14px_rgba(0,0,0,0.8)]">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
                        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M6 16.5h12a6 6 0 0 0-6-10.5 6 6 0 0 0-6 10.5Z" />
                        <path d="M12 6V3.8" />
                        <path d="M4.2 19.2h15.6" />
                    </svg>
                </div>

                <div class="min-w-0">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        The Concierge Desk
                    </div>

                    <h1 class="mt-[2px] text-[20px] font-bold leading-[26px]">
                        Keys, coinjoins and quiet corners.
                    </h1>

                    <p class="mt-[5px] text-[12px] leading-[17px] text-fg-muted">
                        Tell the desk where you are headed and we will arrange the transport.
                        Every service below is a mockup entry &mdash; nothing is booked, signed or broadcast.
                    </p>
                </div>
            </div>

            <div class="flex gap-[10px] border-t border-hr p-[14px]">
                <Button
                    @click.native="ring"
                    label="Ring for the concierge"
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
             GUEST SERVICES — the two featured suites (02 + 03).
             ============================================================ -->
        <div class="mt-[18px] flex items-baseline justify-between gap-[10px]">
            <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                Guest services
            </div>
            <div class="text-[9px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                Suite 02 &middot; two wings
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

                <div v-if="service.action" class="flex gap-[10px] border-t border-hr p-[12px]">
                    <!-- 02a: link out to the survey (honest — nothing runs in
                         this wallet, so the desk hands you the reading). -->
                    <Button
                        v-if="service.id === 'cashfusion'"
                        @click.native="openSurvey"
                        :label="service.action"
                        small
                        blank />

                    <template v-else>
                        <Button
                            @click.native="toggleDossier(service.id)"
                            :label="openDossier === service.id ? 'Close the dossier' : service.action"
                            small
                            secondary />

                        <Button
                            @click.native="requestRound"
                            :label="requestLabel"
                            :loading="requestState === 'asking'"
                            loading-label="Asking the desk…"
                            small
                            :disabled="requestState === 'round'" />
                    </template>
                </div>
            </article>
        </div>

        <!-- ============================================================
             THE DOSSIER — itinerary, register and house boundaries.
             All values are measured numbers from the published research.
             ============================================================ -->
        <section v-if="openDossier === 'nostr'" class="mt-[10px] rounded-[16px] border border-hr bg-box-bg">

            <!-- Tonight's itinerary: the six-phase round. -->
            <div class="p-[14px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    Tonight&rsquo;s itinerary
                </div>

                <div class="mt-[3px] text-[12px] leading-[16px] text-fg-muted">
                    One round, six phases. The coordinator is the lowest ephemeral
                    pubkey &mdash; there is no server to bribe.
                </div>

                <ol class="mt-[10px] flex flex-col">
                    <li
                        v-for="phase of itinerary"
                        :key="phase.n"
                        class="flex items-start gap-[10px] border-t border-hr py-[8px] first:border-t-0 first:pt-0">

                        <span class="w-[18px] shrink-0 text-[11px] font-bold tabular-nums text-fg-muted">
                            {{ phase.n }}
                        </span>

                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-[8px]">
                                <span class="text-[13px] font-semibold">{{ phase.name }}</span>

                                <span class="rounded-full px-[7px] py-[1px] text-[8px] font-bold uppercase tracking-[0.12em]" :class="toneClass(phase.tone)">
                                    {{ phase.state }}
                                </span>
                            </div>

                            <p class="mt-[2px] text-[11px] leading-[15px] text-fg-muted">
                                {{ phase.detail }}
                            </p>
                        </div>
                    </li>
                </ol>
            </div>

            <!-- House register: the measured gates. -->
            <div class="border-t border-hr p-[14px]">
                <div class="flex items-baseline justify-between gap-[8px]">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        House register
                    </div>

                    <a
                        href="https://hushyourmoney.com/research/cashfusion#gate-evidence"
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

            <!-- Do not disturb: what the round does NOT give you. -->
            <div class="border-t border-hr p-[14px]">
                <h6 class="dark">DO NOT DISTURB</h6>

                <ul class="flex flex-col gap-[5px] text-[11px] leading-[15px] text-fg-muted">
                    <li v-for="(item, index) of boundaries" :key="index" class="flex gap-[8px]">
                        <span>&middot;</span>
                        <span>{{ item }}</span>
                    </li>
                </ul>
            </div>

            <!-- The canonical source (verified live: HTTP 200). -->
            <div class="border-t border-hr p-[14px] text-[11px] leading-[15px]">
                <a
                    href="https://hushyourmoney.com/research/cashfusion#six-phases"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-semibold text-fg-link underline decoration-hr underline-offset-2">
                    Read topic 02 (CashFusion + P2P over Nostr) &rarr;
                </a>
            </div>
        </section>

        <!-- ============================================================
             THE ROUND TABLE (MOCKUP) — appears once a round is requested.
             Peers seat one at a time; the six phases light up in order;
             the table settles with the measured G3 numbers. All local.

             NOTE: `shrink-0` — same flex-shrink collapse as the plaque
             above; the table is the tallest block on this screen.
             ============================================================ -->
        <section v-if="requestState === 'round' || requestState === 'done'" class="shrink-0 mt-[10px] overflow-hidden rounded-[16px] border border-hr bg-box-bg">

            <div class="flex items-center justify-between gap-[10px] border-b border-hr p-[14px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    Table 02b &middot; {{ requestState === 'done' ? 'round settled' : 'round in session' }}
                </div>

                <span class="rounded-full bg-secondary px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.12em] text-secondary-fg">
                    Mockup
                </span>
            </div>

            <!-- Seating: the 5-participant design floor. -->
            <div class="p-[14px]">
                <div class="flex items-baseline justify-between gap-[8px]">
                    <div class="text-[11px] font-semibold">Seating</div>

                    <div class="text-[10px] tabular-nums text-fg-muted">
                        {{roundPeers}}/5 peers
                    </div>
                </div>

                <div class="mt-[6px] flex flex-wrap gap-[6px]">
                    <span
                        v-for="(peer, index) of roundPeerTags.slice(0, roundPeers)"
                        :key="peer"
                        class="inline-flex items-center gap-[4px] rounded-full border border-hr px-[8px] py-[2px] text-[10px]">
                        {{peer}}

                        <span
                            v-if="index === 0"
                            class="rounded-full bg-secondary px-[5px] text-[8px] font-bold uppercase tracking-[0.1em] text-secondary-fg">
                            coordinator
                        </span>
                    </span>

                    <span
                        v-if="roundPeers < 5"
                        class="rounded-full border border-dashed border-hr px-[8px] py-[2px] text-[10px] text-fg-muted">
                        waiting&hellip;
                    </span>
                </div>

                <p class="mt-[6px] text-[10px] leading-[14px] text-fg-muted">
                    The lowest ephemeral pubkey runs the desk — there is no coordinator server to bribe.
                </p>
            </div>

            <!-- The six phases, live. -->
            <div class="border-t border-hr p-[14px]">
                <ol>
                    <li
                        v-for="(phase, index) of itinerary"
                        :key="phase.n"
                        class="flex items-center gap-[10px] border-t border-hr py-[7px] first:border-t-0 first:pt-0">

                        <span class="w-[18px] shrink-0 text-[11px] font-bold tabular-nums text-fg-muted">
                            {{phase.n}}
                        </span>

                        <span
                            class="flex-1 text-[12px] font-semibold"
                            :class="index <= roundPhase ? 'text-fg' : 'text-fg-muted'">
                            {{phase.name}}
                        </span>

                        <span
                            class="rounded-full px-[7px] py-[1px] text-[8px] font-bold uppercase tracking-[0.12em]"
                            :class="toneClass(phaseTone(index))">
                            {{phaseState(index)}}
                        </span>
                    </li>
                </ol>
            </div>

            <!-- Settled: the measured G3 run, transcribed. -->
            <div v-if="requestState === 'done'" class="border-t border-hr p-[14px]">
                <h6 class="dark">ROUND SETTLED</h6>

                <div class="mt-[6px] flex flex-col gap-[4px] text-[11px] leading-[15px]">
                    <div class="flex gap-[10px]">
                        <div class="w-[86px] shrink-0 font-semibold">Inputs</div>
                        <div class="min-w-0 flex-1 text-fg-muted">10 (2 per peer)</div>
                    </div>
                    <div class="flex gap-[10px]">
                        <div class="w-[86px] shrink-0 font-semibold">Outputs</div>
                        <div class="min-w-0 flex-1 text-fg-muted">10 &middot; onion-wrapped</div>
                    </div>
                    <div class="flex gap-[10px]">
                        <div class="w-[86px] shrink-0 font-semibold">Size</div>
                        <div class="min-w-0 flex-1 text-fg-muted">1,760 B</div>
                    </div>
                    <div class="flex gap-[10px]">
                        <div class="w-[86px] shrink-0 font-semibold">Fee</div>
                        <div class="min-w-0 flex-1 text-fg-muted">5,000 sats &le; estBytes &times; 5 sat/B</div>
                    </div>
                    <div class="flex gap-[10px]">
                        <div class="w-[86px] shrink-0 font-semibold">Signatures</div>
                        <div class="min-w-0 flex-1 text-fg-muted">10/10 verified</div>
                    </div>
                </div>

                <p class="mt-[10px] text-[10px] leading-[14px] text-fg-muted">
                    Numbers transcribed from the published G3 run. This table never touched
                    a relay, a peer or the chain &mdash; reset it below.
                </p>

                <div class="mt-[10px] flex gap-[10px]">
                    <Button
                        @click.native="resetRound"
                        label="Reset the demo"
                        small
                        secondary />
                </div>
            </div>
        </section>

        <!-- ============================================================
             ALSO ON THE DESK — the remaining house services.
             ============================================================ -->
        <div class="mt-[18px] text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
            Also on the desk
        </div>

        <div class="mt-[8px] flex flex-col gap-[8px]">
            <div class="flex items-center gap-[10px] rounded-[14px] border border-hr bg-box-bg p-[12px]">
                <div class="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] border border-hr text-[12px] font-bold tabular-nums">
                    01
                </div>

                <div class="min-w-0 flex-1">
                    <div class="text-[13px] font-semibold">Shielded Pool</div>
                    <div class="text-[11px] leading-[15px] text-fg-muted">
                        PUSD note library + local sealing; chipnet covenant deployed, UI wiring pending.
                    </div>
                </div>

                <span class="shrink-0 rounded-full px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.12em]" :class="toneClass('primary')">
                    Chipnet
                </span>
            </div>
        </div>

        <!-- ============================================================
             BELL SERVICE — the original Lobby actions, still unearned.
             ============================================================ -->
        <Footer>
            <Button @click.native="coming" label="Open Chat" double secondary :disabled="!hasPrivilege" />
            <Button @click.native="coming" label="Today's Deals" double secondary :disabled="!hasPrivilege" />
        </Footer>

        <Footer>
            <p class="text-[11px] leading-[15px] text-fg-muted">
                Bell service runs on mock data. No relay was contacted, no round was
                opened, and no coin left this device.
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
            /* Preserved from the original Lobby: the two desk actions stay
               locked until a privilege model exists. */
            hasPrivilege: false,

            /* Which service dossier is open (null = all closed). */
            openDossier: null,

            /* Mock round lifecycle: null -> 'asking' -> 'round' -> 'done'.
               ('asking' shows the spinner; 'round' seats peers + runs the
               phases; 'done' shows the settled card with the G3 numbers.) */
            requestState: null,

            /* Seating count (0..5) and the phase cursor (-1 = seating,
               0..5 = running that itinerary phase, 6 = all complete). */
            roundPeers: 0,
            roundPhase: -1,

            /* Deterministic, clearly-fake ephemeral peer tags (the LOWEST
               pubkey — the first, sorted — becomes the coordinator). */
            roundPeerTags: [
                '0x1c…9f',
                '0x2d…7a',
                '0x3e…b1',
                '0x4a…03',
                '0x5f…e8',
            ],

            /* House-rules panel visibility. */
            houseRules: false,

            /* House rules (mockup disclaimers, hotel voice). */
            houseRulesList: [
                'This desk is a mockup. Every figure is transcribed from published research; no relay is contacted.',
                'Nothing here moves coins: no round is opened, no input is signed, nothing is broadcast.',
                'The front desk never asks for a seed phrase, and neither do we.',
            ],

            /* The two featured suites (research topics 02 and 03). */
            services: [
                {
                    id: 'cashfusion',
                    suite: '02a',
                    name: 'CashFusion',
                    tagline: 'Classic coinjoin, arranged by an outside coordinator.',
                    status: 'Not in this wallet',
                    tone: 'muted',
                    action: 'Read the survey',
                    facts: [
                        { k: 'Coordinator', v: 'External server, trusted for round integrity' },
                        { k: 'Transport', v: 'Tor covert channels to that server' },
                        { k: 'In Nito', v: 'Only the (f) Fusion account status code exists — no client is wired' },
                    ],
                },
                {
                    id: 'nostr',
                    suite: '02b',
                    name: 'CashFusion over Nostr',
                    tagline: 'No coordinator server. Peers self-elect; relays carry sealed mail.',
                    status: 'Research',
                    tone: 'gold',
                    action: 'Open the dossier',
                    facts: [
                        { k: 'Coordinator', v: 'None — the lowest ephemeral pubkey per round' },
                        { k: 'Transport', v: 'NIP-59 gift wrap (kind 1059) + NIP-44 v2 over Nostr relays' },
                        { k: 'Gates', v: 'G1, G2a, G2b, G3, G3L passed · G4 pending' },
                    ],
                },
            ],

            /* The six-phase round (research §3), with its real status. */
            itinerary: [
                {
                    n: '01', name: 'Announce', state: 'Design', tone: 'muted',
                    detail: 'Pool discovery (kind 22230) is design-only; the harness starts from an explicit peer list.',
                },
                {
                    n: '02', name: 'Election', state: 'Implemented', tone: 'gold',
                    detail: 'Peers sort ephemeral pubkeys; the lowest becomes the round coordinator.',
                },
                {
                    n: '03', name: 'Registration', state: 'Implemented', tone: 'gold',
                    detail: 'Each peer gift-wraps its inputs {txid, vout, value} and output count to the coordinator.',
                },
                {
                    n: '04', name: 'Mixnet', state: 'Implemented', tone: 'gold',
                    detail: 'Outputs are onion-wrapped through every peer; each hop peels a layer and shuffles.',
                },
                {
                    n: '05', name: 'Assembly', state: 'Implemented', tone: 'gold',
                    detail: 'Peers check their outputs, sumOut ≤ sumIn and fee ≤ estBytes × 5 sat/B before signing their own inputs.',
                },
                {
                    n: '06', name: 'Broadcast', state: 'Implemented', tone: 'gold',
                    detail: 'The coordinator broadcasts; any peer may also broadcast as a redundant relay.',
                },
            ],

            /* Measured gate results (research §4). */
            register: [
                { k: '5-party', v: '10 in / 10 out · 1,760 B · fee 5,000 sats · 10/10 signatures verified' },
                { k: '7-party', v: '14/14 signatures verified (the 2-party regression re-passed)' },
                { k: 'Chipnet', v: '2 in / 4 out · 428 B · fee 2,000 sats ≈ 4.7 sat/B — accepted on chain' },
                { k: 'Live relays', v: '10/10 signatures over primal.net, nostr.mom, offchain.pub (dry-run)' },
                { k: 'Relay check', v: 'damus.io + nos.lol — 1/2 connected, delivery confirmed' },
            ],

            /* What the round does NOT give you (research §6). */
            boundaries: [
                'NIP-42 AUTH is not implemented, and damus now advertises it.',
                'Token UTXOs are excluded in v1 — plain P2PKH only.',
                'Amounts remain public on chain; that is the shielded pool’s job.',
                'The 5-participant floor is a design constant, not enforced in round.ts.',
                'Live pool discovery (kind 22230) is design-only.',
                'G4 — a mainnet opt-in beta behind a settings flag — is not built.',
                'Free relays throttle bursts: one connection per peer, 80 ms publish pacing.',
            ],
        }
    },
    computed: {
        /* Button label for the mock round request (the service-card button
           flips to a reset once the demo round has settled). */
        requestLabel() {
            if (this.requestState === 'done') {
                return 'Reset the demo'
            }

            return 'Request a round'
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
         * Ring for the Concierge
         */
        ring() {
            this.displayNotification('Front desk · a mock concierge will be with you shortly. (Nothing was sent.)')
        },

        /**
         * Toggle a service dossier
         */
        toggleDossier(_id) {
            this.openDossier = this.openDossier === _id ? null : _id
        },

        /**
         * Open the Survey (topic 02)
         *
         * Classic CashFusion has no client in this wallet, so the desk hands
         * you the reading instead (opens the canonical research page).
         */
        openSurvey() {
            window.open('https://hushyourmoney.com/research/cashfusion', '_blank', 'noopener,noreferrer')
        },

        /**
         * Request a Round (MOCKUP)
         *
         * Simulates the desk "checking availability", then seats a table and
         * runs the six phases. No relay, coordinator or chain call is made —
         * the timers only advance local UI state.
         */
        requestRound() {
            /* Ignore re-taps while the desk is already asking/seating. */
            if (this.requestState === 'asking' || this.requestState === 'round') {
                return
            }

            /* A settled demo resets from the same button. */
            if (this.requestState === 'done') {
                this.resetRound()

                return
            }

            /* Flip to the asking state. */
            this.requestState = 'asking'

            /* The desk accepts the request and opens the table. */
            this.roundTimer = setTimeout(() => {
                this.openRound()
            }, 900)
        },

        /**
         * Open the Round (MOCKUP)
         *
         * Seats the five peers one at a time (the 5-participant design
         * floor), then advances the six itinerary phases on a timer and
         * settles the table with the measured G3 numbers.
         */
        openRound() {
            /* Reset the table state. */
            this.requestState = 'round'
            this.roundPeers = 0
            this.roundPhase = -1

            this.displayNotification('Front desk · seating a table of five (mockup — no relay contacted).')

            /* Seat the peers one at a time. */
            this.peerTimer = setInterval(() => {
                this.roundPeers++

                /* Once the table is full, run the phases. */
                if (this.roundPeers === 5) {
                    clearInterval(this.peerTimer)

                    this.phaseTimer = setInterval(() => {
                        this.roundPhase++

                        /* All six phases complete — settle the table. */
                        if (this.roundPhase >= 6) {
                            clearInterval(this.phaseTimer)

                            this.requestState = 'done'

                            this.displayNotification('Round settled · mockup only — nothing was signed or broadcast.')
                        }
                    }, 1300)
                }
            }, 400)
        },

        /**
         * Reset the Round (MOCKUP)
         *
         * Clears every demo timer and returns the desk to its resting state.
         */
        resetRound() {
            clearTimeout(this.roundTimer)
            clearInterval(this.peerTimer)
            clearInterval(this.phaseTimer)

            this.requestState = null
            this.roundPeers = 0
            this.roundPhase = -1
        },

        /**
         * Phase Tone (MOCKUP)
         *
         * Done phases earn the gold chip; the phase in session runs blue;
         * queued phases stay muted.
         */
        phaseTone(_index) {
            if (_index < this.roundPhase) {
                return 'gold'
            } else if (_index === this.roundPhase) {
                return 'primary'
            }

            return 'muted'
        },

        /**
         * Phase State (MOCKUP)
         *
         * Human label matching `phaseTone` above.
         */
        phaseState(_index) {
            if (_index < this.roundPhase) {
                return 'Done'
            } else if (_index === this.roundPhase) {
                return 'In session'
            }

            return 'Queued'
        },

        /**
         * Coming Soon (preserved from the original Lobby)
         */
        coming() {
            console.log('COMING SOON...')
        },
    },
    beforeUnmount() {
        /* Stop every demo timer (never leave a pending timer behind — the
           Splash/Earn timer leaks were exactly this bug). */
        clearTimeout(this.roundTimer)
        clearInterval(this.peerTimer)
        clearInterval(this.phaseTimer)
    },
}
</script>
