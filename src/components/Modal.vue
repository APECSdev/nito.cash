<template>
    <main>
        <Header
            v-if="!hideHeader"
            :label="label"
            :help="help"
            :secondary="secondary"
        />

        <div class="slot" :class="{ hideHeader }">
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
div.slot {
    width: 100%;
    height: calc(100% - 65px); /* iOS bug with vh */
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
}
div.hideHeader {
    height: 100%;
}
</style>
