<template>
    <main>
        <Header
            v-if="!hideHeader"
            :label="label"
            :help="help"
            :secondary="secondary"
        />

        <div
            class="slot w-full flex flex-col justify-between overflow-y-auto [-webkit-overflow-scrolling:touch]"
            :class="hideHeader
                ? 'hideHeader h-full'
                : 'h-[calc(100%-65px)]'"
        >
            <slot />
        </div>
    </main>
</template>

<script>
/* Import components. */
import { Header } from '@/components'

export default {
    components: {
        Header,
    },
    props: {
        help: Boolean,
        hideHeader: Boolean,
        label: String,
        secondary: Boolean,
    }
}
</script>

<style scoped>
/*
 * Phase D: `div.slot` / `div.hideHeader` converted to Tailwind utilities on the
 * template above. The `height: calc(100% - 65px)` (iOS vh bug) is applied via
 * `h-[calc(100%-65px)]`, switching to `h-full` when `hideHeader` is set — made
 * fully conditional so the two height utilities never compete in the cascade.
 * The `slot` / `hideHeader` classes are kept as state hooks (unit tests assert
 * them), now carrying no scoped CSS of their own.
 */
</style>
