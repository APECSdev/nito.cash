<template>
    <Modal :label="$t('receive-view.title')" :help="true">
        <div class="flex-1 pt-[40px] px-[20px] pb-0">
            <QR :value="getAddress('BCH')" />
        </div>

        <div class="text-[20px] font-semibold text-trinary text-center mt-[48px]">
            {{displayAddress}}
        </div>

        <div class="text-[11px] font-semibold text-secondary text-center mt-[16px]">
            {{getAddress('BCH')}}
        </div>

        <Footer>
            <Button @click.native="copyAddress" label="Copy shareable link" />
        </Footer>
    </Modal>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters, mapState } from 'vuex'

/* Import components. */
import { Button, Footer, Modal, QR } from '@/components'

export default {
    components: {
        Button,
        Footer,
        Modal,
        QR,
    },
    data: () => {
        return {
            address: null,
            amount: null,
            loading: false,
            receiver: null,
            reference: '',
            timer: null,
            time: 0,
            unit: 'bits',
        }
    },
    computed: {
        ...mapState({
            //
        }),

        ...mapGetters('wallets', [
            'getAddress',
        ]),

        displayAddress() {
            /* Set abbreviation length. */
            const lenAbbr = 24

            /* Set (un-formatted) address. */
            let formatted = this.getAddress('BCH')
            // console.log('FORMATTED', formatted)

            /* Handle `bitcoincash` prefix. */
            if (formatted.indexOf(':') !== -1) {
                // formatted = formatted.split(':')[0] + '\n' + formatted.split(':')[1]
                formatted = formatted.split(':')[1]
            }

            /* Shorten address using `...` in-between. */
            formatted = formatted.slice(0, lenAbbr / 4) +
                ' • ' +
                formatted.slice(lenAbbr / 4, lenAbbr / 2) +
                ' . . . ' +
                formatted.slice(-lenAbbr / 2, -lenAbbr / 4) +
                ' • ' +
                formatted.slice(-lenAbbr / 4)

            /* Return (formatted) address. */
            return formatted
        },
    },
    methods: {
        ...mapActions([
            'displayError',
            'displayNotification',
        ]),

        ...mapActions('blockchain', [
            'closeConn',
            'openConn',
        ]),

        /**
         * Set Clipboard
         */
        setClipboard(_input) {
            // console.log('SET CLIPBOARD')

            try {
                const textArea = document.createElement('textarea')
                textArea.value = _input
                document.body.appendChild(textArea)

                if (navigator.userAgent.match(/ipad|iphone/i)) {
                    const range = document.createRange()
                    range.selectNodeContents(textArea)

                    const selection = window.getSelection()
                    selection.removeAllRanges()
                    selection.addRange(range)

                    textArea.setSelectionRange(0, 999999)
                } else {
                    textArea.select()
                }

                document.execCommand('copy')
                document.body.removeChild(textArea)

                return true
            } catch (err) {
                console.error(err) // eslint-disable-line no-console

                /* Bugsnag alert. */
                throw new Error(err)
            }
        },

        /**
         * Copy Address
         */
        copyAddress() {
            // console.log('COPY ADDRESS', this.getAddress)

            /* Set clipboard (with current address). */
            this.setClipboard(this.getAddress('BCH'))

            /* Display notification. */
            this.displayNotification('Link copied to clipboard')
        },
    },
    created: function () {
        /* Open a real-time blockchain connection. */
        this.openConn()
    },
    mounted: function () {
        //
    },
    beforeDestroy() {
        /* Wait 60 seconds, then close the real-time blockchain connection. */
        // setTimeout(() => {
            this.closeConn()
        // }, 60000)
    }
}
</script>


