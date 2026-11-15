<template>
    <div class="app :" :class="{ dark: isDarkMode }">
        <Notification />
        <router-view />
    </div>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters } from 'vuex'

/* Import components. */
import { Notification } from '@/components'

export default {
    components: {
        Notification
    },
    computed: {
        ...mapGetters('wallets', [
            'getReceivingAccounts',
        ]),

        ...mapGetters('profile', [
            'getFlags',
        ]),

        /* Dark-mode state (persisted profile flag `f.dm`). NOTE: the
           `.app.dark` token block below was DEAD until now — the only dark
           handling anywhere was Settings.vue's `darkMode` computed, which
           toggles `document.body` while Settings is mounted (and only while
           it is mounted), so the 38 interior dark tokens never applied to
           the `.app` element. Binding the class here makes the interior
           theme real, and the watcher below keeps the (wallpaper) body
           class in sync app-wide + on every reload. */
        isDarkMode() {
            const flags = this.getFlags

            return !!(flags && flags.dm)
        },
    },
    watch: {
        isDarkMode: {
            /* Immediate: on (re)load, before any Settings visit. */
            immediate: true,
            handler(_isDark) {
                /* Keep the (wallpaper) body class in sync app-wide. */
                document.body.classList.toggle('dark', _isDark)
            },
        },
    },
    methods: {
        ...mapActions('blockchain', [
            'closeConn',
            'openConn',
        ]),

        ...mapActions('profile', [
            'initProfile',
        ]),

        ...mapActions('wallets', [
            'initWallet',
        ]),

        /**
         * Security Check
         */
        securityCheck() {
            /* Validate security for ALL Nito distributions. */
            // NOTE: Nito uses cookies vs localstorage for ALL others.
            if (process.env.VUE_APP_TARGET === 'nito') {
                /* Validate SSL connection. */
                if (window.location.protocol === 'http:') {
                    /* Set secure URL. */
                    const secureUrl = window.location.href
                        .replace('http', 'https')

                    /* Redirect to secure URL. */
                    window.location.replace(secureUrl)
                }
            }
        },

        /**
         * Initialize (Application)
         */
        init() {
            /* Initialize connection. */
            // NOTE: Open socket connection to the blockchain.
            // this.openConn()
            // setTimeout(() => {
            //     this.closeConn()
            // }, 10000)

            /* Initialize profile. */
            this.initProfile()

            /* Initialize wallet. */
            this.initWallet()

            /* Set locale. */
            // FIXME: We need to do some browser detection here.
            this.$i18n.locale = 'en'

            /* Retrieve application version. */
            // TODO: Display CHANGELOG when new version is detected.
            const appVersion = require('../package.json').version
            console.info('Application version', appVersion) // eslint-disable-line no-console

        },
    },
    created: function () {
        console.log('Initializing Nito Cash...')

        /* Security check. */
        this.securityCheck()

        /* Initialize application. */
        this.init()
    },
}
</script>

<style>
/*
 * Phase D: these global base styles are wrapped in `@layer base` so that the
 * Tailwind utility layer (`@layer utilities`, generated from classes in the
 * component templates) can override them. Unlayered author CSS always beats
 * layered rules, so without this wrapper a utility like `block` would lose to
 * the global `footer { display: flex }` below. The `@layer base` name matches
 * Tailwind v4's own base layer, so these rules slot in alongside preflight and
 * remain overridable by utilities. Selector bodies are unchanged (1:1 parity).
 */
@layer base {
/* Fonts */
@font-face {
    font-family: 'Poppins';
    font-style: normal;
    font-weight: 400;
    font-display: swap;
    src: local('Poppins Regular'), local('Poppins-Regular'), url('./assets/fonts/poppins-regular.woff2') format('woff2');
}

@font-face {
    font-family: 'Poppins';
    font-style: normal;
    font-weight: 500;
    font-display: swap;
    src: local('Poppins Medium'), local('Poppins-Medium'), url('./assets/fonts/poppins-medium.woff2') format('woff2');
}

@font-face {
    font-family: 'Poppins';
    font-style: normal;
    font-weight: 600;
    font-display: swap;
    src: local('Poppins SemiBold'), local('Poppins-SemiBold'), url('./assets/fonts/poppins-semibold.woff2') format('woff2');
}

/* Main Theme */
*, *:after, *:before {
    margin: 0;
    padding: 0;
    border: 0;
    font-weight: 400;
    box-sizing: border-box;
    outline: none;
}

/*
 * Tailwind preflight styles `hr { border-top-width: 1px; border-style: solid }`.
 * The universal reset above (`border: 0`) used to suppress that when this block
 * was unlayered, but inside `@layer base` the element selector `hr` outranks
 * `*` on specificity, so the preflight border would leak through. The app
 * renders `<hr>` dividers as a 1px background bar (see views/Settings.vue),
 * never a border, so reset it here to preserve that (1:1 parity).
 */
hr {
    border: 0;
}

/*
 * Cypherpunk wallpaper — layered pure CSS (zero binary assets; the legacy
 * bg.jpg / bg-dark.jpg from the previous application are retired).
 *
 * Layers, bottom to top:
 *   1. film-grain noise (inline SVG feTurbulence, saturate(0))
 *   2. cipher grid — 1px lines every 44px, both axes
 *   3. signal glows — one cyan "beacon" + one indigo "ghost", huge + blurred
 *   4. base color (--wallpaper-color)
 *
 * Theme-aware via custom properties on `:root` / `body.dark` (the body
 * carries the `dark` class — see the isDarkMode watcher in the component).
 */
:root {
    --wallpaper-color: #e9eef7;
    --wall-grid: rgba(47, 80, 145, 0.075);
    --wall-glow-1: rgba(14, 165, 233, 0.11);
    --wall-glow-2: rgba(79, 91, 219, 0.07);
    --wall-noise-opacity: 0.05;
}

body.dark {
    --wallpaper-color: #05080f;
    --wall-grid: rgba(76, 195, 255, 0.055);
    --wall-glow-1: rgba(56, 189, 248, 0.13);
    --wall-glow-2: rgba(59, 91, 219, 0.16);
    --wall-noise-opacity: 0.06;
}

html, body {
    width: 100vw;
    height: 100%; /* iOS bug with vh */
    overflow: hidden;
    background-color: var(--wallpaper-color);
    background-image:
        url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='160'%20height='160'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.9'%20numOctaves='2'/%3E%3CfeColorMatrix%20type='saturate'%20values='0'/%3E%3C/filter%3E%3Crect%20width='160'%20height='160'%20filter='url(%23n)'%20opacity='0.05'/%3E%3C/svg%3E"),
        repeating-linear-gradient(90deg, var(--wall-grid) 0 1px, transparent 1px 44px),
        repeating-linear-gradient(0deg, var(--wall-grid) 0 1px, transparent 1px 44px),
        radial-gradient(900px 620px at 88% -12%, var(--wall-glow-1), transparent 62%),
        radial-gradient(760px 540px at -8% 112%, var(--wall-glow-2), transparent 60%);
    font-family: 'Poppins', sans-serif;
    font-weight: 400;
    transition: background-color 0.25s;
}

body {
    display: flex;
    align-items: center;
    justify-content: center;
}

/* The mount node sits BETWEEN body and the .app shell; without an explicit
   height it is auto-sized, which made `.app`'s own `height: 100%` resolve
   against nothing (the shell then collapsed to its content height once the
   old fixed 425x680 phone-frame caps were lifted — full-bleed phones
   showed wallpaper strips below a ~418px-tall app). */
#app {
    height: 100%;
}

body.dark {
    /* Wallpaper vars only — the background stack above reads them. */
}

.app {
    --max-width: 425px;
    --max-height: 680px;

    --header-height: 58px;
    --tabs-height: 65px;
    --iphone-height-fix: 115px;
    --ipad-height-fix: 55px;

    /*
     * Light palette ("clean ledger" — cool paper, ink-blue text, electric
     * blue + cyan accents, amber kept as the brand pop). Text/surface pairs
     * keep or improve the previously measured WCAG ratios.
     */
    --bg: #f3f6fb;
    --fg: #1b2740;
    --fg-muted: #5c6d8d;
    --fg-hover: #2f5a94;
    --fg-link: #2f66e0;
    --primary: #2f66e0;
    --primary-fg: #fff;
    --primary-hover: #1d55d4;
    --secondary: #ffc555;
    /* Dark text on the amber surface (shared by both themes). */
    --secondary-fg: #4a3410;
    --secondary-hover: #f3b336;
    --secondary-disabled: #ffdc98;
    --secondary-dark: #615640;
    /* Text-grade warning (the --warning token doubles as a BUTTON background,
       so its value cannot serve long text on dark --bg). */
    --warning-text: #c03540;
    --trinary: #0ea5e9;
    --trinary-fg: #06283d;
    --trinary-dark: #1f5571;
    --light: #c9d2e0;
    --dark: #4a5670;
    --warning: #d33f49;
    --warning-fg: #fff;
    --warning-hover: #c02e38;
    --success: #10b981;
    --input-bg: #fff;
    --input-border: #d8e0ec;
    --input-placeholder: #9aa6bd;
    --input-carret: #2f66e0;
    --input-active: #2f66e0;
    --popup-bg: rgba(10, 16, 32, 0.55);
    --chart-bg: #e3f1fc;
    --chart-fg: #2563eb;
    --chart-title: #7cc4f8;
    --chart-button-fg: #fff;
    --chart-button-bg: #ffc555;
    --box-bg: #fff;
    --list-bg: #fff;
    --hr: #e4e9f3;
    --spinner: #aeb8ca;
    --pending: #c3c9d4;
    --pending-header: #dde2ea;
    --pending-dark: #454d5c;
    --dropdown-active: #fff3d6;
    --dropdown-hover: #f1f5fb;

    /* Chrome (new tokens — translucent header, tab rail, focus ring). */
    --header-bg: rgba(255, 255, 255, 0.78);
    --tab-bg: rgba(27, 39, 64, 0.06);
    --frame-border: rgba(255, 255, 255, 0.45);
    --ring: rgba(47, 102, 224, 0.18);
    /* Interior ambient texture (VERY subtle — the app surface carries the
       same cipher-grid + grain language as the wallpaper). */
    --app-grid: rgba(47, 80, 145, 0.045);
}

.app.dark {
    /*
     * Dark palette ("deep space" — the flagship cypherpunk theme). Near-black
     * navy surfaces, electric blue + cyan accents, soft light text. Text
     * pairs hold ≥4.5:1 (placeholders/dimmed accents ≥3:1).
     */
    --bg: #0a1020;
    --fg: #e8eef8;
    --fg-muted: #93a5c4;
    --fg-hover: #ffffff;
    --fg-link: #8fb7ff;
    /* Same brand blue as light (white on #2f66e0 ≈ 4.6:1). */
    --primary: #2f66e0;
    --primary-fg: #fff;
    --primary-hover: #1d55d4;
    --secondary: #ffc555;
    /* Dark text on the amber surface (matches the light-theme fix: white
       measured 1.56:1 on it). */
    --secondary-fg: #4a3410;
    --secondary-dark: #615640;
    --secondary-hover: #f3b336;
    --secondary-disabled: #ffdc98;
    --trinary: #38bdf8;
    --trinary-fg: #062033;
    --trinary-dark: #1f5571;
    --light: #c9d2e0;
    --dark: #4a5670;
    /* Same red as light: white on #d33f49 ≈ 4.6:1 (the lighter #f87171
       measured 2.77:1 under white button text). */
    --warning: #d33f49;
    --warning-fg: #fff;
    --warning-hover: #c02e38;
    /* Light text-grade warning for dark --bg. */
    --warning-text: #ffbcae;
    --success: #34d399;
    --input-bg: #111a30;
    --input-border: #243252;
    --input-placeholder: #7285a6;
    --input-carret: #38bdf8;
    --input-active: #5aa2ff;
    --popup-bg: rgba(3, 6, 14, 0.6);
    --chart-bg: #101b33;
    --chart-fg: #8fb7ff;
    --chart-title: #5d8bd8;
    --chart-button-fg: #fff;
    --chart-button-bg: #243252;
    --box-bg: #0e1526;
    --list-bg: #111a30;
    --hr: rgba(147, 165, 196, 0.16);
    --spinner: #64748f;
    --pending: #3a4660;
    --pending-header: #4a5878;
    --pending-dark: #dfe6f3;
    --dropdown-active: #1a2a4a;
    --dropdown-hover: #152238;

    /* Chrome (dark). */
    --header-bg: rgba(10, 16, 32, 0.72);
    --tab-bg: rgba(255, 255, 255, 0.05);
    --frame-border: rgba(140, 170, 230, 0.18);
    --ring: rgba(56, 189, 248, 0.25);
    --app-grid: rgba(76, 195, 255, 0.035);
}

/*
 * Phase D (batch 4a): the global `input, textarea` rule (base + `::-ms-clear`
 * + `:focus` + bare-global `::placeholder` + the two `max-height: 600px`
 * overrides) is RELOCATED to the `.input-base` component class in
 * `@layer components` in `src/assets/tailwind.css`, applied as a class to the
 * four consumers (Amount, Address, Send:note-input, Spend:payment-textarea).
 * Declarations are byte-for-byte identical; scoping `::placeholder` to
 * `.input-base::placeholder` is equivalent because only those four inputs
 * carry a placeholder.
 *
 * Phase D (batch 5): the global ELEMENT rules (button/h6/label/label span/
 * svg/footer/footer.tooltip) are RELOCATED to `@layer base` in
 * src/assets/tailwind.css (imported first in main.js, so they sit after
 * preflight but before the rules below, reproducing the original specificity
 * outcome for ties). Declarations are byte-for-byte identical (1:1 parity).
 */

.app {
    width: 100vw;
    height: 100%; /* iOS bug with vh */
    margin: 0 auto;
    /* Full-bleed shell on PHONE + TABLET (the user-facing app should fill
       the viewport — "only a very small amount of the background, if
       anything at all"). The old 425x680 "phone frame" left wallpaper
       strips above/below (phones are 800+ px tall) and floating margins
       on 520–767px devices; the old @media (max-width:520px) override
       targeted a bare `app` ELEMENT selector (there is no <app> element —
       the root is a div.app), so it never applied and phones ran with the
       425/680 caps. Desktop (>=1024px) re-caps to a centered frame below. */
    --max-width: 100vw;
    --max-height: 100%;
    max-width: var(--max-width);
    max-height: var(--max-height);
    /* Interior surface + the subtle cipher-grid/grain ambient (scroll-safe:
       on a scroll container the default `scroll` attachment pins the
       background to the element, so the texture stays put while content
       scrolls). */
    background-color: var(--bg);
    background-image:
        url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='160'%20height='160'%3E%3Cfilter%20id='n'%3E%3CfeTurbulence%20type='fractalNoise'%20baseFrequency='0.9'%20numOctaves='2'/%3E%3CfeColorMatrix%20type='saturate'%20values='0'/%3E%3C/filter%3E%3Crect%20width='160'%20height='160'%20filter='url(%23n)'%20opacity='0.035'/%3E%3C/svg%3E"),
        repeating-linear-gradient(90deg, var(--app-grid) 0 1px, transparent 1px 44px),
        repeating-linear-gradient(0deg, var(--app-grid) 0 1px, transparent 1px 44px);
    color: var(--fg);
    user-select: none;
    font-size: 15px;
    line-height: 21px;
    /* Vertical scroll lives INSIDE the app frame (html/body stay overflow
       hidden): content taller than the frame (short phones, long lists) is
       reachable instead of clipped. Horizontal stays contained. */
    overflow: hidden auto;
    -webkit-overflow-scrolling: touch;
    position: relative;
    box-shadow: 0px 24px 60px -12px rgba(2, 8, 24, 0.55);
}

@media (max-width: 520px) {
    html, body {
        background: transparent;
    }
    /* NOTE: the old inner `app { ... }` rule here targeted a bare `app`
       ELEMENT selector and never matched anything (the root is div.app);
       the base .app rule above is now full-bleed, covering phones too. */
}

/* Responsive shell — Tablet & Desktop.
   NOTE: the BASE .app rule is full-bleed (100vw x 100%), which covers
   phones AND tablets (<=1023px) — the wallpaper stays hidden behind the
   app. Only the desktop breakpoint re-caps the shell to a centered,
   elevated "app frame" so the wallpaper stays visible around it.
   `--max-width`/`--max-height` are re-scoped per breakpoint so the popups
   (Popup.vue et al., which read the same vars) follow the shell. */

/* Desktop — cap the width so the wallpaper stays visible around a
   centered, elevated "app frame". */
@media only screen and (min-width: 1024px) {
    .app {
        --max-width: 768px;
        --max-height: 860px;
        max-width: var(--max-width);
        max-height: var(--max-height);
        /* Desktop keeps the original (slightly denser) base type. */
        font-size: 14px;
        line-height: 19px;
        border-radius: 24px;
        border: 1px solid var(--frame-border);
        box-shadow: 0 40px 90px -24px rgba(2, 8, 24, 0.65);
    }
}

@media only screen and (max-height: 680px) {
    body {
        display: block;
    }
}

} /* @layer base */
</style>
