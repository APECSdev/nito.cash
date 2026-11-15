<template>
    <header>
        <button @click="loadDashboard">
            <svgicon v-if="!secondary" icon="back" width="24" height="24" :fill="false" :original="true"></svgicon>

            <span v-if="!secondary">{{label}}</span>
            <span class="secondary" v-if="secondary">{{label}}</span>
        </button>

        <button v-if="secondary" class="right" @click="goBack">
            <svg width="15" height="15" xmlns="http://www.w3.org/2000/svg">
                <path
                    d="M6.279 7.339L.53 1.59a.75.75 0 111.06-1.06L7.34 6.277 13.087.53a.75.75 0 011.06 1.06L8.4 7.34l5.75
                    5.75a.75.75 0 11-1.06 1.06L7.34 8.4l-5.75 5.75a.75.75 0 01-1.061-1.06l5.75-5.75z"
                    fill="#FFF"
                    fill-rule="nonzero" />
            </svg>
        </button>

        <div v-if="help">
            <button
                @click="showHelp = true"
                class="right">
                <svg width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="9" cy="9" r="8" stroke="#fff" stroke-width="2" />
                    <path fill="#fff" d="M8 8h2v5H8z" />
                    <circle cx="9" cy="6" r="1" fill="#fff" />
                </svg>
            </button>

            <!-- <Help :active="showHelp" /> -->
        </div>
    </header>
</template>

<script>
/* Import components. */
// import { Help } from '@/components'

/* Import icons. */
import '@/compiled-icons/back'

export default {
    components: {
        // Help,
    },
    props: {
        label: String,
        help: Boolean,
        secondary: Boolean,
    },
    data: () => {
        return {
            showHelp: false
        }
    },
    methods: {
        goBack() {
            // FIXME: Use the current state to determine close target.
            this.$router.back()
        },

        loadDashboard() {
            // FIXME: Use the current state to determine close target.
            this.$router.replace('dashboard')
        },
    }
}
</script>

<style scoped>
/* REDESIGN: the old primary-gradient banner is replaced by a minimal,
   translucent, blurred bar with a hairline divider. Height stays 65px
   (Modal's slot calc(100% - 65px) and several views depend on it). */
header {
    display: flex;
    position: relative;
    width: 100%;
    background: var(--header-bg);
    -webkit-backdrop-filter: blur(14px) saturate(1.4);
    backdrop-filter: blur(14px) saturate(1.4);
}

header::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1px;
    background: var(--hr);
}

button:first-of-type {
    display: flex;
    align-items: center;
    width: 100%;
    height: 65px;
    background: none;
    color: var(--fg);
    padding: 0 20px;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 0.03em;
}

/* Theme-aware icons: CSS `fill` beats the SVGs' presentation attributes
   (the inline help/close glyphs hardcode #FFF; the compiled back icon
   defaults to black) — both now follow the button color. */
header button svg,
header button :deep(svg *) {
    fill: currentColor;
}

button.right {
    position: absolute;
    top: 2px;
    right: 0px;
    width: 61px;
    height: 61px;
    background: none;
    color: var(--fg);
}

button span {
    flex: 1;
    text-align: center;
    padding-right: 23px;
    font-weight: 600;
}

span.secondary {
    padding-left: 30px;
}
</style>
