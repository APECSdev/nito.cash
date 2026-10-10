<template>
    <main>
        <Concierge
            :class="{ active: showConcierge }"
            v-on:confirm="accept"
            v-on:cancel="showConcierge = false"
        >
            <h3>Accept the recommendation?</h3>

            <p>
                Your transaction history will be cleared.
                If you have not backed up, you will permanently lose the tokens in your wallet.
            </p>
        </Concierge>

        <Modal :label="$t('send-view.title')" :hideHeader="sendState !== 'idle'">
            <div v-if="sendState === 'sending'">
                <div class="pay center">
                    <Spinner />

                    <p>
                        Your payment is being processed, please wait...
                    </p>
                </div>
            </div>

            <div v-else-if="sendState === 'done'">
                <div class="pay center">
                    <div style="height: 200px; margin-bottom: 30px;">
                        <Animation type="pay-ok" />
                    </div>

                    <p>
                        Your payment is complete
                    </p>
                </div>

                <Footer>
                    <Button @click.native="resetSend" label="OK" />
                </Footer>
            </div>

            <div v-else>
                <div class="balance">
                    Current balance: {{walletBalance.rounded}} {{walletBalance.unit}}
                </div>

                <div v-if="cameraError || receiver">
                    <div class="pay">
                        <div />

                        <div class="animation">
                            <Animation type="president" />
                        </div>

                        <Address v-model="receiver" :address="receiver" />

                        <form>
                            <label>Amount</label>
                            <Amount
                                :amount="amount"
                                v-on:amount-update="updateAmount"
                                :unit="unit"
                            />

                            <label>Transaction Note</label>
                            <input
                                placeholder="Add an optional note / reference"
                                type="text"
                                v-model="note"
                            />
                        </form>
                    </div>

                    <Footer>
                        <Button @click.native="onSend" label="Send" double />
                        <Button @click.native="zxing" label="Android Scan" double />
                    </Footer>
                </div>

                <div v-else>
                    <div class="scanner" :class="{ enabled: scanner }">
                        <div class="video-container">
                            <video id="video-display" autoplay playsinline />
                        </div>

                        <svg width="204" height="204" xmlns="http://www.w3.org/2000/svg">
                            <path
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
    Concierge,
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
        Concierge,
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
            showConcierge: false,
        }
    },
    computed: {
        ...mapGetters('concierge', [
            'getParsedInfo',
        ]),

        ...mapGetters('wallets', [
            'getBalance',
        ]),

    },
    methods: {
        ...mapActions([
            'displayError',
            'displayNotification',
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

            /* Send crypto. */
            this.sendCrypto({
                receiver: this.receiver,
                amount: this.amount,
                unit: this.unit,
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

        async accept() {
            try {
                console.log('IMPORTING ???')

                /* Request (total) wallet destruction. */
                // this.destroyWallet()

                /* Set flag. */
                this.showConcierge = false

                /* Display notification. */
                this.displayNotification('Import has been completed')

                /* Load setup. */
                // setTimeout(() => {
                //     this.$router.replace('setup')
                // }, 3000)
            } catch (err) {
                console.error(err) // eslint-disable-line no-console

                /* Display error. */
                this.displayError(err.message ? err.message.split(';')[0] : err)

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

        /* Retrieve current (wallet) balance. */
        this.walletBalance = await this.getBalance('BCH', 'USD')
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
    },
    beforeDestroy() {
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

<style scoped>
.pay {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 20px 20px 0;
}
.pay.center {
    height: calc(100% - 94px); /* iOS bug with vh */
    align-items: center;
    justify-content: center;
}
.pay.center p {
    font-size: 16px;
    line-height: 24px;
    font-weight: 500;
    text-align: center;
}

.pay.center svg path {
    fill: var(--success);
}

.balance {
    line-height: 55px;
    background: var(--trinary);
    color: var(--trinary-fg);
    text-align: center;
    font-size: 15px;
    font-weight: 600;
}

.scanner {
    flex: 1;
    position: relative;
    background: #000;
    overflow: hidden;
    opacity: 0;

    height: 450px;
    /* height: calc(100vh - 225px); */
    /* height: 100%; */
}

.scanner.enabled {
    opacity: 1;
}

.animation {
    display: block;
    height: 150px;
    text-align: center;
    margin-bottom: 15px;
}

@media only screen and (max-height: 600px) {
    .animation {
        height: 100px;
    }
}

.video-container {
    position: absolute;
    top: 0px;
    left: 50%;
    height: 100%;
    width: auto;
    transform: translate(-50%, 0);
}

video {
    display: block;
    height: 100%;
}

.scanner svg {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}
svg path {
    fill: var(--secondary);
}

form {
    width: 100%;
}

h4 {
    display: flex;
    justify-content: center;
    margin-bottom: 10px;
}
h4 strong {
    font-size: 40px;
    line-height: 44px;
    font-weight: 400;
}
h4 small {
    font-size: 13px;
    line-height: 13px;
    margin: 4px 0 0 3px;
}

.receiver {
    display: block;
    text-align: center;
}
</style>
