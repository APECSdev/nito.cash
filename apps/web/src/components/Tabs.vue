<template>
    <nav class="flex shrink-0 m-[14px] mb-[6px] p-[4px] gap-[4px] rounded-[16px] bg-tab-bg">
        <button
            v-for="item of tabs"
            :key="item"
            v-bind:value="tab"
            @click="updateTab(item)"
            class="relative flex-1 rounded-[12px] font-semibold h-[44px] leading-[44px] text-[13px] transition-colors duration-150"
            :class="item === activeTab
                ? 'active bg-primary text-primary-fg shadow-[0_6px_18px_-8px_rgba(47,102,224,0.6)]'
                : 'text-fg-muted hover:text-fg hover:bg-frame-border'">
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
 * REDESIGN: the underline-style tab strip is now a segmented pill rail
 * (container = --tab-bg inset panel; active segment = primary pill with a
 * soft halo; inactive = muted text). All styling lives in the template
 * utilities above. The `active` marker class is kept as a state hook (unit
 * tests assert `button.active`) and carries no scoped CSS.
 */
</style>
