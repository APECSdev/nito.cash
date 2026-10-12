<template>
    <nav class="flex">
        <button
            v-for="item of tabs"
            :key="item"
            v-bind:value="tab"
            @click="updateTab(item)"
            class="relative flex-1 bg-box-bg font-semibold h-[58px] leading-[58px] text-[13px] before:content-[''] before:absolute before:bottom-0 before:left-1/2 before:[transform:translate(-50%,0)] before:h-[3px] before:bg-secondary before:transition-[width] before:duration-200 before:ease-[cubic-bezier(0.075,0.82,0.165,1)]"
            :class="item === activeTab
                ? 'active before:w-[70%]'
                : 'before:w-0'">
            {{item}}
        </button>
    </nav>
</template>

<script>
export default {
    props: {
        tab: String,
        tabs: Array,
    },
    data: () => {
        return {
            selectedTab: null,
        }
    },
    computed: {
        // NOTE: We use `activeTab` to avoid mutating the parent's (tab) prop.
        activeTab: function () {
            return this.selectedTab ? this.selectedTab : this.tab
        },
    },
    methods: {
        updateTab(_item) {
            /* Update selected tab. */
            this.selectedTab = _item

            /* Emit tab update (to parent). */
            this.$emit('tab-change', _item)
        }
    }

}
</script>

<style scoped>
/*
 * Phase D: `nav`, `nav button`, and the `nav button:before` underline (with
 * its `nav button.active:before { width: 70% }` state) are converted to
 * Tailwind utilities on the template above. The underline width is made fully
 * conditional (`before:w-[70%]` when active, else `before:w-0`) so the two
 * width utilities never compete in the cascade — mirroring the original
 * specificity ordering. The literal `transform: translate(-50%, 0)` is kept as
 * an arbitrary property for exact 1:1 parity. The `active` class is kept as a
 * state hook (unit tests assert `button.active`), now carrying no scoped CSS.
 * The buttons' font-family / cursor / color still come from App.vue's global
 * `button` rule, which these utilities deliberately do not set.
 */
</style>
