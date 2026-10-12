<template>
    <div
        class="relative flex flex-row justify-start items-center mb-[22px] h-[52px] px-[20px] bg-input-bg rounded-[7px] border border-solid border-input-border w-full after:content-[''] after:absolute after:top-[22px] after:right-[20px] after:w-0 after:h-0 after:border-solid after:border-t-[7px] after:border-r-[6px] after:border-b-0 after:border-l-[6px] after:border-t-input-carret after:border-r-transparent after:border-b-transparent after:border-l-transparent"
        :class="disabled ? 'disabled opacity-40 pointer-events-none' : ''"
        @click.stop="dropdown = !dropdown">
        <img :src="getFlagName(activeFlag)" alt="" class="relative overflow-hidden mr-[13px] w-[20px] h-[20px] rounded-[20px]" />

        <p class="font-semibold opacity-50 leading-[13px]">{{activeCountry}}</p>

        <nav
            class="absolute top-[56px] left-0 w-full max-h-[260px] overflow-y-scroll bg-input-bg shadow-[0px_4px_30px_rgba(0,0,0,0.25)] rounded-[7px] transition-opacity duration-100 ease-[cubic-bezier(0.4,0,0.2,1)] z-[2]"
            :class="dropdown ? 'active opacity-100 pointer-events-all' : 'opacity-0 pointer-events-none'"
        >
            <button
                v-for="item of items"
                :key="item.value"
                @click="onSelect(item)"
                class="flex items-center h-[36px] px-[20px] w-full text-left text-[14px] first:rounded-t-[3px]"
                :class="item.label === activeCountry
                    ? 'active bg-dropdown-active'
                    : 'bg-input-bg hover:bg-dropdown-hover'"
            >
                <img v-if="item.flag" :src="getFlagName(item.flag)" alt="" class="relative overflow-hidden mr-[13px] w-[20px] h-[20px] rounded-[20px]" />
                {{item.label}}
            </button>
        </nav>
    </div>
</template>

<script>
/* Import modules. */
import cc from 'currency-codes'

export default {
    props: {
        disabled: Boolean,
        flag: String,
        items: Array,
        value: String,
    },
    data: () => {
        return {
            dropdown: false,
            selectedCountry: null,
            selectedFlag: null,
        }
    },
    computed: {
        // NOTE: We use `selectedCountry` to avoid mutating the parent's (value) prop.
        activeCountry: function () {
            return this.selectedCountry ? this.selectedCountry : this.value
        },

        // NOTE: We use `selectedFlag` to avoid mutating the parent's (flag) prop.
        activeFlag: function () {
            return this.selectedFlag ? this.selectedFlag : this.flag
        },
    },
    methods: {
        getFlagName(_country) {
            // console.log('GET FLAG NAME', _country)

            /* NOTE (Vite): webpack's `require()` / `require.context()` are gone.
               `import.meta.glob(..., { eager: true })` builds the same static
               module map at build time; `?url` yields each flag's asset URL. */
            const flags = import.meta.glob('../../assets/flags/*.svg', { eager: true, query: '?url', import: 'default' })
            /* NOTE: `import.meta.glob` keys are the literal (relative) paths. */
            const flagUrl = (name) => flags[`../../assets/flags/${name}.svg`]

            if (_country === 'American Samoa' || _country === 'United States') {
                return flagUrl('united-states-of-america')
            }

            if (_country === 'Bouvet Island') {
                return flagUrl('norway')
            }

            if (_country === 'Andorra') {
                return flagUrl('european-union')
            }

            if (_country === 'United Kingdom of Great Britain and Northern Ireland (The)') {
                return flagUrl('united-kingdom')
            }

            /* Decode country id. */
            // NOTE: This is "required"; probably due to an issue
            //       with webpack and `@` aliasing.
            const countryId = _country.replace(' (The)', '')
                .replace(' (The Republic Of)', '')
                .replace(/\s+/g, '-')
                .toLowerCase()

            // console.log('COUNTRY ID', countryId)

            /* Return flag's svg (image). */
            return flagUrl(countryId)
        },

        clickOutside() {
            this.dropdown = false
        },

        onSelect(_country) {
            // console.log('ON SELECT WAS CALLED!', _country)

            /* Retrieve currency. */
            const currency = cc.code(_country.value).currency

            /* Set (selected) country. */
            this.selectedCountry = currency

            /* Set (selected) flag. */
            this.selectedFlag = _country.flag
        },
    }
}
</script>

<style scoped>
/*
 * Phase D: all of Dropdown's scoped styles are converted to Tailwind utilities
 * on the template above — the root `div` (with its `:after` caret triangle),
 * the flag `img`, the `p` label, the `nav` menu (with its `nav.active`
 * opacity/pointer-events state made fully conditional), and the `nav button`
 * rows (with `first:rounded-t-[3px]`). The `disabled` / `active` marker classes
 * are kept as state hooks (unit tests assert `disabled`).
 *
 * Active-vs-hover parity: the original `nav button.active` (specificity 0,2,1)
 * beats `nav button:hover` (0,1,2), so an ACTIVE row keeps `--dropdown-active`
 * on hover. The template mirrors this by giving the active row no `hover:`
 * override, while non-active rows get `hover:bg-dropdown-hover`.
 *
 * On-disk quirk preserved: the original `nav button:last-child { border-radius:
 * 0 0¬ 3px 3px; }` contains a stray U+00AC (¬) making the declaration invalid,
 * so browsers DROP it — the last row therefore renders with NO bottom radius.
 * Visual parity = no `last:` radius utility is emitted; the quirk is kept here:
 *   nav button:last-child { border-radius: 0 0¬ 3px 3px; }
 */
</style>
