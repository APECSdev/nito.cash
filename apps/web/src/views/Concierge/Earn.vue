<template>
    <main class="flex flex-col justify-between flex-1 px-[20px] h-[calc(100vh-58px-65px)] overflow-y-auto [-webkit-overflow-scrolling:touch] [--section-title-fontsize:1.3em] [--section-title-color:rgba(90,90,90,0.4)]">
        <header class="p-[15px]">
            Welcome to the EARN Center!
        </header>

        <div>
            <p class="my-[15px]">
                Lorem ipsum dolor sit amet, consectetur adipisicing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
            </p>
        </div>

        <div><hr class="block w-[calc(100%+40px)] h-[1px] mt-[5px] mb-[5px] ml-[-20px] bg-hr" /></div>

        <div>
            <div class="my-[15px] [font-size:var(--section-title-fontsize)] [color:var(--section-title-color)]">
                Current DeFi interest rate
            </div>
            <div class="my-[15px] text-[2.0em]">
                4.73%
            </div>
        </div>

        <div><hr class="block w-[calc(100%+40px)] h-[1px] mt-[5px] mb-[5px] ml-[-20px] bg-hr" /></div>

        <div>
            <div class="my-[15px] [font-size:var(--section-title-fontsize)] [color:var(--section-title-color)]">
                Nito community savings balance
            </div>
            <div class="my-[15px] text-[3.0em]">
                $914.20
            </div>

            <div class="mt-[30px] mb-[15px] [font-size:var(--section-title-fontsize)] [color:var(--section-title-color)]">
                All-time Nito community earnings
            </div>
            <div class="my-[15px] text-[2.0em]">
                ${{interestCore}}<span class="text-[rgba(30,30,255,0.6)]">{{interestRunning}}</span>
            </div>
        </div>

        <div><hr class="block w-[calc(100%+40px)] h-[1px] mt-[5px] mb-[5px] ml-[-20px] bg-hr" /></div>

        <div>
            <div class="my-[15px] [font-size:var(--section-title-fontsize)] [color:var(--section-title-color)]">
                Your savings balance
            </div>
            <div class="my-[15px] text-[3.0em]">
                $0.00
            </div>

            <div class="mt-[30px] mb-[15px] [font-size:var(--section-title-fontsize)] [color:var(--section-title-color)]">
                Your all-time total earnings
            </div>
            <div class="my-[15px] text-[2.0em]">
                $0.00<span class="text-[rgba(30,30,255,0.6)]">00000000</span>
            </div>

            <footer>
                <Button @click.native="addFunds" label="Add Funds" double secondary />
                <Button @click.native="withdrawFunds" label="Withdraw Funds" double secondary :disabled="!isInvested" />
            </footer>
        </div>

        <div><hr class="block w-[calc(100%+40px)] h-[1px] mt-[5px] mb-[5px] ml-[-20px] bg-hr" /></div>

        <div>
            <p class="my-[15px]">
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
