<template>
    <Popup :active="active">
        <section>
            <header>Connect your wallet</header>

            <article>
                <p class="intro">
                    Scan the QR with a WizardConnect-compatible wallet (Selene, Paytaca, Cashonize, …)
                    to make a Bitcoin Cash <strong>mainnet</strong> payment from your own wallet —
                    your keys never leave it.
                </p>

                <!-- Not connected: the connect surface. -->
                <div v-if="state !== 'connected'" class="connect-area">
                    <div class="qr-wrap">
                        <AlphanumericQRCode
                            v-if="qrUri"
                            :value="qrUri"
                            :size="180"
                            foreground="#e8ebf2"
                            background="#12151c"
                        />
                        <div v-else class="qr-placeholder">QR…</div>
                    </div>

                    <p v-if="state === 'connecting'" class="hint">Waiting for your wallet to scan…</p>
                    <p v-if="state === 'reconnecting'" class="hint">Reconnecting to your wallet…</p>
                    <p v-if="error" class="warn">{{ error }}</p>

                    <div v-if="uri" class="uri-row">
                        <div class="uri-label">Connection URI — paste into a desktop wallet (e.g. Cashonize → Connect to dApp)</div>
                        <button class="uri-copy" @click="copyUri" :title="'Click to copy the connection URI'">
                            {{ copiedUri ? 'copied ✓' : uri.slice(0, 34) + '…' }}
                        </button>
                    </div>

                    <Button
                        @click.native="connect"
                        label="Connect Wallet"
                        :disabled="state === 'connecting' || state === 'reconnecting'"
                    />
                </div>

                <!-- Connected: the payment surface. -->
                <div v-else class="pay-area">
                    <div class="connected-label">Connected wallet</div>
                    <div class="connected-name">{{ walletName || 'Wallet' }}</div>
                    <div v-if="payFromAddress" class="paying-from">
                        paying from <span class="addr">{{ payFromAddress }}</span>
                    </div>

                    <div class="form">
                        <label for="wc-recipient">Recipient</label>
                        <input
                            id="wc-recipient"
                            v-model="recipient"
                            spellcheck="false"
                        />

                        <label for="wc-amount">Amount (BCH)</label>
                        <input
                            id="wc-amount"
                            v-model="amount"
                            inputmode="decimal"
                        />

                        <div class="fee">Network fee: {{ feeDisplay }}</div>

                        <Button
                            @click.native="pay"
                            :label="busy ? 'Waiting for wallet…' : 'Send via wallet'"
                            :disabled="busy"
                        />

                        <p v-if="error" class="warn">{{ error }}</p>

                        <div v-if="txid" class="sent">
                            Sent ✓ <a :href="explorerUrl" target="_blank" rel="noopener">{{ txid.slice(0, 14) }}…{{ txid.slice(-8) }}</a>
                        </div>
                    </div>
                </div>
            </article>

            <footer>
                <Button @click.native="close" label="Close" double />
            </footer>
        </section>
    </Popup>
</template>

<script>
/* WizardConnect payment popup (hdwalletv1 protocol).
   The dapp builds the full unsigned transaction from the wallet's shared
   xpub + quorum-verified UTXOs; the wallet signs (and broadcasts) it.
   The QR + Connection URI support BOTH phone scans and desktop wallets
   that paste the URI (e.g. Cashonize). */
import { ref, watch } from 'vue'
import { useWizardConnect, AlphanumericQRCode } from '@paytaca/wizardconnect-vue'

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

/* Import popup manager. */
import Popup from './Popup'

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
        AlphanumericQRCode,
        Button,
        Popup,
    },
    props: {
        /* Pre-mounted pattern (Transaction.vue): the parent keeps this popup
           mounted and toggles visibility via the Popup `active` flag. */
        active: [Boolean, String],
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
        const copiedUri = ref(false)
        let copiedUriTimer = null

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
                console.warn('[wizardconnect] address preview failed', err)
            }
        })

        function copyUri() {
            if (!wc.uri.value) {
                return
            }

            const done = () => {
                copiedUri.value = true

                clearTimeout(copiedUriTimer)

                copiedUriTimer = setTimeout(() => {
                    copiedUri.value = false
                }, 1600)
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(wc.uri.value).then(done).catch(done)
            } else {
                done()
            }
        }

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
                let feeSats = await fetchFeeSats(cluster, 2, 2)
                let covered = selectCoins(list, amountSats + feeSats)
                if (covered.chosen.length === 0) {
                    throw new Error('No BCH UTXOs found on the connected wallet\u2019s address (mainnet).')
                }
                feeSats = await fetchFeeSats(cluster, covered.chosen.length, 2)
                covered = selectCoins(list, amountSats + feeSats)
                if (covered.sum < amountSats + feeSats) {
                    throw new Error('Not enough BCH in the connected wallet for this amount + fee.')
                }

                const sourceOutputs = await fetchSourceOutputs(cluster, covered.chosen)

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

                const response = await manager.signTransaction(
                    {
                        transaction: {
                            transaction: built.transaction,
                            sourceOutputs,
                            broadcast: true,
                            userPrompt: 'Nito Cash — send BCH',
                        },
                        inputPaths: covered.chosen.map(() => [0, pickPathName(manager, 0), nextReceive]),
                    },
                )

                txid.value = response.signedTransactionHash
                nextReceive += 1
                if (built.change > 0n) {
                    nextChange += 1
                }
            } catch (err) {
                console.warn('[wizardconnect] payment failed', err)
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
            copiedUri,
            copyUri,
            pay,
            close,
        }
    },
    mounted: function () {
        console.log('[wizardconnect] popup mounted')
    },
    methods: {
        /**
         * Close (WizardConnect popup): end the session and emit to parent.
         */
        close() {
            /* End the WC session (setup binding), then let the parent unmount. */
            if (this.disconnect) {
                this.disconnect()
            }

            /* Emit to parent. */
            this.$emit('close-wizard-connect')
        },
    },
    computed: {
        explorerUrl() {
            return `https://chaingraph.cash/tx/${this.txid}`
        },
    },
}
</script>

<style scoped>
/* Popup content styling (scoped; mirrors the repo's popup article patterns). */
header {
    text-align: center;
}

.intro {
    font-size: 12px;
    line-height: 17px;
    color: var(--secondary);
    text-align: center;
    margin: 8px 0 0;
}

.connect-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
}

.qr-wrap {
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.qr-placeholder {
    color: var(--secondary);
    font-size: 12px;
}

.hint {
    font-size: 12px;
    color: var(--secondary);
}

.warn {
    font-size: 12px;
    color: var(--warning);
}

.uri-row {
    width: 100%;
    text-align: center;
}

.uri-label {
    font-size: 10px;
    color: var(--secondary);
    margin-bottom: 4px;
}

.uri-copy {
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 6px 8px;
    cursor: pointer;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.connected-label {
    font-size: 11px;
    color: var(--secondary);
}

.connected-name {
    font-size: 16px;
    font-weight: 600;
    color: var(--trinary);
}

.paying-from {
    font-size: 11px;
    color: var(--secondary);
    word-break: break-all;
    margin-top: 2px;
}

.paying-from .addr {
    font-weight: 500;
}

.form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 14px;
}

.form label {
    font-size: 11px;
    color: var(--secondary);
}

.form input {
    width: 100%;
    background: transparent;
    border: 1px solid var(--input-border);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12px;
    color: var(--fg);
    word-break: break-all;
}

.fee {
    font-size: 11px;
    color: var(--secondary);
}

.sent {
    font-size: 12px;
    color: var(--secondary);
}

.sent a {
    color: var(--fg);
    text-decoration: underline;
}
</style>
