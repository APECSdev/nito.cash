<template>
    <main class="flex-1 flex flex-col items-center pt-[40px] px-[16px] pb-[20px] h-full overflow-y-auto">
        <h1 class="text-center text-[22px] leading-[26px] font-semibold text-trinary">
            Connect your wallet
        </h1>

        <p class="text-center text-[12px] leading-[17px] text-secondary mt-[6px] max-w-[420px]">
            Scan the QR with a WizardConnect-compatible wallet (Selene, Paytaca, …) to make
            a Bitcoin Cash <strong class="font-semibold">mainnet</strong> payment from your
            own wallet — your keys never leave it.
        </p>

        <!-- Not connected: the connect surface. -->
        <section v-if="state !== 'connected'" class="mt-[26px] flex flex-col items-center">
            <Button
                @click.native="connect"
                label="Connect Wallet"
                :disabled="state === 'connecting' || state === 'reconnecting'"
            />

            <p v-if="state === 'connecting'" class="text-[12px] text-secondary mt-[10px]">
                Waiting for your wallet to scan…
            </p>
            <p v-if="state === 'reconnecting'" class="text-[12px] text-secondary mt-[10px]">
                Reconnecting to your wallet…
            </p>
            <p v-if="error" class="text-[12px] text-warning mt-[10px] max-w-[420px] text-center">{{ error }}</p>
        </section>

        <!-- Connected: the payment surface. -->
        <section v-else class="w-full max-w-[440px] mt-[20px] flex flex-col">
            <div class="text-[11px] text-secondary">Connected wallet</div>
            <div class="text-[16px] font-semibold text-trinary">{{ walletName || 'Wallet' }}</div>
            <div v-if="payFromAddress" class="text-[11px] text-secondary break-all mt-[2px]">
                paying from <span class="font-medium">{{ payFromAddress }}</span>
            </div>

            <div class="mt-[14px] flex flex-col gap-[8px]">
                <label class="text-[11px] text-secondary" for="wc-recipient">Recipient</label>
                <input
                    id="wc-recipient"
                    v-model="recipient"
                    class="w-full bg-transparent border border-input-border rounded-[8px] px-[10px] py-[8px] text-[12px] text-primary-fg break-all"
                    spellcheck="false"
                />

                <label class="text-[11px] text-secondary" for="wc-amount">Amount (BCH)</label>
                <input
                    id="wc-amount"
                    v-model="amount"
                    inputmode="decimal"
                    class="w-full bg-transparent border border-input-border rounded-[8px] px-[10px] py-[8px] text-[13px] text-primary-fg"
                />

                <div class="text-[11px] text-secondary">Network fee: {{ feeDisplay }}</div>

                <Button
                    @click.native="pay"
                    :label="busy ? 'Waiting for wallet…' : 'Send via wallet'"
                    :disabled="busy"
                />

                <p v-if="error" class="text-[12px] text-warning">{{ error }}</p>

                <div v-if="txid" class="text-[12px] text-secondary">
                    Sent ✓
                    <a :href="explorerUrl" target="_blank" rel="noopener" class="underline text-primary-fg">{{ txid.slice(0, 14) }}…{{ txid.slice(-8) }}</a>
                </div>

                <button @click="disconnect" class="text-[12px] text-secondary underline bg-transparent text-left mt-[4px]">
                    Disconnect wallet
                </button>
            </div>
        </section>

        <WizardConnectQRDialog
            :show="state === 'connecting'"
            :uri="uri ?? ''"
            :qrUri="qrUri ?? ''"
            :onClose="disconnect"
        />
    </main>
</template>

<script>
/* External-wallet payment surface (WizardConnect, hdwalletv1 protocol).
   The dapp builds the full unsigned transaction from the wallet's shared
   xpub + quorum-verified UTXOs; the wallet signs (and broadcasts) it. */
import { ref, watch } from 'vue'
import { useWizardConnect, WizardConnectQRDialog } from '@paytaca/wizardconnect-vue'

import { Button } from '@/components'
import { getCluster } from '@/lib/bch/provider'
import {
    buildPaymentTransaction,
    deriveChainAddress,
    fetchFeeSats,
    fetchSourceOutputs,
    parseBchToSats,
    parseRecipientAddress,
    selectCoins,
} from '@/lib/bch/external-wallet'

/* Default recipient — the builder's tip address (verified p2pkh). */
const TIP_ADDRESS = 'bitcoincash:qpv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf'

/* Resolve the wallet's path NAME for a numeric child index (0 = Receive,
   1 = Change). Names come from wallet_ready; match by "/N" suffix with a
   positional fallback. */
function pickPathName(manager, childIndex) {
    const paths = manager.getSessionPaths() || []
    const bySuffix = paths.find((p) => p.name && p.name.endsWith(`/${childIndex}`))
    if (bySuffix) {
        return bySuffix.name
    }
    return paths[childIndex] ? paths[childIndex].name : String(childIndex)
}

export default {
    components: {
        Button,
        WizardConnectQRDialog,
    },
    setup() {
        const wc = useWizardConnect({
            dappName: 'Nito Cash',
            dappIcon: 'https://nito.cash/icons/192x192.png',
        })

        const recipient = ref(TIP_ADDRESS)
        const amount = ref('0.00005')
        const busy = ref(false)
        const localError = ref('')
        const txid = ref('')
        const feeDisplay = ref('—')
        const payFromAddress = ref('')

        /* In-session address counters (avoid reuse within one session; the
           wallet's own counter governs across sessions). */
        let nextReceive = 0
        let nextChange = 0

        /* When the wallet becomes ready, show the address we will pay from. */
        watch([wc.manager, wc.state], async ([manager, state]) => {
            if (state !== 'connected' || !manager || !manager.hasPath(0)) {
                return
            }
            try {
                const node = manager.getXpubNode(0)
                if (node) {
                    payFromAddress.value = deriveChainAddress(node, nextReceive, 'bitcoincash').address
                }
            } catch (err) {
                /* Non-fatal: the address resolves again on send. */
                console.warn('[connect] address preview failed', err)
            }
        })

        async function pay() {
            localError.value = ''
            txid.value = ''
            busy.value = true

            try {
                const manager = wc.manager.value
                if (!manager || !manager.hasPath(0)) {
                    throw new Error('Wallet xpubs are not available yet — reconnect the wallet.')
                }

                const amountSats = parseBchToSats(amount.value)
                const recipient = await parseRecipientAddress(recipient.value.trim())
                const cluster = await getCluster('mainnet')

                /* Derive the input source address (receive chain). */
                const recvAddr = deriveChainAddress(manager.getXpubNode(0), nextReceive, 'bitcoincash')
                payFromAddress.value = recvAddr.address

                /* Fetch UTXOs for the wallet's receive address (include tokens,
                   then skip token-bearing ones — see CHIPNET.md caveat #1). */
                const raw = await cluster.request('blockchain.address.listunspent', recvAddr.address, true)
                const list = Array.isArray(raw) ? raw : (raw.outputs ?? raw.unspent ?? [])

                /* Two-pass fee: estimate with an assumed shape, then with the
                   real input/output counts. */
                let feeSats = await fetchFeeSats(cluster, chosen.length, 2)
                let { chosen: finalChosen, sum } = selectCoins(list, amountSats + feeSats)
                feeSats = await fetchFeeSats(cluster, finalChosen.length, 2)
                const covered = selectCoins(list, amountSats + feeSats)
                const sourceUtxos = covered.chosen
                if (covered.sum < amountSats + feeSats) {
                    throw new Error('Not enough BCH in the connected wallet for this amount + fee.')
                }

                const sourceOutputs = await fetchSourceOutputs(cluster, sourceUtxos)

                /* Change goes back to the wallet's change chain (child 1). */
                const changeAddr = deriveChainAddress(manager.getXpubNode(1), nextChange, 'bitcoincash')
                const built = buildPaymentTransaction({
                    sourceOutputs,
                    recipientLockingBytecode: recipient.lockingBytecode,
                    changeLockingBytecode: changeAddr.lockingBytecode,
                    amountSats,
                    feeSats,
                })

                feeDisplay.value = `${Number(feeSats) / 1e8} BCH`
                const inputPaths = sourceUtxos.map(() => [0, pickPathName(manager, 0), nextReceive])

                const response = await manager.signTransaction(
                    {
                        transaction: {
                            transaction: built.transaction,
                            sourceOutputs,
                            broadcast: true,
                            userPrompt: 'Nito Cash — send BCH',
                        },
                        inputPaths,
                    },
                )

                txid.value = response.signedTransactionHash
                nextReceive += 1
                if (built.change > 0n) {
                    nextChange += 1
                }
            } catch (err) {
                console.warn('[connect] payment failed', err)
                localError.value = err.message || String(err)
            } finally {
                busy.value = false
            }
        }

        return {
            ...wc,
            recipient,
            amount,
            busy,
            error: localError,
            txid,
            feeDisplay,
            payFromAddress,
            pay,
        }
    },
    computed: {
        /* The wizardconnect composable's own error ref and the local payment
           error are surfaced through the same template slot. */
        explorerUrl() {
            return `https://chaingraph.cash/tx/${this.txid}`
        },
    },
}
</script>
