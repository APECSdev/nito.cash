<template>
    <main class="flex justify-between flex-col items-center h-full bg-primary text-primary-fg pt-[66px] px-0 pb-[55px] [@media(max-height:560px)]:pt-[30px] [@media(max-height:560px)]:pb-[30px]">
        <svgicon icon="carnival" width="128" height="128" :fill="false" :original="true"></svgicon>

        <h1 class="text-center text-[28px] leading-[0px] font-semibold uppercase tracking-[0.4em]">
            Nito.cash
        </h1>

        <h2 class="text-center text-[14px] leading-[0px] font-semibold tracking-[0.4em]">
            Hush Your Money™
        </h2>

        <h3 class="text-center text-[14px] leading-[24px] font-semibold tracking-[0.4em]">
            (Developer Preview)
        </h3>

        <div class="h-[242px] [@media(max-height:560px)]:h-[160px]">
            <svgicon icon="rocketman" width="194" height="242" :fill="false" :original="true"></svgicon>
        </div>

        <p class="text-left w-[125px]">
            Launching soon
            <span class="tracking-[0.1em]">{{ '...'.substr(0, index) }}</span>
        </p>
  </main>
</template>

<script>
/* Import icons. */
import '@/compiled-icons/carnival'
import '@/compiled-icons/rocket'
import '@/compiled-icons/rocketman'

export default {
    data: () => {
        return {
            index: 0,
            frame: 0
        }
    },
    methods: {
        loop() {
            if (this.frame % 10 === 0) {
                this.index = this.index === 3 ? 0 : this.index + 1
            }
            this.frame = requestAnimationFrame(this.loop)
        },
    },
    mounted: function () {
        /* Start animation loop. */
        this.loop()

        /* Load setup. */
        setTimeout(() => {
            this.$router.replace('setup')
        }, 3000)
    },
    beforeDestroy() {
        /* Cleanup animation frame. */
        cancelAnimationFrame(this.frame)
    }
}
</script>

<style scoped>
/* Scoped child-root rule: styles the svgicon's root <svg> (a child component's
   root receives this scope's data attribute), so it cannot be a utility on
   Splash's own elements. Keeps the rocketman filling its container height. */
main div svg {
    height: 100%;
}
</style>
