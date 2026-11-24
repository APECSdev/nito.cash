<!-- apps/web/src/views/Concierge/Persona.vue

     The Persona Desk — the Concierge's CashAccounts v2 identity/profile
     manager (the "Persona" tab).

     LIVE: the Resolve card calls the ChainGraph-backed resolver
     (lib/cashaccount/resolver.js). It starts from a real on-chain
     registration, verifies the Genesis Covenant's structural invariant
     (input 0 spends the category funding output at index 0), decodes the
     Identity NFT commitment + profile OP_RETURN, and computes the Collision
     Hash from the registration block.

     MOCKED (phase 1): registration, CashID sign-in and the Nostr publish
     button. Their library modules exist (registration.js, cashid.js,
     nostr.js); the UI only surfaces local notifications until the compiled
     covenant artifact and the pre-broadcast VM gate are in place.

     Tailwind only (Phase D): no scoped CSS, all colours via @theme tokens so
     the light/dark switch keeps working. `shrink-0` is required on every
     `overflow-hidden` child of the fixed-height flex <main> (the Desk's
     flex-shrink collapse).
-->
<template>
    <main class="flex flex-col flex-1 min-h-0 px-[20px] pb-[max(24px,env(safe-area-inset-bottom))] overflow-y-auto [-webkit-overflow-scrolling:touch]">

        <!-- ============================================================
             RIBBON — preview marker + the live-index provenance.
             ============================================================ -->
        <div class="flex items-center justify-between gap-[10px] pt-[10px]">
            <span class="inline-flex items-center gap-[6px] rounded-full bg-secondary px-[10px] py-[3px] text-[9px] font-bold uppercase tracking-[0.18em] text-secondary-fg">
                Preview
            </span>

            <span class="text-[9px] font-semibold uppercase tracking-[0.18em] text-fg-muted">
                Persona desk &middot; CashAccounts v2
            </span>
        </div>

        <!-- ============================================================
             HERO PLAQUE.
             ============================================================ -->
        <section class="shrink-0 mt-[12px] overflow-hidden rounded-[18px] border border-hr border-t-[3px] border-t-secondary bg-box-bg">
            <div class="flex items-start gap-[14px] p-[16px]">
                <!-- Persona glyph (inline: no fingerprint exists in compiled-icons). -->
                <div class="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-secondary text-secondary-fg shadow-[0_10px_24px_-14px_rgba(0,0,0,0.8)]">
                    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
                        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="12" cy="8" r="3.2" />
                        <path d="M5.5 20c0-3.2 2.9-5.8 6.5-5.8s6.5 2.6 6.5 5.8" />
                        <path d="M18.5 4.5a5.5 5.5 0 0 0-9.9 3.4c0 1.2.2 2.3.7 3.3" />
                    </svg>
                </div>

                <div class="min-w-0">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        The Persona Desk
                    </div>

                    <h1 class="mt-[2px] text-[20px] font-bold leading-[26px]">
                        Your name, your keys, your story.
                    </h1>

                    <p class="mt-[5px] text-[12px] leading-[17px] text-fg-muted">
                        A BCH-native identity: an Account Name bound to a mutable
                        Identity NFT, a CashCode for receiving payments, a CashID
                        login and an optional Nostr key. Resolve a live account
                        below; registration, sign-in and publishing are staged.
                    </p>
                </div>
            </div>
        </section>

        <!-- ============================================================
             RESOLVE — the LIVE ChainGraph path.
             ============================================================ -->
        <section class="shrink-0 mt-[12px] overflow-hidden rounded-[18px] border border-hr bg-box-bg">
            <div class="p-[14px]">
                <div class="flex items-center justify-between gap-[10px]">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        Resolve an account
                    </div>

                    <span class="rounded-full bg-frame-border px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.16em] text-fg-muted">
                        ChainGraph &middot; mainnet
                    </span>
                </div>

                <p class="mt-[6px] text-[11px] leading-[16px] text-fg-muted">
                    Paste a Complete or Minimal Identifier, a registration txid,
                    or an Identity NFT category. The resolver checks the
                    registration&rsquo;s Genesis Covenant invariant and pins the
                    category.
                </p>

                <input
                    v-model="query"
                    class="input-base mt-[10px]"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="Kallisti#7B9A &middot; txid &middot; category"
                    @keyup.enter="onResolve" />

                <div class="flex gap-[10px]">
                    <Button
                        label="Resolve"
                        small
                        :loading="status === 'resolving'"
                        @click.native="onResolve" />

                    <Button
                        label="Live example"
                        small
                        blank
                        :disabled="status === 'resolving'"
                        @click.native="loadExample" />
                </div>

                <div v-if="status === 'resolving'" class="mt-[8px] text-[11px] text-fg-muted">
                    Resolving from ChainGraph&hellip;
                </div>

                <div v-if="status === 'error'" class="mt-[8px] text-[11px] text-warning-text">
                    {{ error }}
                </div>
            </div>
        </section>

        <!-- ============================================================
             ACCOUNT CARD — the resolved on-chain record.
             ============================================================ -->
        <section v-if="account" class="shrink-0 mt-[12px] overflow-hidden rounded-[18px] border border-hr bg-box-bg">
            <div class="flex items-start gap-[14px] p-[16px]">
                <div class="grid h-[56px] w-[56px] shrink-0 place-items-center rounded-full bg-secondary text-[30px]">
                    {{ account.identicon ? account.identicon.emoji : '·' }}
                </div>

                <div class="min-w-0 flex-1">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        Resolved &middot; {{ account.network }}
                    </div>

                    <h2 class="mt-[2px] text-[20px] font-bold leading-[26px] break-all">
                        {{ account.identifier }}
                    </h2>

                    <p class="mt-[3px] text-[12px] leading-[17px] text-fg-muted">
                        {{ account.profile.displayName || account.name }}
                        <span v-if="account.identicon"> &middot; {{ account.identicon.name }}</span>
                    </p>

                    <div class="mt-[6px] flex flex-wrap items-center gap-[6px]">
                        <template v-if="account.color">
                            <span class="h-[10px] w-[10px] rounded-full" :style="{ backgroundColor: account.color }"></span>
                            <span class="font-mono text-[10px] text-fg-muted">{{ account.color }}</span>
                        </template>

                        <span class="rounded-full bg-frame-border px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.14em] text-fg-muted">
                            mutable NFT
                        </span>

                        <span v-if="account.pending" class="rounded-full bg-secondary px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.14em] text-secondary-fg">
                            pending
                        </span>
                    </div>
                </div>
            </div>

            <dl class="grid grid-cols-1 gap-[8px] border-t border-hr p-[14px] text-[11px] leading-[16px]">
                <div class="flex gap-[8px]">
                    <dt class="w-[82px] shrink-0 text-fg-muted">Category</dt>
                    <dd class="min-w-0 break-all font-mono text-[10px]">{{ account.category }}</dd>
                </div>

                <div class="flex gap-[8px]">
                    <dt class="w-[82px] shrink-0 text-fg-muted">Registration</dt>
                    <dd class="min-w-0 break-all font-mono text-[10px]">{{ account.txid }}:{{ account.vout }}</dd>
                </div>

                <div v-if="account.block" class="flex gap-[8px]">
                    <dt class="w-[82px] shrink-0 text-fg-muted">Block</dt>
                    <dd class="min-w-0 break-all font-mono text-[10px]">{{ account.block.height }} &middot; {{ account.block.hash }}</dd>
                </div>

                <div class="flex gap-[8px]">
                    <dt class="w-[82px] shrink-0 text-fg-muted">Spend key</dt>
                    <dd class="min-w-0 break-all font-mono text-[10px]" :title="account.spendPubkey">{{ shortKey(account.spendPubkey) }}</dd>
                </div>

                <div class="flex gap-[8px]">
                    <dt class="w-[82px] shrink-0 text-fg-muted">Scan key</dt>
                    <dd class="min-w-0 break-all font-mono text-[10px]" :title="account.scanPubkey">{{ shortKey(account.scanPubkey) }}</dd>
                </div>

                <div class="flex gap-[8px]">
                    <dt class="w-[82px] shrink-0 text-fg-muted">Commitment</dt>
                    <dd class="min-w-0 break-all font-mono text-[10px]">
                        v{{ account.commitment.version }} &middot; prefix {{ account.prefix }} &middot; expiry {{ account.commitment.expiry }}
                    </dd>
                </div>

                <div v-if="account.npub" class="flex gap-[8px]">
                    <dt class="w-[82px] shrink-0 text-fg-muted">npub</dt>
                    <dd class="min-w-0 break-all font-mono text-[10px]">{{ account.npub }}</dd>
                </div>

                <div v-if="account.profile.bio" class="flex gap-[8px]">
                    <dt class="w-[82px] shrink-0 text-fg-muted">Bio</dt>
                    <dd class="min-w-0 text-[11px]">{{ account.profile.bio }}</dd>
                </div>

                <div v-if="account.profile.urls.length" class="flex gap-[8px]">
                    <dt class="w-[82px] shrink-0 text-fg-muted">URLs</dt>
                    <dd class="flex min-w-0 flex-col gap-[2px]">
                        <a v-for="url of account.profile.urls" :key="url" :href="url" target="_blank" rel="noopener"
                            class="break-all text-[11px] text-primary hover:underline">{{ url }}</a>
                    </dd>
                </div>
            </dl>
        </section>

        <!-- ============================================================
             REGISTER — MOCK (phase 1).
             ============================================================ -->
        <section class="shrink-0 mt-[12px] overflow-hidden rounded-[18px] border border-dashed border-hr bg-box-bg">
            <div class="flex items-center justify-between gap-[10px] p-[14px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    Register a name
                </div>

                <span class="rounded-full bg-frame-border px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.16em] text-fg-muted">
                    Soon
                </span>
            </div>

            <div class="px-[14px] pb-[14px]">
                <input
                    v-model="registerName"
                    class="input-base"
                    type="text"
                    maxlength="32"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="Kallisti" />

                <div class="mb-[10px] flex items-baseline gap-[6px]">
                    <span class="text-[10px] uppercase tracking-[0.16em] text-fg-muted">Preview</span>
                    <span class="font-mono text-[13px] font-semibold">{{ registerPreview }}</span>
                </div>

                <p class="text-[11px] leading-[16px] text-fg-muted">
                    The Collision Hash is derived from the block that mines the
                    registration, so the preview reads <span class="font-mono">#FFFF.00</span>
                    until confirmation. Registration lands in phase 1, after the
                    covenant artifact is compiled and VM-validated.
                </p>

                <div class="mt-[10px]">
                    <Button label="Register (soon)" small blank @click.native="mockRegister" />
                </div>
            </div>
        </section>

        <!-- ============================================================
             CASHID — MOCK (phase 1).
             ============================================================ -->
        <section class="shrink-0 mt-[12px] overflow-hidden rounded-[18px] border border-dashed border-hr bg-box-bg">
            <div class="flex items-center justify-between gap-[10px] p-[14px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    Sign in with a CashAccount
                </div>

                <span class="rounded-full bg-frame-border px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.16em] text-fg-muted">
                    Soon
                </span>
            </div>

            <div class="px-[14px] pb-[14px]">
                <p class="text-[11px] leading-[16px] text-fg-muted">
                    The service issues a challenge; the wallet signs the exact
                    response URI with a key tweaked from the account&rsquo;s
                    CashCode spend key. No transaction is broadcast.
                </p>

                <code class="mt-[8px] block break-all rounded-[10px] bg-frame-border px-[10px] py-[8px] font-mono text-[10px] text-fg-muted">
                    cashid:concierge.nito.cash/cashid?x=102132435465768798a9bacbdcedfe0f
                </code>

                <div class="mt-[10px]">
                    <Button label="Sign in (soon)" small blank @click.native="mockCashId" />
                </div>
            </div>
        </section>

        <!-- ============================================================
             NOSTR — MOCK (phase 1).
             ============================================================ -->
        <section class="shrink-0 mt-[12px] mb-[6px] overflow-hidden rounded-[18px] border border-dashed border-hr bg-box-bg">
            <div class="flex items-center justify-between gap-[10px] p-[14px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    Nostr binding
                </div>

                <span class="rounded-full bg-frame-border px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.16em] text-fg-muted">
                    Soon
                </span>
            </div>

            <div class="px-[14px] pb-[14px]">
                <p class="text-[11px] leading-[16px] text-fg-muted">
                    The npub is the last 32 bytes of the Identity NFT commitment.
                    Kind-0 profile events use BIP340; the covenant&rsquo;s
                    ownership proof uses BCH Schnorr with sighash 0x61.
                </p>

                <div v-if="account && account.npub" class="mt-[8px] break-all rounded-[10px] bg-frame-border px-[10px] py-[8px] font-mono text-[10px] text-fg-muted">
                    {{ account.npub }}
                </div>

                <div v-else class="mt-[8px] rounded-[10px] bg-frame-border px-[10px] py-[8px] text-[10px] text-fg-muted">
                    Resolve an account to see its committed npub.
                </div>

                <div class="mt-[10px]">
                    <Button label="Publish profile (soon)" small blank @click.native="mockNostr" />
                </div>
            </div>
        </section>
    </main>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters } from 'vuex'

/* Import components. */
import { Button } from '@/components'

/* Import the pure identifier helpers (no chain). */
import { isValidAccountName, pendingIdentifier } from '@/lib/cashaccount/identifier.js'

/* The live mainnet example: the "Kallisti" registration (ChainGraph). */
const LIVE_EXAMPLE_TXID = '8267bff0bf6532bfd109ecae1062deb88822166333de5ece52d4309371a42878'

export default {
    components: {
        Button,
    },
    data: () => {
        return {
            query: '',
            registerName: '',
        }
    },
    computed: {
        ...mapGetters('cashaccount', [
            'getAccount',
            'getStatus',
            'getError',
        ]),

        account() {
            return this.getAccount
        },
        status() {
            return this.getStatus
        },
        error() {
            return this.getError
        },
        registerPreview() {
            return isValidAccountName(this.registerName)
                ? pendingIdentifier(this.registerName)
                : '—'
        },
    },
    methods: {
        ...mapActions('cashaccount', [
            'resolve',
            'clear',
        ]),

        ...mapActions([
            'displayNotification',
        ]),

        /**
         * Resolve the current query through ChainGraph.
         */
        async onResolve() {
            const value = this.query.trim()

            if (!value) {
                return this.displayNotification('Persona desk · enter an identifier, txid, or category.')
            }

            try {
                await this.resolve({ identifier: value })
            } catch (error) {
                /* The store action already surfaced the error via displayError. */
            }
        },

        /**
         * Load the live Kallisti registration.
         */
        loadExample() {
            this.query = LIVE_EXAMPLE_TXID
            return this.onResolve()
        },

        /**
         * Shorten a public key for the card (the full value is in `title`).
         *
         * @param {string} key
         * @returns {string}
         */
        shortKey(key) {
            return key ? `${key.slice(0, 18)}…${key.slice(-8)}` : ''
        },

        /**
         * Mock the registration path.
         */
        mockRegister() {
            if (!isValidAccountName(this.registerName)) {
                return this.displayNotification('Persona desk · names are 2–32 letters, digits, or underscores.')
            }

            this.displayNotification(`Persona desk · ${pendingIdentifier(this.registerName)} is staged for phase 1. (Nothing was sent.)`)
        },

        /**
         * Mock the CashID path.
         */
        mockCashId() {
            this.displayNotification('Persona desk · CashID sign-in lands in phase 1. (No challenge was issued.)')
        },

        /**
         * Mock the Nostr publish path.
         */
        mockNostr() {
            this.displayNotification('Persona desk · kind-0 publishing lands in phase 1. (No relay was contacted.)')
        },
    },
}
</script>
