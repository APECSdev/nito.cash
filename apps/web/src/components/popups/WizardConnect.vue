<template>
    <Teleport to="body">
        <Transition name="wc-fade">
            <div
                v-show="active"
                class="wc-overlay"
                role="dialog"
                aria-modal="true"
                aria-label="Connect your wallet"
            >
                <!-- Backdrop (click to close). -->
                <div class="wc-backdrop" @click="close"></div>

                <!-- Card (bottom-sheet on phones, centered dialog ≥sm). -->
                <div class="wc-card">
                    <div class="wc-head">
                        <div>
                            <div class="wc-kicker">WizardConnect</div>
                            <h3 class="wc-title">Connect your wallet</h3>
                        </div>
                        <button class="wc-x" @click="close" aria-label="Close">✕</button>
                    </div>

                    <div class="wc-body">
                        <p class="wc-intro">
                            Scan the QR — or paste the Connection URI — with a
                            WizardConnect-compatible wallet (Selene, Paytaca, Cashonize, …)
                            to make a Bitcoin Cash <strong>mainnet</strong> payment from your
                            own wallet. Your keys never leave it.
                        </p>

                        <!-- Not connected: the connect surface. -->
                        <div v-if="state !== 'connected'">
                            <div class="wc-qr-zone">
                                <div v-if="state === 'connecting' && !qrUri" class="wc-lottie">
                                    <Animation type="loading" />
                                </div>

                                <AlphanumericQRCode
                                    v-else-if="qrUri"
                                    :value="qrUri"
                                    :size="184"
                                    foreground="#0a0c10"
                                    background="#ffffff"
                                />

                            </div>

                            <p v-if="state === 'connecting'" class="wc-hint">Waiting for your wallet to scan…</p>
                            <p v-if="state === 'reconnecting'" class="wc-hint">Reconnecting to your wallet…</p>
                            <p v-if="error" class="wc-error">{{ error }}</p>

                            <button
                                v-if="state === 'idle' || state === 'disconnected'"
                                class="wc-relink"
                                @click="connect"
                            >
                                ↻ Generate a new connection QR
                            </button>

                            <div v-if="uri" class="wc-uri">
                                <div class="wc-uri-label">Connection URI — paste into a desktop wallet (e.g. Cashonize → Connect to dApp)</div>
                                <button class="wc-uri-copy" @click="copyUri" :title="'Click to copy the connection URI'">
                                    {{ copiedUri ? 'copied ✓' : uri.slice(0, 36) + '…' }}
                                </button>
                            </div>

                        </div>

                        <!-- Connected: the payment surface. -->
                        <div v-else>
                            <div class="wc-wallet">
                                <span class="wc-dot" aria-hidden="true"></span>
                                <span class="wc-wallet-name">{{ walletName || 'Wallet' }}</span>
                                <span class="wc-net">mainnet</span>
                            </div>
                            <div v-if="payFromAddress" class="wc-payfrom">
                                paying from <span class="wc-addr">{{ payFromAddress }}</span>
                            </div>

                            <div class="wc-form">
                                <label for="wc-recipient">Recipient</label>
                                <input id="wc-recipient" v-model="recipient" spellcheck="false" />

                                <label for="wc-amount">Amount (BCH)</label>
                                <input id="wc-amount" v-model="amount" inputmode="decimal" />

                                <div class="wc-fee">Network fee: {{ feeDisplay }}</div>

                                <button class="wc-cta" @click="pay" :disabled="busy">
                                    {{ busy ? 'Waiting for wallet…' : 'Send via wallet' }}
                                </button>

                                <p v-if="error" class="wc-error">{{ error }}</p>

                                <div v-if="txid" class="wc-success">
                                    <div class="wc-lottie-sm">
                                        <Animation type="pay-ok" />
                                    </div>
                                    <div class="wc-sent">
                                        Sent ✓
                                        <a :href="explorerUrl" target="_blank" rel="noopener">{{ txid.slice(0, 14) }}…{{ txid.slice(-8) }}</a>
                                    </div>
                                </div>
                            </div>

                            <button class="wc-link" @click="close">Disconnect wallet</button>
                        </div>
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<script>
/* WizardConnect payment modal (hdwalletv1 protocol).
   Self-contained overlay (Teleport + fixed z-index): independent of the
   legacy .popup frame system, so visibility is deterministic on every
   viewport (phone / tablet / desktop).
   The dapp builds the full unsigned transaction from the wallet's shared
   xpub + quorum-verified UTXOs; the wallet signs (and broadcasts) it.
   The QR + Connection URI support BOTH phone scans and desktop wallets
   that paste the URI (e.g. Cashonize). */
import { ref, watch, onBeforeUnmount } from 'vue'
import { decodeHdPublicKey } from '@bitauth/libauth'
import { useWizardConnect, AlphanumericQRCode } from '@paytaca/wizardconnect-vue'
/* The relay transports messages as plain JSON, so the sign request must be
   JSON-safe — never raw BigInt/Uint8Array ("Do not know how to serialize a
   BigInt"). The tx goes as HEX (the Transaction | string union); source
   outputs use the TAGGED extended-JSON wire form (see external-wallet.js). */
import { transactionToHex } from '@wizardconnect/core/hdwalletv1-serialize'

import Animation from '@/components/Animation'
import { getCluster } from '@/lib/bch/provider'
import {
    buildPaymentTransaction,
    deriveChainAddress,
    fetchFeeSats,
    fetchSourceOutputs,
    parseBchToSats,
    parseRecipientAddress,
    selectCoins,
    signedTxidFromHex,
    sourceOutputToWire,
} from '@/lib/bch/external-wallet'

/* Default recipient — the builder's tip address (verified p2pkh). */
const TIP_ADDRESS = 'bitcoincash:qpv4n2kyy6w8n50n3xx4ty8etxekksuqnu44erzapf'

/* Resolve the wallet's HD PUBLIC NODE for a numeric child index (0 = Receive,
   1 = Change). The dapp manager only stores nodes for CANONICALLY-named paths
   (receive/change/defi via childIndexOfPathName) — a wallet that names its
   paths differently (e.g. Cashonize) leaves xpubNodes EMPTY, and the raw
   node from getXpubNode may also be unusable for derivation. So: direct
   lookup (validated), then name heuristics over the session paths, then
   positional (0 = receive, 1 = change). Returns undefined when nothing
   decodes to a derivation-capable node. */
function nodeIsDerivable(node) {
    return !!(node && typeof node === 'object' && node.publicKey instanceof Uint8Array && node.chainCode instanceof Uint8Array)
}

function resolveChainNode(manager, childIndex) {
    const direct = manager.getXpubNode(childIndex)
    if (nodeIsDerivable(direct)) {
        return direct
    }

    const paths = manager.getSessionPaths() || []
    const wanted = childIndex === 0 ? ['receive', '0'] : ['change', '1']
    for (const p of paths) {
        const lower = String(p.name || '').toLowerCase()
        if (wanted.some((n) => lower === n || lower.endsWith('/' + n) || lower.endsWith(n))) {
            const decoded = decodeHdPublicKey(p.xpub)
            if (typeof decoded !== 'string' && nodeIsDerivable(decoded.node)) {
                return decoded.node
            }
        }
    }

    /* Positional fallback: hdwalletv1 lists Receive first, Change second. */
    const byPos = paths[childIndex]
    if (byPos) {
        const decoded = decodeHdPublicKey(byPos.xpub)
        if (typeof decoded !== 'string' && nodeIsDerivable(decoded.node)) {
            return decoded.node
        }
    }
    return undefined
}

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
        Animation,
    },
    props: {
        /* Pre-mounted pattern (Transaction.vue): the parent keeps this modal
           mounted and toggles visibility via the `active` flag. */
        active: [Boolean, String],
    },
    setup(props) {
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

        /* Straight to the QR: opening the modal immediately initiates the
           relay connection (closing it ends the session). */
        /* `immediate: true` matters: the deep link (dashboard?connect=1) mounts
           the modal with active ALREADY true, so without immediate the watcher
           never fires and the modal sits empty (no connection, no QR). The
           Dashboard button path flips active after mount, which is why that
           path worked while the deep link showed an empty window. */
        watch(() => props.active, (isActive) => {
            if (isActive && (wc.state.value === 'idle' || wc.state.value === 'disconnected')) {
                console.log('[wizardconnect] modal opened → initiating connection')
                wc.connect()
            }
        }, { immediate: true })

        /* The @wizardconnect core disconnects the relay whenever the tab is
           HIDDEN (its own visibilitychange handler) — which kills the sign
           request mid-publish exactly when the user switches to the wallet
           tab to approve, and drops the wallet's signed response on arrival
           ("No pending request for sequence"). Block the core's visibility
           handlers while a session is live: our capture-phase listener runs
           before their bubble-phase ones regardless of registration order,
           and stopImmediatePropagation prevents them entirely. Nothing else
           in this app listens to visibilitychange. */
        const blockRelayVisibilityHandler = (event) => {
            event.stopImmediatePropagation()
        }
        watch(wc.state, (state) => {
            if (state === 'connecting' || state === 'connected') {
                document.addEventListener('visibilitychange', blockRelayVisibilityHandler, true)
            } else {
                document.removeEventListener('visibilitychange', blockRelayVisibilityHandler, true)
            }
        })

        onBeforeUnmount(() => {
            document.removeEventListener('visibilitychange', blockRelayVisibilityHandler, true)
        })

        /* When the wallet becomes ready, show the address we will pay from. */
        watch([wc.manager, wc.state], async ([manager, state]) => {
            if (state !== 'connected' || !manager) {
                return
            }
            try {
                /* Log path NAMES only (never keys) — one line, for diagnosis
                   of wallets that name their paths non-canonically. */
                console.log('[wizardconnect] session paths:', (manager.getSessionPaths() || []).map((p) => p.name).join(', ') || '(none)')
                const node = resolveChainNode(manager, 0)
                if (node) {
                    payFromAddress.value = deriveChainAddress(node, nextReceive, 'bitcoincash').address
                } else {
                    console.warn('[wizardconnect] no derivation-capable receive node yet')
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
                /* NB: this local must NOT be named `recipient` — the name is
                   taken by the v-model ref, and the old
                   `const recipient = await parseRecipientAddress(recipient.value…)`
                   shadowed it and read itself during initialization
                   (TDZ: “Cannot access 'o' before initialization” in prod). */
                const recipientInfo = await parseRecipientAddress(recipient.value.trim())
                const cluster = await getCluster('mainnet')

                /* Derive the input source address (receive chain). */
                const recvNode = resolveChainNode(manager, 0)
                if (!recvNode) {
                    throw new Error('Wallet receive-path data is unavailable — reconnect the wallet.')
                }
                const recvAddr = deriveChainAddress(recvNode, nextReceive, 'bitcoincash')
                payFromAddress.value = recvAddr.address

                /* Fetch UTXOs for the wallet's receive address (include tokens,
                   then skip token-bearing ones — see CHIPNET.md caveat #1).
                   Current Fulcrum/Electrum-Cash wants a STRING filter option
                   ("include_tokens" | "exclude_tokens" | "tokens_only");
                   older builds take a boolean — try the string, fall back. */
                let raw
                try {
                    raw = await cluster.request('blockchain.address.listunspent', recvAddr.address, 'include_tokens')
                } catch (err) {
                    if (!/Invalid token filtering option/i.test(err?.message ?? '')) {
                        throw err
                    }
                    raw = await cluster.request('blockchain.address.listunspent', recvAddr.address, true)
                }
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
                const changeNode = resolveChainNode(manager, 1)
                if (!changeNode) {
                    throw new Error('Wallet change-path data is unavailable — reconnect the wallet.')
                }
                const changeAddr = deriveChainAddress(changeNode, nextChange, 'bitcoincash')
                const built = buildPaymentTransaction({
                    sourceOutputs,
                    recipientLockingBytecode: recipientInfo.lockingBytecode,
                    changeLockingBytecode: changeAddr.lockingBytecode,
                    amountSats,
                    feeSats,
                })

                feeDisplay.value = `${Number(feeSats) / 1e8} BCH`

                const signRequest = {
                    transaction: {
                        /* Relay wire form: the tx as HEX + relay-shaped
                           source outputs (tagged bytes, tagged bigints). */
                        transaction: transactionToHex(
                            built.transaction.inputs,
                            built.transaction.outputs,
                            built.transaction.version,
                            built.transaction.locktime,
                        ),
                        sourceOutputs: sourceOutputs.map(sourceOutputToWire),
                        broadcast: true,
                        userPrompt: 'Nito Cash — send BCH',
                    },
                    /* inputPaths[i] = [position of input i in the tx,
                       path name, address index] — the position must be
                       per-entry (0, 1, 2, …); hardcoding 0 for every input
                   fails Cashonize's unique-index refine. */
                    inputPaths: covered.chosen.map((_, idx) => [idx, pickPathName(manager, 0), nextReceive]),
                }

                let response
                try {
                    response = await manager.signTransaction(signRequest)
                } catch (err) {
                    /* Transient publish race: the relay can drop/reconnect
                       around a visibility change. One retry with a fresh
                       sequence (Cashonize simply prompts again). */
                    if (!/Failed to publish|closed by us/i.test(err?.message ?? '')) {
                        throw err
                    }
                    console.warn('[wizardconnect] sign request publish raced the relay — retrying once')
                    await new Promise((r) => setTimeout(r, 2500))
                    response = await manager.signTransaction(signRequest)
                }

                /* Prefer the wallet's own hash; compute it from the signed
                   tx hex when the wallet answers the bare protocol response
                   ({ signedTransaction } only). Same bytes ⇒ same txid. */
                txid.value = response.signedTransactionHash ??
                    (response.signedTransaction ? signedTxidFromHex(response.signedTransaction) : undefined)
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
        }
    },
    methods: {
        /**
         * Close (WizardConnect modal): end the session and emit to parent.
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
/* ---------- Overlay (self-contained; independent of .app frame vars) ----- */
.wc-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0;
}

@media (min-width: 640px) {
    .wc-overlay {
        align-items: center;
        padding: 24px;
    }
}

.wc-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(6, 9, 16, 0.62);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
}

/* ---------- Card ---------------------------------------------------------- */
.wc-card {
    position: relative;
    width: 100%;
    max-width: 440px;
    max-height: 92vh;
    overflow-y: auto;
    background: linear-gradient(170deg, #151a24 0%, #0d111a 100%);
    color: #e8ebf2;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 20px 20px 0 0;
    box-shadow: 0 -12px 48px rgba(0, 0, 0, 0.55), 0 30px 90px rgba(0, 0, 0, 0.45);
    padding: 18px 18px 20px;
}

@media (min-width: 640px) {
    .wc-card {
        border-radius: 20px;
        padding: 22px 24px 24px;
    }
}

.wc-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
}

.wc-kicker {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #4cc3ff;
}

.wc-title {
    font-size: 21px;
    font-weight: 700;
    margin-top: 2px;
    font-family: 'Poppins', sans-serif;
}

.wc-x {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #9aa3b2;
    width: 30px;
    height: 30px;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
}

.wc-x:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
}

.wc-body {
    margin-top: 10px;
}

.wc-intro {
    font-size: 14px;
    line-height: 20px;
    color: #9aa3b2;
}

/* ---------- Connect surface ---------------------------------------------- */
.wc-qr-zone {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 190px;
    margin-top: 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 16px;
    padding: 14px;
}

.wc-lottie {
    width: 130px;
    height: 130px;
}

.wc-lottie-sm {
    width: 90px;
    height: 90px;
    margin: 0 auto;
}

.wc-hint {
    font-size: 13px;
    color: #9aa3b2;
    margin-top: 8px;
    text-align: center;
}

.wc-error {
    font-size: 13px;
    color: #ff8a7e;
    margin-top: 8px;
}

.wc-uri {
    margin-top: 12px;
}

.wc-uri-label {
    font-size: 11px;
    color: #93a1bd;
    margin-bottom: 4px;
}

.wc-uri-copy {
    width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: #c9d2e2;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 7px 10px;
    cursor: pointer;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    transition: border-color 0.15s ease;
}

.wc-uri-copy:hover {
    border-color: #4cc3ff;
}

.wc-cta {
    width: 100%;
    margin-top: 14px;
    padding: 14px 16px;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 700;
    color: #0a0c10;
    background: linear-gradient(135deg, #4cc3ff 0%, #67dab0 100%);
    border: 0;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
    box-shadow: 0 12px 30px -12px rgba(76, 195, 255, 0.6);
}

.wc-cta:hover:not(:disabled) {
    transform: translateY(-1px);
}

.wc-cta:disabled {
    opacity: 0.55;
    cursor: default;
}

.wc-relink {
    width: 100%;
    margin-top: 10px;
    font-size: 13px;
    color: #4cc3ff;
    background: transparent;
    border: 0;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 4px;
}

/* ---------- Connected surface --------------------------------------------- */
.wc-wallet {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
}

.wc-dot {
    width: 8px;
    height: 8px;
    border-radius: 9999px;
    background: #67dab0;
    box-shadow: 0 0 10px rgba(103, 218, 176, 0.9);
    animation: wc-pulse 2s ease-in-out infinite;
}

@keyframes wc-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
}

.wc-wallet-name {
    font-size: 16px;
    font-weight: 700;
}

.wc-net {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #67dab0;
    background: rgba(103, 218, 176, 0.12);
    border-radius: 9999px;
    padding: 3px 8px;
}

.wc-payfrom {
    font-size: 13px;
    color: #93a1bd;
    word-break: break-all;
    margin-top: 6px;
}

.wc-addr {
    color: #aeb9cc;
}

.wc-form {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-top: 14px;
}

.wc-form label {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #93a1bd;
}

.wc-form input {
    width: 100%;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 16px;
    color: #e8ebf2;
    word-break: break-all;
    outline: none;
    transition: border-color 0.15s ease;
}

.wc-form input:focus {
    border-color: #4cc3ff;
}

.wc-fee {
    font-size: 13px;
    color: #93a1bd;
}

.wc-success {
    margin-top: 10px;
}

.wc-sent {
    font-size: 15px;
    text-align: center;
    color: #67dab0;
}

.wc-sent a {
    color: #e8ebf2;
    text-decoration: underline;
}

.wc-link {
    width: 100%;
    margin-top: 12px;
    font-size: 13px;
    color: #93a1bd;
    background: transparent;
    border: 0;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 4px;
}

.wc-link:hover {
    color: #9aa3b2;
}

/* ---------- Visibility transition ----------------------------------------- */
.wc-fade-enter-active,
.wc-fade-leave-active {
    transition: opacity 0.22s ease;
}

.wc-fade-enter-from,
.wc-fade-leave-to {
    opacity: 0;
}
</style>
