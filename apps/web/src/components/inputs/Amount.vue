<template>
    <div class="relative">
        <input
            type="number"
            placeholder="Enter your amount"
            :value="amount"
            @input="updateAmount($event.target.value)"
            class="input-base"
        />

        <span v-if="amount" class="absolute top-[18px] right-[90px] text-[13px] text-light text-right short:top-[15px] short:right-[50px]">{{fiatDisplay}}</span>

        <button
            @click.prevent.stop="dropdown = !dropdown"
            class="absolute top-[8px] right-[8px] w-[75px] h-[36px] rounded-[5px] bg-secondary text-secondary-fg text-center text-[14px] leading-[37px] font-bold short:top-[4px] short:right-[4px]">
            {{activeUnit}}
        </button>

        <nav
            class="absolute top-[48px] right-0 bg-input-bg shadow-[0px_4px_30px_rgba(0,0,0,0.25)] rounded-[3px] transition-opacity duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]"
            :class="dropdown ? 'active opacity-100 pointer-events-all' : 'opacity-0 pointer-events-none'">
            <button
                v-for="item of units"
                :key="item"
                class="block h-[36px] w-[75px] text-center text-[14px] first:rounded-t-[3px]"
                :class="activeUnit === item ? 'active bg-dropdown-active' : 'bg-input-bg hover:bg-dropdown-hover'"
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
/*
 * Phase D: all of Amount's scoped styles are converted to Tailwind utilities
 * on the template above — the root `div` (relative), the fiat `span`, the unit
 * `div > button` selector (utilities on the button itself), the `nav` unit menu
 * (opacity/pointer-events made fully conditional like Dropdown), and the
 * `nav button` rows (active-beats-hover parity + `first:rounded-t-[3px]`). The
 * native `<input>` now carries the shared `input-base` component class (the
 * relocated former global `input, textarea` rule).
 *
 * On-disk quirk preserved: `nav button:last-child { border-radius: 0 0¬ 3px 3px; }`
 * contains a stray U+00AC (¬) making it invalid, so browsers DROP it — no
 * `last:` radius utility is emitted (visual parity); the quirk is kept here:
 *   nav button:last-child { border-radius: 0 0¬ 3px 3px; }
 *
 * The `::-webkit-outer/inner-spin-button` rule below is KEPT as scoped CSS: a
 * vendor-prefixed pseudo-element hack to hide the number-input spinners, which
 * is genuinely CSS territory (not expressible as clean utilities).
 */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
}
</style>
