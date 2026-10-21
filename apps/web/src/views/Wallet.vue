<template>
    <Modal :label="wallet.name" :help="true">

        <!-- 2x2 wallet switcher: rows = Cash / Vault, cols = Nito / Naked. -->
        <div class="mx-[20px] mt-[12px] grid grid-cols-2 gap-[8px]">
            <button
                v-for="w of wallets"
                :key="w.id"
                @click="switchWallet(w.id)"
                class="rounded-[8px] px-[6px] py-[8px] text-[12px] font-semibold leading-[16px] border"
                :class="w.id === wallet.id
                    ? 'bg-primary text-primary-fg border-transparent'
                    : 'bg-box-bg text-secondary border-input-border'"
            >
                {{w.name}}
                <div class="text-[10px] font-medium leading-[13px] opacity-70">
                    {{w.privacy === 'nito' ? 'shielded' : 'transparent'}} · {{w.kind}}
                </div>
            </button>
        </div>

        <div class="flex-1 pt-[24px] px-[20px] pb-0">

            <!-- ==================== NITO CASH (shielded stablecoins) ==================== -->
            <div v-if="wallet.id === 'nito-cash'">
                <div class="text-[13px] font-semibold text-warning text-center">
                    Chipnet development preview — no real value
                </div>

                <div class="text-[16px] font-semibold text-trinary text-center mt-[24px]">
                    Shielded balance
                </div>

                <div class="text-[32px] font-semibold text-trinary text-center mt-[8px]">
                    {{shieldedBalance}} <small class="text-[16px] font-semibold">PUSD</small>
                </div>

                <div class="text-[11px] font-semibold text-secondary text-center mt-[8px]">
                    {{getNoteCount}} note(s) · {{getLeaves.length}} tree leaf(s)
                </div>

                <!-- Note list -->
                <div v-for="note of getNotes" :key="note.nf"
                    class="mt-[12px] text-[11px] font-semibold text-secondary">
                    <span v-if="note.spent">(spent) </span>
                    {{note.value}} PUSD · cm {{shorten(note.cm)}}
                </div>

                <!-- Action flow scaffold (client-side proving lands next). -->
                <div v-if="activeAction" class="mt-[24px] p-[14px] rounded-[8px] bg-box-bg">
                    <div class="text-[13px] font-semibold text-trinary">
                        {{activeAction}}
                    </div>

                    <p class="text-[11px] leading-[16px] text-secondary mt-[8px]">
                        {{actionDescription}}
                    </p>

                    <div class="mt-[12px]">
                        <Button :label="activeAction + ' — proving lands next'" :disabled="true" />
                    </div>
                </div>
            </div>

            <!-- ==================== NAKED CASH (transparent stablecoins) ==================== -->
            <div v-else-if="wallet.id === 'naked-cash'">
                <div class="text-[16px] font-semibold text-trinary text-center mt-[8px]">
                    Transparent stablecoins
                </div>

                <div class="text-[32px] font-semibold text-trinary text-center mt-[8px]">
                    {{pusdBalance}} <small class="text-[16px] font-semibold">PUSD</small>
                </div>

                <div class="text-[11px] font-semibold text-secondary text-center mt-[8px]">
                    {{pusdNote}}
                </div>

                <!-- Asset list -->
                <div v-for="asset of wallet.assets" :key="asset.symbol"
                    class="mt-[14px] flex items-center justify-between text-[12px] font-semibold">
                    <span class="text-trinary">{{asset.symbol}} <small class="text-secondary font-medium">{{asset.label}}</small></span>
                    <span :class="asset.status === 'active' ? 'text-secondary' : 'text-warning'">
                        {{asset.status === 'active' ? 'available' : asset.status}}
                    </span>
                </div>
            </div>

            <!-- ==================== NITO VAULT (shielded cash-tokens) ==================== -->
            <div v-else-if="wallet.id === 'nito-vault'">
                <div class="text-[13px] font-semibold text-warning text-center">
                    Coming soon
                </div>

                <div class="text-[16px] font-semibold text-trinary text-center mt-[24px]">
                    Shielded cash-tokens
                </div>

                <p class="text-[11px] leading-[16px] text-secondary text-center mt-[12px]">
                    Nito Cash shields ONE asset (PUSD) for the PoC. Nito Vault generalizes the
                    same note + nullifier + Groth16 design to ANY CashToken — the circuit
                    carries the asset category as a witness and the covenant holds multiple
                    categories. See the Nito Vault design doc.
                </p>
            </div>

            <!-- ==================== NAKED VAULT (transparent holdings) ==================== -->
            <div v-else-if="wallet.id === 'naked-vault'">
                <div class="text-[16px] font-semibold text-trinary text-center mt-[8px]">
                    Transparent holdings
                </div>

                <div class="text-[32px] font-semibold text-trinary text-center mt-[8px]">
                    {{bchBalance}} <small class="text-[16px] font-semibold">BCH</small>
                </div>

                <!-- Asset list -->
                <div v-for="asset of wallet.assets" :key="asset.symbol"
                    class="mt-[14px] flex items-center justify-between text-[12px] font-semibold">
                    <span class="text-trinary">{{asset.symbol}} <small class="text-secondary font-medium">{{asset.label}}</small></span>
                    <span :class="asset.status === 'active' ? 'text-secondary' : 'text-warning'">
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
            bchBalance: 0,
            pusdBalanceRaw: null,
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
        ]),

        ...mapGetters('profile', [
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

        /* A short note under the PUSD balance. */
        pusdNote() {
            return getTokenCategory(this.getNetwork, 'PUSD')
                ? 'raw base units \u00b7 decimals TBD'
                : `PUSD not tracked on ${this.getNetwork}`
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

        /* Toggle a shield / transfer / unshield flow scaffold. */
        toggleAction(action) {
            this.activeAction = this.activeAction === action ? null : action
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
        /* Retrieve the current BCH balance (for Naked Vault). */
        const balance = await this.getBalance('BCH', 'USD')
        this.bchBalance = balance ? balance.value : 0

        /* Retrieve the transparent PUSD (CashToken) balance (for Naked Cash),
           if the active network tracks a PUSD category. */
        const category = getTokenCategory(this.getNetwork, 'PUSD')
        if (category) {
            this.pusdBalanceRaw = await this.getTokenBalance('BCH', category)
        }
    },
}
</script>
