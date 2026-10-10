<template>
    <main>
        <header>
            Welcome to the EARN Center!
        </header>

        <div>
            <p>
                Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
            </p>
        </div>

        <div><hr /></div>

        <div>
            <div class="interestRate">
                Current DeFi interest rate
            </div>
            <div class="interestRateAmount">
                4.73%
            </div>
        </div>

        <div><hr /></div>

        <div>
            <div class="balance">
                Nito community savings balance
            </div>
            <div class="balanceAmount">
                $914.20
            </div>

            <div class="earnings">
                All-time Nito community earnings
            </div>
            <div class="earningsAmount">
                ${{interestCore}}<span class="earningsInterest">{{interestRunning}}</span>
            </div>
        </div>

        <div><hr /></div>

        <div>
            <div class="balance">
                Your savings balance
            </div>
            <div class="balanceAmount">
                $0.00
            </div>

            <div class="earnings">
                Your all-time total earnings
            </div>
            <div class="earningsAmount">
                $0.00<span class="earningsInterest">00000000</span>
            </div>

            <footer>
                <Button @click.native="addFunds" label="Add Funds" double secondary />
                <Button @click.native="withdrawFunds" label="Withdraw Funds" double secondary :disabled="!isInvested" />
            </footer>
        </div>

        <div><hr /></div>

        <div>
            <p>
                Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
            </p>
        </div>

        <Footer>
            <Button @click.native="addFunds" label="Add Funds" double />
            <Button @click.native="withdrawFunds" label="Withdraw Funds" double :disabled="!isInvested" />
        </Footer>
    </main>
</template>

<script>
/* Import components. */
import { Button, Footer } from '@/components'

export default {
    components: {
        Button,
        Footer,
    },
    data: () => {
        return {
            isInvested: false,
            interestAmount: 12.5415397484,
            interestIncrement: 0,
        }
    },
    computed: {
        interestCore() {
            /* Set core amount. */
            // NOTE: Format to 2 decimal places.
            const core = this.interestAmount.toFixed(2)

            /* Return parsed value. */
            return parseFloat(core)
        },

        interestRunning() {
            /* Set running amount. */
            // NOTE: Format to 8 decimal places.
            const running = (this.interestAmount - this.interestCore).toFixed(10)

            /* Calculate display value. */
            const display = parseFloat(running) * 10000000000

            /* Calculate adjusted value. */
            const adjusted = display + this.interestIncrement

            /* Return (adjusted) display value. */
            return adjusted
        },
    },
    methods: {
        /**
         * Add Funds
         */
        addFunds() {
            console.log('ADDING FUNDS')
        },

        /**
         * Withdraw Funds
         */
        withdrawFunds() {
            console.log('WITHDRAWING FUNDS')
        },

    },
    created: function () {
        setInterval(() => {
            this.interestIncrement++
        }, 100)
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

hr {
    display: block;
    width: calc(100% + 40px);
    height: 1px;
    margin: 5px 0 5px -20px;
    background: var(--hr);
}

header {
    padding: 15px;
}

div p {
    margin: 15px 0;
}

div.balance {
    margin: 15px 0;
    font-size: var(--section-title-fontsize);
    color: var(--section-title-color);
}
div.balanceAmount {
    margin: 15px 0;
    font-size: 3.0em;
}

div.earnings {
    margin: 30px 0 15px;
    font-size: var(--section-title-fontsize);
    color: var(--section-title-color);
}
div.earningsAmount {
    margin: 15px 0;
    font-size: 2.0em;
}
span.earningsInterest {
    color: rgba(30, 30, 255, 0.6);
}

div.interestRate {
    margin: 15px 0;
    font-size: var(--section-title-fontsize);
    color: var(--section-title-color);
}
div.interestRateAmount {
    margin: 15px 0;
    font-size: 2.0em;
}
</style>
