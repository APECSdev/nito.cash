<template>
    <main class="relative flex flex-col items-center h-full bg-primary text-primary-fg px-0 pb-[36px] overflow-hidden">
        <BlazeBanner />

        <!-- Decorative background: soft radial glows (pure CSS, GPU-cheap). -->
        <div class="orb orb-a" aria-hidden="true"></div>
        <div class="orb orb-b" aria-hidden="true"></div>
        <div class="grid-lines" aria-hidden="true"></div>

        <!-- Hero block (real line-heights + explicit gaps: no collapsed boxes). -->
        <div class="relative z-10 flex flex-col items-center gap-[16px] md:gap-[20px] pt-[5vh] flex-1 w-full">
            <div class="entrance-1">
                <svgicon icon="carnival" width="60" height="60" :fill="false" :original="true"></svgicon>
            </div>

            <h1 class="text-center text-[30px] md:text-[44px] leading-[1.15] font-semibold uppercase tracking-[0.32em] entrance-2">
                Nito.cash
            </h1>

            <h2 class="text-center text-[15px] md:text-[18px] leading-[1.3] font-semibold tracking-[0.32em] text-[#9fd8ff] entrance-3">
                Hush Your Money™
            </h2>

            <h3 class="text-center text-[12px] md:text-[14px] leading-[1.4] font-medium tracking-[0.28em] text-[#b9c8ff]/80 entrance-3">
                (Developer Preview)
            </h3>
        </div>

        <!-- Mascot -->
        <div class="relative z-10 h-[210px] md:h-[250px] my-[8px] float-anim entrance-2 shrink-0">
            <svgicon icon="rocketman" width="194" height="242" :fill="false" :original="true"></svgicon>
        </div>

        <!-- Footer block -->
        <div class="relative z-10 flex flex-col items-center gap-[12px] pb-[10px] entrance-4">
            <p class="text-[15px] leading-[1.4] text-[#c7d6ff]">
                Launching soon
                <span class="tracking-[0.1em]">{{ '...'.substr(0, index) }}</span>
            </p>

            <button
                @click="$router.push('connect')"
                class="text-[14px] leading-[1.4] text-[#9fd8ff] underline underline-offset-4 bg-transparent hover:text-white transition-colors"
            >
                Connect an external wallet →
            </button>
        </div>
    </main>
</template>

<script>
/* Import components. */
import BlazeBanner from '@/components/BlazeBanner.vue'

/* Import icons. */
import '@/compiled-icons/carnival'
import '@/compiled-icons/rocket'
import '@/compiled-icons/rocketman'

export default {
    components: {
        BlazeBanner,
    },
    data: () => {
        return {
            index: 0,
            frame: 0,
            redirectTimer: null,
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
        this.redirectTimer = setTimeout(() => {
            this.$router.replace('setup')
        }, 3000)
    },
    beforeDestroy() {
        /* Cleanup animation frame + redirect timer (the timer previously
           leaked past destroy and hijacked routes navigated away from Splash). */
        cancelAnimationFrame(this.frame)
        clearTimeout(this.redirectTimer)
    }
}
</script>

<style scoped>
/* Decorative radial glows behind the hero. */
.orb {
    position: absolute;
    border-radius: 9999px;
    filter: blur(60px);
    opacity: 0.35;
    pointer-events: none;
}

.orb-a {
    width: 340px;
    height: 340px;
    left: -120px;
    top: 10%;
    background: radial-gradient(circle, #4cc3ff 0%, transparent 70%);
    animation: drift 9s ease-in-out infinite alternate;
}

.orb-b {
    width: 300px;
    height: 300px;
    right: -110px;
    bottom: 6%;
    background: radial-gradient(circle, #ffc555 0%, transparent 70%);
    animation: drift 11s ease-in-out infinite alternate-reverse;
}

.grid-lines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
        linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
    background-size: 44px 44px;
    mask-image: radial-gradient(ellipse at center, black 30%, transparent 75%);
}

/* Entrance + idle animations. */
.entrance-1 { animation: fadeUp 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.entrance-2 { animation: fadeUp 0.7s 0.12s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.entrance-3 { animation: fadeUp 0.7s 0.24s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
.entrance-4 { animation: fadeUp 0.7s 0.36s cubic-bezier(0.2, 0.7, 0.2, 1) both; }

.float-anim {
    animation: float 5s ease-in-out infinite;
}

@keyframes fadeUp {
    from { opacity: 0; transform: translateY(14px); }
    to { opacity: 1; transform: translateY(0); }
}

@keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}

@keyframes drift {
    from { transform: translate(0, 0) scale(1); }
    to { transform: translate(26px, -20px) scale(1.08); }
}

/* Scoped child-root rule: styles the svgicon's root <svg> (a child component's
   root receives this scope's data attribute), so it cannot be a utility on
   Splash's own elements. Keeps the rocketman filling its container height. */
main div svg {
    height: 100%;
}
</style>
