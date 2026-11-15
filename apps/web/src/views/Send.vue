<template>
    <!-- NOTE: A legacy "Accept the recommendation?" Concierge popup used to
         render here. It was DEAD CODE: `showConcierge` was initialized false
         and never set true (its only writer was the popup's own `accept`
         handler, whose "Import has been completed" text revealed it as a
         leftover from the retired import flow). Removed 2026-11-15. -->
    <main>
        <Modal :label="$t('send-view.title')" :hideHeader="sendState !== 'idle'">
            <div v-if="sendState === 'sending'">
                <!-- height is calc(100% - 94px): iOS bug with vh -->
                <div class="flex-1 flex flex-col h-[calc(100%-94px)] items-center justify-center pt-[20px] px-[20px] pb-0">
                    <Spinner />

                    <p class="text-[16px] leading-[24px] font-medium text-center">
                        Your payment is being processed, please wait...
                    </p>
                </div>
            </div>

            <div v-else-if="sendState === 'done'">
                <!-- height is calc(100% - 94px): iOS bug with vh -->
                <div class="flex-1 flex flex-col h-[calc(100%-94px)] items-center justify-center pt-[20px] px-[20px] pb-0">
                    <div style="height: 200px; margin-bottom: 30px;">
                        <Animation type="pay-ok" />
                    </div>

                    <p class="text-[16px] leading-[24px] font-medium text-center">
                        Your payment is complete
                    </p>
                </div>

                <Footer>
                    <Button @click.native="resetSend" label="OK" />
                </Footer>
            </div>

            <div v-else>
                <div class="leading-[55px] bg-trinary text-trinary-fg text-center text-[15px] font-semibold">
                    Current balance: {{walletBalance.rounded}} {{walletBalance.unit}}
                </div>

                <div v-if="cameraError || receiver">
                    <div class="flex-1 flex flex-col justify-between pt-[20px] px-[20px] pb-0">
                        <div />

                        <div class="block h-[150px] text-center mb-[15px] short:h-[100px]">
                            <Animation type="president" />
                        </div>

                        <Address v-model="receiver" :address="receiver" />

                        <form class="w-full">
                            <label>Amount</label>
                            <Amount
                                :amount="amount"
                                v-on:amount-update="updateAmount"
                                v-on:unit-update="updateUnit"
                                :unit="unit"
                            />

                            <label>Transaction Note</label>
                            <input
                                placeholder="Add an optional note / reference"
                                type="text"
                                v-model="note"
                                class="input-base"
                            />
                        </form>
                    </div>

                    <Footer>
                        <Button @click.native="onSend" label="Send" double />
                        <Button @click.native="zxing" label="Android Scan" double />
                    </Footer>
                </div>

                <div v-else>
                    <!-- height: 450px (alternatives considered: calc(100vh - 225px) | 100%) -->
                    <div class="flex-1 relative bg-[#000] overflow-hidden h-[450px]" :class="scanner ? 'opacity-100' : 'opacity-0'">
                        <div class="absolute top-0 left-1/2 h-full w-auto -translate-x-1/2">
                            <video id="video-display" autoplay playsinline class="block h-full" />
                        </div>

                        <svg width="204" height="204" xmlns="http://www.w3.org/2000/svg" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                            <path
                                class="fill-secondary"
                                d="M167 10V0h26.976c5.523 0 10 4.477 10 10v27h-10V10H167zM36.976 10H10v27H0V10C0 4.477 4.477 0 10
                                0h26.976v10zM167 194h26.976v-27h10v27c0 5.523-4.477 10-10 10H167v-10zm-130.024 0v10H10c-5.523
                                0-10-4.477-10-10v-27h10v27h26.976z" />
                        </svg>
                    </div>
                </div>
            </div>
        </Modal>
    </main>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters } from 'vuex'

/* Import components. */
import {
    Address,
    Amount,
    Animation,
    Button,
    Footer,
    Modal,
    Spinner
} from '@/components'

/* Import QR Code scanner, with JS worker path. */
import QrScanner from 'qr-scanner'
QrScanner.WORKER_PATH = './js/qr-scanner-worker.min.js'

/* Initialize mobile detection. */
const MobileDetect = require('mobile-detect')

export default {
    components: {
        Address,
        Amount,
        Animation,
        Button,
        Footer,
        Modal,
        Spinner,
    },
    props: {
        scanned: String,
    },
    data: () => {
        return {
            addresses: [],
            // walletBalance: 0,
            walletBalance: null,

            receiver: null,
            amount: null,
            note: null,
            unit: 'bits',

            video: null,
            scanner: null,
            camera: null,
            cameraError: false,

            paymentLink: '',

            sendState: null,
        }
    },
    computed: {
        ...mapGetters('concierge', [
            'getParsedInfo',
        ]),

        ...mapGetters('wallets', [
            'getBalance',
        ]),

        /*
         * Current Balance
         *
         * The wallet balance expressed in the SELECTED (input) unit, compared
         * against the entered amount by the insufficient-funds guard in
         * `onSend`. The balance arrives formatted (`value` scaled to its own
         * display unit), so both legs convert through satoshis using the same
         * multipliers the send pipeline applies. An unknown unit maps to
         * zero, which blocks the send until a valid unit is selected.
         */
        currentBalance: function () {
            /* Unit multipliers (to satoshis) — mirrors the store conversion. */
            const multipliers = {
                SATS: 1,
                SATOSHIS: 1,
                BITS: Math.pow(10, 2),
                MBCH: Math.pow(10, 5),
                BCH: Math.pow(10, 8),
            }

            /* Balance (display) unit + multiplier. */
            const balanceUnit = ((this.walletBalance && this.walletBalance.unit) || '').toUpperCase()
            const balanceMultiplier = multipliers[balanceUnit] || 0

            /* Amount (input) unit + multiplier. */
            const amountUnit = (this.unit || '').toUpperCase()
            const amountMultiplier = multipliers[amountUnit] || 0

            /* Validate units. */
            if (!balanceMultiplier || !amountMultiplier) {
                return 0
            }

            /* Convert (displayed balance -> satoshis) -> (input unit). */
            return ((this.walletBalance.value || 0) * balanceMultiplier) / amountMultiplier
        },

    },
    methods: {
        ...mapActions([
            'displayError',
        ]),

        ...mapActions('wallets', [
            'sendCrypto',
        ]),

        /**
         * Initialize Scan Data
         *
         * For Android devices, we will use ZXing to scan QR Codes.
         * This is the return data from the app.
         */
        initScanData() {
            /* Parse the query string for shortcut. */
            if (window.location && window.location.search) {
                /* Set param (remove &). */
                const param = window.location.search.substr(1)

                if (param.slice(0, 4) === 'scan') {
                    const address = decodeURIComponent(param.slice(5))
                    console.log('PAY SCAN ADDRESS', address)

                    // FIXME: Validate bitcoin cash address

                    /* Set receiver. */
                    this.receiver = address
                }
            }
        },

        /**
         * Zebra Crossing (QR Code) Scanner
         *
         * This works best with Google Chrome, but also works well with:
         *     1. Brave
         *     2.
         *     3. ...
         *
         * The target `zxing:` URI works well with:
         *     1. DuckDuckGo
         *     2. ...
         *
         * This DOES NOT work at all with:
         *     1. LineageOS' Browser
         *     2. ...
         *
         * TODO: Continue testing ALL Android browser options;
         *       then implement an auto-detection / guide for the BEST UX.
         */
        zxing() {
            /* Set domain. */
            // FIXME: Pull this from the current url.
            const domain = 'https://nightly.nito.cash'

            /* Set url. */
            const url = `http://zxing.appspot.com/scan?ret=${domain}?scan={RAWCODE}&SCAN_FORMATS=QR_Code`

            /* Set target. */
            // NOTE: Skips the UI "Open with..." selection;
            //       however, this will fail if app is NOT installed.
            // const target = `zxing://scan/?ret=${domain}?scan={RAWCODE}&SCAN_FORMATS=QR_Code`

            // FIXME: Make sure that we can support Payment URLs (BIP-70).
            window.open(encodeURI(url))

            /* Close the current window. */
            // FIXME: Is there any way to make this work??
            window.close()
        },

        onSend() {
            // console.log('SENDING', this.amount)

            if (this.amount > this.currentBalance) {
                return this.displayError('Insufficient funds')
            }

            /* Show the processing state while the transaction is built +
               signed + broadcast. */
            this.sendState = 'sending'

            /* Send crypto. The action resolves once the broadcast settles
               (and rejects after it has warned the user), so this drives the
               'sending' -> 'done' / 'idle' (send) states. */
            this.sendCrypto({
                receiver: this.receiver,
                amount: this.amount,
                unit: this.unit,
            }).then(() => {
                /* Payment complete (pay-ok animation + OK button). */
                this.sendState = 'done'
            }, (_error) => {
                /* Failure (broadcast errors were already warned by the
                   store; pre-broadcast failures were not) — reset. */
                this.sendState = 'idle'

                console.error(_error) // eslint-disable-line no-console
            }).catch((_error) => {
                /* Safety net (errors thrown inside the handlers above). */
                this.sendState = 'idle'

                console.error(_error) // eslint-disable-line no-console
            })
        },

        onPaste(_value) {
            console.log('ON PASTE', _value)
            // const data = (event.clipboardData || window.clipboardData).getData('text')
            // const result = parseLink(data)
            // if (result) {
            //     setReceiver(result)
            // }
        },

        resetSend() {
            /* Reset (send) state to idle. */
            this.sendState = 'idle'

            /* Redirect to dashboard. */
            this.$router.push('dashboard')
        },

        updateAmount(_amount) {
            // console.log('UPDATING AMOUNT', _amount)

            /* Update amount. */
            this.amount = _amount
        },

        /**
         * Update Unit
         */
        updateUnit(_unit) {
            // console.log('UPDATING UNIT', _unit)

            /* Update unit. */
            this.unit = _unit
        },

        setReceiver(_result) {
            // console.log('SET RECEIVER', _result)

            /* Set receiver. */
            this.receiver = _result

            if (this.camera) {
                this.camera.stop()
                this.camera = null
            }

            if (this.scanner) {
                this.scanner.destroy()
                this.scanner = null
            }
        },

        /**
         * Start Scanner
         *
         * NOTE: This DOES NOT work on any of the Android devices tested.
         *       However, it DOES work well on all iOS devices tested.
         */
        async startScanner () {
            console.log('SCANNER')

            try {
                navigator.getUserMedia =
                    navigator.getUserMedia ||
                    navigator.webkitGetUserMedia ||
                    navigator.mozGetUserMedia ||
                    navigator.msGetUserMedia

                if (!navigator.mediaDevices.getUserMedia && !navigator.getUserMedia) {
                    this.cameraError = true
                } else {
                    /* Initialize video element. */
                    this.video = document.getElementById('video-display')

                    this.scanner = new QrScanner(this.video, (_data) => {
                        console.log('SCANNER DATA', _data)

                        // FIXME: Build a new link parser
                        const result = _data
                        // const result = parseLink(_data)

                        /* Validate (scanner) result. */
                        if (result) {
                            this.setReceiver(result)
                        }
                    })

                    /* Start scanner. */
                    await this.scanner.start()
                }
            } catch (err) {
                console.error(err) // eslint-disable-line no-console

                this.cameraError = true

                /* Bugsnag alert. */
                throw new Error(err)
            }
        },

    },
    created: async function () {
        /* Initialize balance display (values). */
        this.walletBalance = {
            value: 0,
            rounded: 0,
            unit: '',
            fiat: 0
        }

        /* Retrieve current (wallet) balance. NOTE: null pre-setup (no
           accounts yet) — keep the zero-initialized display object so the
           template never reads `.rounded` of null (mirrors Dashboard). */
        const balance = await this.getBalance('BCH', 'USD')

        if (balance) {
            this.walletBalance = balance
        }
    },
    mounted: function () {
        /* Initialize send state. */
        this.sendState = 'idle'

        console.log('SCANNED', this.scanned)

        /* Retrieve mobile device properties. */
        const md = new MobileDetect(window.navigator.userAgent)

        /* Validate mobile device camera limits. */
        if (md.os() === 'AndroidOS') {
            this.receiver = 'loading ZXing scanner...'

            // alert('Opening ZXing...')
            //
            // window.open('zxing://scan/?ret=https://nightly.nito.cash?scan={CODE}&SCAN_FORMATS=QR_Code')
        } else {
            /* Start scanner. */
            this.startScanner()
        }

        /* Retrieve (scanned) receiver (the Android ZXing `?scan=` flow;
           called here so it also wins over the loading placeholder). */
        this.initScanData()

        /* Prefill the receiver from the (concierge) `to` query parameter
           (eg. the Spend screen's parsed payment details). */
        if (this.$route.query.to) {
            this.receiver = String(this.$route.query.to)
        }
    },
    beforeUnmount() {
        /* Cleanup camera. */
        if (this.camera) {
            this.camera.stop()
            this.camera = null
        }

        /* Cleanup scanner. */
        if (this.scanner) {
            this.scanner.destroy()
            this.scanner = null
        }
    }
}
</script>


