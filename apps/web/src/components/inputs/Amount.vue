<template>
    <div>
        <input
            type="number"
            placeholder="Enter your amount"
            :value="amount"
            @input="updateAmount($event.target.value)"
        />

        <span v-if="amount">{{fiatDisplay}}</span>

        <button
            @click.prevent.stop="dropdown = !dropdown">
            {{activeUnit}}
        </button>

        <nav :class="{ active: dropdown }">
            <button
                v-for="item of units"
                :key="item"
                :class="{ active: activeUnit === item }"
                @click.prevent="selectedUnit = item">
                {{item}}
            </button>
        </nav>
    </div>
</template>

<script>
/* Initialize vuex. */
import { mapGetters } from 'vuex'

/* Initialize modules. */
import numeral from 'numeral'

export default {
    props: {
        amount: String,
        unit: String,
    },
    data: () => {
        return {
            dropdown: false,
            userAmount: null,
            marketValue: 0,
            currentAmount: 0,
            units: ['satoshis', 'bits', 'mBCH', 'BCH', 'USD'],
            selectedUnit: '',
        }
    },
    computed: {
        ...mapGetters('blockchain', [
            'getTicker',
        ]),

        // NOTE: We use `selectedUnit` to avoid mutating the parent's (unit) prop.
        activeUnit: function () {
            return this.selectedUnit ? this.selectedUnit : this.unit
        },


        fiatDisplay: function () {
            /* Initialize fiat value. */
            let fiatValue = 0

            // console.log('UNIT (selected)', this.activeUnit)

            /* Calculate satoshi value. */
            const satoshis = this.marketValue / 100000000

            /* Calculate the fiat value. */
            switch(this.activeUnit.toUpperCase()) {
            case 'SATOSHIS':
                fiatValue = (satoshis * this.txAmount) / 100

                if (fiatValue > 1) {
                    fiatValue = numeral(fiatValue).format('$0,0.00')
                } else {
                    fiatValue = numeral(fiatValue).format('$0,0.00[000000]')
                }
                break
            case 'BITS':
                fiatValue = satoshis * this.txAmount

                if (fiatValue > 1) {
                    fiatValue = numeral(fiatValue).format('$0,0.00')
                } else {
                    fiatValue = numeral(fiatValue).format('$0,0.00[0000]')
                }
                break
            case 'MBCH':
                fiatValue = (satoshis * this.txAmount) * 1000

                if (fiatValue > 1) {
                    fiatValue = numeral(fiatValue).format('$0,0.00')
                } else {
                    fiatValue = numeral(fiatValue).format('$0,0.00[00]')
                }
                break
            case 'BCH':
                fiatValue = (satoshis * this.txAmount) * 1000000
                fiatValue = numeral(fiatValue).format('$0,0.00')
                break
            case 'USD':
                fiatValue = numeral(this.txAmount).format('$0,0.00')
                break
            default:
                fiatValue = 0
            }

            /* Return formatted display. */
            return fiatValue
        },

        // NOTE: We use `txAmount` to avoid mutating the parent's (amount) prop.
        txAmount: {
            get: function () {
                return this.currentAmount ? this.currentAmount : this.amount
            },
            set: function (_val) {
                this.currentAmount = _val
            }
        },
    },
    methods: {
        /**
         * Update Amount
         */
        updateAmount(_amount) {
            // console.log('UPDATING AMOUNT', _amount)

            /* Update input. */
            this.txAmount = _amount

            /* Emit to parent. */
            this.$emit('amount-update', _amount)
        },
    },
    created: async function () {
        /* Retrieve market value. */
        this.marketValue = await this.getTicker('BCH', 'USD')
        console.log('MARKET VALUE', this.marketValue)
    },
    beforeDestroy() {
        /* Set flag. */
        // NOTE: This should be triggered on `clickOutside`.
        this.dropdown = false
    }
}
</script>

<style scoped>
div {
    position: relative;
}
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
div > button {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 75px;
    height: 36px;
    border-radius: 5px;
    background: var(--secondary);
    color: var(--secondary-fg);
    text-align: center;
    font-size: 14px;
    line-height: 37px;
    font-weight: 700;
}

@media only screen and (max-height: 600px) {
    div > button {
        top: 4px;
        right: 4px;
    }
}

span {
    position: absolute;
    top: 18px;
    right: 90px;
    font-size: 13px;
    color: var(--light);
    text-align: right;
}

@media only screen and (max-height: 600px) {
    span {
        top: 15px;
        right: 50px;
    }
}

nav {
    position: absolute;
    top: 48px;
    right: 0px;
    background: var(--input-bg);
    box-shadow: 0px 4px 30px rgba(0, 0, 0, 0.25);
    border-radius: 3px;
    opacity: 0;
    transition: opacity 0.1s cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
}

nav.active {
    opacity: 1;
    pointer-events: all;
}

nav button {
    display: block;
    background: var(--input-bg);
    height: 36px;
    width: 75px;
    text-align: center;
    font-size: 14px;
}

nav button:hover {
    background: var(--dropdown-hover);
}

nav button.active {
    background: var(--dropdown-active);
}

nav button:first-child {
    border-radius: 3px 3px 0 0;
}
nav button:last-child {
    border-radius: 0 0¬ 3px 3px;
}
</style>
