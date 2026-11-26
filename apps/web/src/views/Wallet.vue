<template>
    <Modal :label="wallet.name" :help="true">

        <!-- 2x2 wallet switcher: rows = Cash / Vault, cols = Nito / Naked. -->
        <div class="mx-[20px] mt-[12px] grid grid-cols-2 gap-[8px]">
            <button
                v-for="w of wallets"
                :key="w.id"
                @click="switchWallet(w.id)"
                class="rounded-[8px] px-[6px] py-[8px] text-[14px] font-semibold leading-[20px] border"
                :class="w.id === wallet.id
                    ? 'bg-primary text-primary-fg border-transparent'
                    : 'bg-box-bg text-muted border-input-border'"
            >
                {{w.name}}
                <div class="text-[12px] font-medium leading-[13px]" :class="w.id === wallet.id ? 'text-white/95' : 'text-muted'">
                    {{w.privacy === 'nito' ? 'shielded' : 'transparent'}} · {{w.kind}}
                </div>
            </button>
        </div>

        <div class="flex-1 pt-[24px] px-[20px] pb-0">

            <!-- ==================== NITO CASH (shielded stablecoins) ==================== -->
            <div v-if="wallet.id === 'nito-cash'">
                <!-- Chipnet-only banner (the view also runs on MAINNET, where
                     real BCH is held — the banner must NOT render there). -->
                <div v-if="getNetwork === 'chipnet'" class="text-[15px] font-semibold text-warning-text text-center">
                    Chipnet development preview — no real value
                </div>

                <div class="text-[16px] font-semibold text-fg text-center mt-[24px]">
                    Shielded balance
                </div>

                <div class="text-[32px] font-semibold text-fg text-center mt-[8px]">
                    {{shieldedBalance}} <small class="text-[16px] font-semibold">PUSD</small>
                </div>

                <div class="text-[13px] font-semibold text-muted text-center mt-[8px]">
                    {{getNoteCount}} note(s) · {{getLeaves.length}} tree leaf(s)
                </div>

                <!-- Note list -->
                <div v-for="note of getNotes" :key="note.nf"
                    class="mt-[12px] text-[13px] font-semibold text-muted">
                    <span v-if="note.spent">(spent) </span>
                    {{note.value}} PUSD · cm {{shorten(note.cm)}}
                </div>

                <!-- Your shielded payment address — the DELIVERY POINT the
                     receive-side note detection decrypts against (lib/pool/
                     carrier.js). Share it out-of-band; the PoC has no
                     on-chain registry yet. -->
                <div class="mt-[16px]">
                    <div class="text-[12px] font-semibold text-muted">
                        Your Nito Cash address (delivery point)
                    </div>
                    <div class="flex items-center justify-between gap-[8px] mt-[4px]">
                        <div class="text-[12px] font-medium text-muted break-all px-[8px]">
                            {{deliveryPointHex || '—'}}
                        </div>
                        <Button v-if="deliveryPointHex" @click.native="copyDeliveryPoint"
                            :label="deliveryPointCopied ? 'Copied \u2713' : 'Copy'" />
                    </div>
                </div>

                <!-- Role-2 tagged pool (the current pool): blank inventory,
                     vending machine, and the proving-asset gate. -->
                <div v-if="role2Pool" class="mt-[16px] p-[14px] rounded-[8px] bg-box-bg">
                    <div class="text-[13px] font-semibold text-fg">
                        {{role2Pool.name}}
                    </div>
                    <div class="mt-[6px] flex items-center justify-between text-[12px] font-semibold text-muted">
                        <span>Blanks held</span>
                        <span class="text-fg">{{poolBlankInfo ? poolBlankInfo.blanks : '—'}}</span>
                    </div>
                    <div class="mt-[4px] flex items-center justify-between text-[12px] font-semibold text-muted">
                        <span>Actions remaining</span>
                        <span class="text-fg">{{poolBlankInfo ? poolBlankInfo.actions : '—'}}</span>
                    </div>
                    <div class="mt-[4px] flex items-center justify-between text-[12px] font-semibold text-muted">
                        <span>Vending price</span>
                        <span class="text-fg">{{role2Pool.vending.priceSats}} sats / blank</span>
                    </div>
                    <div class="mt-[4px] text-[11px] font-medium text-muted break-all">
                        Machine {{role2Pool.vending.lockingBytecode}}
                    </div>
                    <p v-if="!role2Pool.walletProverCompatible" class="mt-[8px] text-[12px] font-semibold text-warning-text leading-[18px]">
                        Awaiting the Hush proving assets — the web-platform chipnet SHIELD → TRANSFER → UNSHIELD acceptance is pending.
                    </p>
                </div>

                <!-- Action flow (blocker #4): scan → witness → prove → verify
                     → build → broadcast, against a wallet-prover-compatible
                     pool (registry.js getProverPool). -->
                <div v-if="activeAction" class="mt-[24px] p-[14px] rounded-[8px] bg-box-bg">
                    <div class="text-[15px] font-semibold text-fg">
                        {{activeAction}}
                    </div>

                    <p class="text-[13px] leading-[20px] text-muted mt-[8px]">
                        {{actionDescription}}
                    </p>

                    <label class="block mt-[12px] text-[12px] font-semibold text-muted">
                        Amount (PUSD base units)
                    </label>
                    <input v-model="actionAmount" type="text" inputmode="numeric"
                        :disabled="actionBusy"
                        placeholder="e.g. 1000"
                        class="mt-[4px] w-full rounded-[8px] border border-input-border bg-input-bg px-[10px] py-[8px] text-[14px] font-semibold text-fg" />

                    <template v-if="activeAction === 'Transfer'">
                        <label class="block mt-[12px] text-[12px] font-semibold text-muted">
                            Recipient Nito Cash address (their delivery point)
                        </label>
                        <input v-model="transferTo" type="text" spellcheck="false"
                            :disabled="actionBusy"
                            placeholder="64 hex characters"
                            class="mt-[4px] w-full rounded-[8px] border border-input-border bg-input-bg px-[10px] py-[8px] text-[12px] font-semibold text-fg break-all" />
                    </template>

                    <p v-if="actionError" class="mt-[10px] text-[12px] font-semibold text-warning-text">
                        {{actionError}}
                    </p>

                    <div class="mt-[12px]">
                        <Button v-if="role2Pool && role2Pool.walletProverCompatible" :label="submitButtonLabel" :disabled="actionBusy" @click.native="submitAction" />
                        <p v-else class="text-[12px] font-semibold text-warning-text leading-[18px]">
                            Awaiting the role-2 web-platform acceptance — the pool is byte-exact at the witness level, but the registry flag flips only after the browser SHIELD → TRANSFER → UNSHIELD run.
                        </p>
                    </div>

                    <div v-if="actionResult" class="mt-[10px] text-[12px] font-semibold text-muted break-all">
                        Broadcast — txid {{actionResult}}
                    </div>
                </div>
            </div>

            <!-- ==================== NAKED CASH (transparent stablecoins) ==================== -->
            <div v-else-if="wallet.id === 'naked-cash'">
                <div class="text-[16px] font-semibold text-fg text-center mt-[8px]">
                    Transparent stablecoins
                </div>

                <div class="text-[32px] font-semibold text-fg text-center mt-[8px]">
                    {{pusdBalance}} <small class="text-[16px] font-semibold">PUSD</small>
                </div>

                <div class="text-[13px] font-semibold text-muted text-center mt-[8px]">
                    {{pusdNote}}
                </div>

                <!-- Asset list -->
                <div v-for="asset of wallet.assets" :key="asset.symbol"
                    class="mt-[14px] flex items-center justify-between text-[14px] font-semibold">
                    <span class="text-fg">{{asset.symbol}} <small class="text-muted font-medium">{{asset.label}}</small></span>
                    <span :class="asset.status === 'active' ? 'text-muted' : 'text-warning-text'">
                        {{asset.status === 'active' ? 'available' : asset.status}}
                    </span>
                </div>
            </div>

            <!-- ==================== NITO VAULT (shielded cash-tokens) ==================== -->
            <div v-else-if="wallet.id === 'nito-vault'">
                <div class="text-[15px] font-semibold text-warning-text text-center">
                    Coming soon
                </div>

                <div class="text-[16px] font-semibold text-fg text-center mt-[24px]">
                    Shielded cash-tokens
                </div>

                <p class="text-[13px] leading-[20px] text-muted text-center mt-[12px]">
                    Nito Cash shields ONE asset (PUSD) for the PoC. Nito Vault generalizes the
                    same note + nullifier + Groth16 design to ANY CashToken — the circuit
                    carries the asset category as a witness and the covenant holds multiple
                    categories. See the Nito Vault design doc.
                </p>
            </div>

            <!-- ==================== NAKED VAULT (transparent holdings) ==================== -->
            <div v-else-if="wallet.id === 'naked-vault'">
                <div class="text-[16px] font-semibold text-fg text-center mt-[8px]">
                    Transparent holdings
                </div>

                <div class="text-[32px] font-semibold text-fg text-center mt-[8px]">
                    {{bchDisplay}} <small class="text-[16px] font-semibold">BCH</small>
                </div>

                <!-- SOL balance (derived from the same seed; send lands next) -->
                <div v-if="solAddress" class="text-[24px] font-semibold text-fg text-center mt-[10px]">
                    {{solBalance === null ? '\u2014' : solBalance}} <small class="text-[14px] font-semibold">SOL</small>
                </div>

                <div v-if="solAddress" class="text-[12px] font-medium text-muted text-center mt-[6px] break-all px-[8px]">
                    {{solAddress}}
                </div>

                <!-- Asset list -->
                <div v-for="asset of wallet.assets" :key="asset.symbol"
                    class="mt-[14px] flex items-center justify-between text-[14px] font-semibold">
                    <span class="text-fg">{{asset.symbol}} <small class="text-muted font-medium">{{asset.label}}</small></span>
                    <span :class="asset.status === 'active' ? 'text-muted' : 'text-warning-text'">
                        {{asset.status === 'active' ? 'available' : asset.status}}
                    </span>
                </div>
            </div>

        </div>

        <!-- Per-wallet actions. -->
        <Footer v-if="wallet.id === 'nito-cash'">
            <Button @click.native="toggleAction('Shield')" label="Shield" />
            <Button @click.native="toggleAction('Transfer')" label="Transfer" />
            <Button @click.native="toggleAction('Unshield')" label="Unshield" />
        </Footer>

        <Footer v-else-if="wallet.id === 'naked-vault'">
            <Button @click.native="loadReceive" label="Receive" double />
            <Button @click.native="loadSend" label="Send" double />
        </Footer>

    </Modal>
</template>

<script>
/* Initialize vuex. */
import { mapGetters } from 'vuex'

/* Import components. */
import { Button, Footer, Modal } from '@/components'

/* Import the wallet registry. */
import { WALLETS, getWallet } from '@/lib/wallets'

/* Import the network CashToken registry. */
import { getTokenCategory } from '@/lib/bch/networks'

/* Import the shielded-pool registry + the pool key material (the same
   domain-separated key the scan + action flows use). */
import { getPools, getProverPool } from '@/lib/pool/registry.js'
import { blankSummary } from '@/lib/pool/blanks'
import { getCluster } from '@/lib/bch/provider'
import { deriveSpendKey } from '@/lib/pool/notes'
import { deriveDeliveryPoint } from '@/lib/pool/carrier'
import { bytesToHex, hexToBytes } from '@/lib/bch/crypto'

/* Import Solana account derivation + balance. */
import { solanaAccountFromEntropy, fetchSolBalance } from '@/lib/solana'

export default {
    components: {
        Button,
        Footer,
        Modal,
    },
    data: () => {
        return {
            wallets: WALLETS,
            activeAction: null,
            bchBalance: null,
            pusdBalanceRaw: null,
            solAddress: '',
            solBalance: null,
            /* Shielded action flow state (blocker #4). */
            actionAmount: '',
            transferTo: '',
            actionBusy: false,
            actionError: null,
            actionResult: null,
            deliveryPointHex: '',
            deliveryPointCopied: false,
            poolBlankInfo: null,
        }
    },
    computed: {
        ...mapGetters('pool', [
            'getNotes',
            'getNoteCount',
            'getLeaves',
            'getShieldedBalance',
        ]),

        ...mapGetters('wallets', [
            'getBalance',
            'getTokenBalance',
            'getAddresses',
        ]),

        ...mapGetters('profile', [
            'getMasterSeed',
            'getNetwork',
        ]),

        /* The active wallet, from the `/wallets/:walletId` route param. */
        wallet() {
            return getWallet(this.$route.params.walletId)
        },

        /* The shielded balance, formatted (or a placeholder while locked). */
        shieldedBalance() {
            const b = this.getShieldedBalance
            return b === null ? '—' : Number(b).toLocaleString()
        },

        /* The transparent PUSD balance, formatted for display (raw base units). */
        pusdBalance() {
            return this.pusdBalanceRaw === null ? '\u2014' : this.pusdBalanceRaw.toLocaleString()
        },

        /* The Naked Vault BCH display: EXACT BCH with at least 4 decimals,
           up to 8 (sats-derived values are exact within 8 decimals). The
           old display showed getFormattedValue's `value` — a bits/mBCH
           number — under a "BCH" label (wrong units AND truncated to 1
           decimal). `bchBalance` now holds RAW SATOSHIS. */
        bchDisplay() {
            if (this.bchBalance === null) {
                return '—'
            }

            const s = (this.bchBalance / 100000000).toFixed(8)

            /* Trim trailing zeros but never below 4 decimals. */
            let t = s
            while (t.endsWith('0') && (t.length - t.indexOf('.') - 1) > 4) {
                t = t.slice(0, -1)
            }
            return t
        },

        /* A short note under the PUSD balance. */
        pusdNote() {
            return getTokenCategory(this.getNetwork, 'PUSD')
                ? 'raw base units \u00b7 decimals TBD'
                : `PUSD not tracked on ${this.getNetwork}`
        },

        /* The registry's wallet-prover-compatible pool for the ACTIVE
           network (null → the action flows stay disabled; registry.js —
           both deployed pools are flagged false today). */
        proverPool() {
            return getProverPool(this.getNetwork)
        },

        /* The role-2 tagged pool (the current target; its flag is false
           until the Hush proving assets arrive). */
        role2Pool() {
            return getPools(this.getNetwork).find((pool) => pool.id === 'chipnet-pusd-role2') || null
        },

        /* The active action's submit-button label (busy state included). */
        submitButtonLabel() {
            return this.actionBusy
                ? 'Working — proving takes ~20s…'
                : `${this.activeAction} PUSD`
        },

        /* A one-line description of the active shield/transfer/unshield flow. */
        actionDescription() {
            switch (this.activeAction) {
            case 'Shield':
                return 'Move PUSD from Naked Cash into the shielded pool. The deposit amount is visible on-chain; from then on your balance and transfers are private.'
            case 'Transfer':
                return 'Send PUSD privately to another Nito Cash address. Sender, receiver and amount are all hidden.'
            case 'Unshield':
                return 'Withdraw PUSD back to Naked Cash. The withdrawal amount is visible on-chain.'
            default:
                return ''
            }
        },
    },
    methods: {
        /* Switch the active wallet (route param drives the view). */
        switchWallet(id) {
            this.activeAction = null
            this.$router.replace(`/wallets/${id}`)
        },

        /* Toggle a shield / transfer / unshield flow (transient state reset). */
        toggleAction(action) {
            this.activeAction = this.activeAction === action ? null : action
            this.actionError = null
            this.actionResult = null
        },

        /* Submit the active flow (blocker #4) — local PRE-validation only;
           every runtime failure surfaces through the store's displayError
           toasts (the sendCrypto pattern). */
        async submitAction() {
            if (!this.role2Pool || this.role2Pool.walletProverCompatible !== true || this.actionBusy) return

            const amount = String(this.actionAmount || '').trim()

            if (!/^\d+$/.test(amount)) {
                this.actionError = 'Enter a whole amount (PUSD base units).'
                return
            }

            if (this.activeAction === 'Transfer' &&
                !/^[0-9a-fA-F]{64}$/.test(String(this.transferTo || '').trim().replace(/^0x/, ''))) {
                this.actionError = "Enter the recipient's 64-hex-character delivery point."
                return
            }

            this.actionError = null
            this.actionBusy = true
            this.actionResult = null

            try {
                const result = await this.$store.dispatch('pool/submitRole2Action', {
                    action: this.activeAction.toLowerCase(),
                    amount,
                    recipientDeliveryPoint: this.activeAction === 'Transfer' ? this.transferTo : undefined,
                })

                this.actionResult = result.actionTxid
            } catch (err) {
                /* The store displayed the error; keep the panel ready for a retry. */
                console.error('Pool action failed:', err) // eslint-disable-line no-console
            } finally {
                this.actionBusy = false
            }
        },

        /* Copy the delivery point (the SeedVault copy idiom). */
        copyDeliveryPoint() {
            if (!this.deliveryPointHex) return

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(this.deliveryPointHex).catch(() => {})
            }

            this.deliveryPointCopied = true

            setTimeout(() => { this.deliveryPointCopied = false }, 2000)
        },

        /* Shorten a field element for display. */
        shorten(field) {
            const s = String(field)
            return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s
        },

        /* Load the (existing) Receive screen. */
        loadReceive() {
            this.$router.push('/receive')
        },

        /* Load the (existing) Send screen. */
        loadSend() {
            this.$router.push('/send')
        },
    },
    created: async function () {
        /* NOTE: each fetch below is guarded INDEPENDENTLY — one failing
           call (e.g. a flaky CoinGecko/Solana RPC) must not skip or zero
           the OTHER balances (a thrown getBalance previously left BOTH
           the BCH and PUSD displays at their zero/init values). */

        /* Retrieve the current BCH balance (for Naked Vault) — RAW satoshis
           (the display formats them exactly; see bchDisplay). */
        try {
            const balance = await this.getBalance('BCH', 'USD')
            this.bchBalance = balance ? balance.satoshis : null
        } catch (err) {
            console.error('BCH balance fetch failed:', err) // eslint-disable-line no-console
            this.bchBalance = null
        }

        /* Retrieve the transparent PUSD (CashToken) balance (for Naked Cash),
           if the active network tracks a PUSD category. */
        const category = getTokenCategory(this.getNetwork, 'PUSD')
        if (category) {
            try {
                this.pusdBalanceRaw = await this.getTokenBalance('BCH', category)
            } catch (err) {
                console.error('PUSD balance fetch failed:', err) // eslint-disable-line no-console
                this.pusdBalanceRaw = null
            }
        }

        /* Derive the Solana account (same seed) and fetch its balance
           (for Naked Vault). Only once a wallet exists (master seed set). */
        if (this.getMasterSeed) {
            const solAccount = solanaAccountFromEntropy(this.getMasterSeed)
            this.solAddress = solAccount.address

            try {
                this.solBalance = await fetchSolBalance(solAccount.address)
            } catch (err) {
                console.error('SOL balance fetch failed:', err) // eslint-disable-line no-console
                this.solBalance = null
            }
        }

        /* Role-2 blank inventory: fetch the wallet's token UTXOs and count
           the exact blank shape (pool category + mutable NFT + empty
           commitment + 0 FT). 2 blanks per lock. */
        if (this.role2Pool && this.getMasterSeed) {
            try {
                const addresses = (this.getAddresses('nito-cash') || []).map((a) => a.address)
                const cluster = await getCluster(this.getNetwork)
                const utxos = (await Promise.all(addresses.map((address) => cluster.getUtxosWithTokens(address)))).flat()
                this.poolBlankInfo = blankSummary(utxos, this.role2Pool.assetCategory)
            } catch (err) {
                console.error('Blank inventory fetch failed:', err) // eslint-disable-line no-console
                this.poolBlankInfo = null
            }
        }

        /* Derive the pool DELIVERY POINT (the shielded payment address —
           lib/pool/carrier.js) from the SAME domain-separated pool key the
           scan + action flows use. Guarded independently like every other
           created() fetch. */
        if (this.getMasterSeed) {
            try {
                const spendKey = deriveSpendKey(hexToBytes(this.getMasterSeed))

                this.deliveryPointHex = bytesToHex(await deriveDeliveryPoint(spendKey))
            } catch (err) {
                console.error('Delivery point derivation failed:', err) // eslint-disable-line no-console
                this.deliveryPointHex = ''
            }
        }
    },
}
</script>
