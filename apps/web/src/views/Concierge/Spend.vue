<template>
    <main>
        <header>
            Welcome to the SPEND Center!
        </header>

        <div><hr /></div>

        <div class="payment">
            <label>Payment Processor</label>
            <small>Copy encoded data from your payment source, then paste it in the form field below <em>(eg. Invoice, Flipstarter campaign, etc).</em></small>
            <div class="divider" />
            <textarea
                placeholder="Enter your payment details here"
                type="text"
                v-model="note"
                @paste="handlePastedNote"
            />
        </div>

        <Footer>
            <Button @click.native="shopping" label="Shopping" double :disabled="!hasFunds" />
            <Button @click.native="giving" label="Giving" double :disabled="!hasFunds" />
        </Footer>

        <div><hr /></div>

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
import { Button, Footer } from '@/components'

export default {
    components: {
        Button,
        Footer,
    },
    data: () => {
        return {
            note: null,
            hasFunds: true,
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
                console.log('Pasted Note', this.note)

                /* Retrieve note from the Concierge. */
                const note = this.getParsedInfo(this.note)

                console.log('NOTE (from Concierge)', note)

                const outputs = note.outputs
                console.log('NOTE (outputs)', outputs)

                const output = outputs[0]

                const value = output.value
                console.log('NOTE (output.value)', value)

                const address = output.address
                console.log('NOTE (output.address)', address)

                const data = note.data
                console.log('NOTE (data)', data)

                const donation = note.donation
                console.log('NOTE (donation)', donation)

                const expires = note.expires
                console.log('NOTE (expires)', expires)

                this.showConcierge = true
            }, 10)
        },

    },
}
</script>

<style scoped>
main {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 20px 20px 0;
}

.payment .divider {
    width: 100%;
    height: 3px;
    margin-top: 10px;
    margin-bottom: 10px;
    background-color: rgba(255, 255, 255, 0.7);
}

header {
    padding: 15px;
}

hr {
    display: block;
    width: calc(100% + 40px);
    height: 1px;
    margin: 5px 0 5px -20px;
    background: var(--hr);
}

textarea {
    height: 65px;
    display: inline-block;
    vertical-align: middle;
    padding: 5px 15px;
}

</style>
