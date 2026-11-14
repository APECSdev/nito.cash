<template>
    <main class="flex flex-col justify-between flex-1 px-[20px] h-[calc(100vh-58px-65px)] overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <Concierge
            :active="showConcierge"
            v-on:confirm="acceptNote"
            v-on:cancel="showConcierge = false"
        >
            <h3>Accept the recommendation?</h3>

            <p v-if="parsedNote && parsedNote.outputs">
                <span v-for="(output, index) of parsedNote.outputs" :key="index">
                    Send {{output.value}} to {{output.address}}<br />
                </span>
            </p>
            <p v-else>No payment details could be parsed from the pasted data.</p>
        </Concierge>

        <header class="p-[15px]">
            Welcome to the SPEND Center!
        </header>

        <div><hr class="block w-[calc(100%+40px)] h-[1px] mt-[5px] mb-[5px] ml-[-20px] bg-hr" /></div>

        <div>
            <label>Payment Processor</label>
            <small>Copy encoded data from your payment source, then paste it in the form field below <em>(eg. Invoice, Flipstarter campaign, etc).</em></small>
            <div class="w-full h-[3px] mt-[10px] mb-[10px] bg-[rgba(255,255,255,0.7)]" />
            <textarea
                placeholder="Enter your payment details here"
                type="text"
                v-model="note"
                @paste="handlePastedNote"
                class="input-base h-[65px] inline-block align-middle py-[5px] px-[15px]"
            />
        </div>

        <Footer>
            <Button @click.native="shopping" label="Shopping" double :disabled="!hasFunds" />
            <Button @click.native="giving" label="Giving" double :disabled="!hasFunds" />
        </Footer>

        <div><hr class="block w-[calc(100%+40px)] h-[1px] mt-[5px] mb-[5px] ml-[-20px] bg-hr" /></div>

        <p>
            Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
        </p>

        <Footer>
            <Button @click.native="loadAdvancedSpending" label="Advanced Spending" />
        </Footer>
    </main>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters } from 'vuex'

/* Import components. */
import { Button, Concierge, Footer } from '@/components'

export default {
    components: {
        Button,
        Concierge,
        Footer,
    },
    data: () => {
        return {
            note: null,
            hasFunds: true,
            showConcierge: false,
            parsedNote: null,
        }
    },
    computed: {
        ...mapGetters('concierge', [
            'getParsedInfo',
        ]),

        ...mapGetters('utils', [
            'getFormattedValue',
        ]),

    },
    methods: {
        ...mapActions([
            'displayError',
            'displayNotification',
        ]),

        shopping() {
            console.log('SHOPPING')
        },

        giving() {
            console.log('GIVING')
        },

        /**
         * Load Advanced Spending Screen
         */
        loadAdvancedSpending() {
            this.$router.push('concierge/spend/advanced')
        },

        /**
         * Handle Pasted Note
         */
        handlePastedNote() {
            /* Wait a bit for pasted data to register. */
            setTimeout(() => {
                console.log('Pasted Note', this.note) // eslint-disable-line no-console

                /* Retrieve note from the Concierge. */
                const note = this.getParsedInfo(this.note)

                console.log('NOTE (from Concierge)', note) // eslint-disable-line no-console

                const outputs = note && note.outputs
                console.log('NOTE (outputs)', outputs) // eslint-disable-line no-console

                const output = outputs && outputs[0]

                const value = output && output.value
                console.log('NOTE (output.value)', value) // eslint-disable-line no-console

                const address = output && output.address
                console.log('NOTE (output.address)', address) // eslint-disable-line no-console

                const data = note && note.data
                console.log('NOTE (data)', data) // eslint-disable-line no-console

                const donation = note && note.donation
                console.log('NOTE (donation)', donation) // eslint-disable-line no-console

                const expires = note && note.expires
                console.log('NOTE (expires)', expires) // eslint-disable-line no-console

                /* Validate (parsed) note. */
                if (!output) {
                    return this.displayError('Could not parse the pasted payment details.')
                }

                /* Keep the (parsed) note + show the (confirmation) popup. */
                this.parsedNote = note
                this.showConcierge = true
            }, 10)
        },

        /**
         * Accept (parsed) Note
         *
         * Hands the parsed payment details to the Send screen (the receiver
         * is prefilled via the `to` query parameter).
         */
        acceptNote() {
            /* Hide the (confirmation) popup. */
            this.showConcierge = false

            /* Retrieve (primary) output. */
            const output = this.parsedNote && this.parsedNote.outputs
                ? this.parsedNote.outputs[0]
                : null

            /* Validate (primary) output. */
            if (!output || !output.address) {
                return this.displayError('No payment address in the pasted details.')
            }

            /* Load the Send screen (prefilled receiver). */
            this.$router.push({ path: 'send', query: { to: output.address } })
        },

    },
}
</script>
