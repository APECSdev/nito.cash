<template>
    <main>
        <!-- transition:fly={{ x: 20, duration: 200, opacity: 0, easing: quintOut }} -->
        <p v-if="notification"  @:click="notification = null"
            class="cursor-pointer absolute top-[65px] left-0 w-full h-[55px] leading-[55px] text-center font-medium text-primary-fg bg-success z-10">
            {{notification}}
        </p>

        <!-- transition:fly={{ x: 20, duration: 200, opacity: 0, easing: quintOut }} -->
        <p
            v-if="error"
            class="error cursor-pointer absolute top-[65px] left-0 w-full h-[55px] leading-[55px] text-center font-medium text-warning-fg bg-warning z-10"

            @click="error = null">
            {{error}}
        </p>
    </main>
</template>

<script>
export default {
    computed: {
        error: {
            get: function () {
                /* Return error message. */
                return this.$store.state.system.em
            },
            set: function (_message) {
                /* Commit error message. */
                this.$store.commit('system/setError', _message)
            }
        },
        notification: {
            get: function () {
                /* Return notification message. */
                return this.$store.state.system.nm
            },
            set: function (_message) {
                /* Commit notification message. */
                this.$store.commit('system/setNotification', _message)
            }
        },
    },
}
</script>

<style scoped>
/*
 * Phase D: the base `p` banner and its `p.error` variant are converted to
 * Tailwind utilities on the template above (the error banner swaps
 * `text-primary-fg`/`bg-success` for `text-warning-fg`/`bg-warning`). The
 * `error` class is kept as a state hook, now carrying no scoped CSS. The
 * banners render only when a notification/error is set (v-if), so this change
 * is invisible in the default state; parity verified by computed-style probe.
 */
</style>
