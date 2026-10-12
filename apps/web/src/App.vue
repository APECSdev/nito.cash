<template>
    <div class="app :">
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

html, body {
    width: 100vw;
    height: 100%; /* iOS bug with vh */
    overflow: hidden;
    background: #e5e5e5;
    font-family: 'Poppins', sans-serif;
    font-weight: 400;
    background: url('./assets/bg.jpg') no-repeat;

    background-size: cover;
    transition: background 0.25s;
}

body {
    display: flex;
    align-items: center;
    justify-content: center;
}

body.dark {
    background: url('./assets/bg-dark.jpg') no-repeat;
    background-size: cover;
}

.app {
    --max-width: 425px;
    --max-height: 680px;

    --header-height: 58px;
    --tabs-height: 65px;
    --iphone-height-fix: 115px;
    --ipad-height-fix: 55px;

    --bg: #eef1f3;
    --fg: #485776;
    --fg-hover: #2f5a94;
    --fg-link: #4376e2;
    --primary: #3569d7;
    --primary-fg: #fff;
    --primary-hover: #1454da;
    --secondary: #ffc555;
    --secondary-fg: #fff;
    --secondary-hover: #f3b336;
    --secondary-disabled: #ffdc98;
    --secondary-dark: #615640;
    --trinary: #4cc3ff;
    --trinary-fg: #fff;
    --trinary-dark: #1f5571;
    --light: #c2c7d1;
    --dark: #556273;
    --warning: #d33f49;
    --warning-fg: #fff;
    --warning-hover: #c02e38;
    --success: #67dab0;
    --input-bg: #fff;
    --input-border: #d1dae2;
    --input-placeholder: #a6adbc;
    --input-carret: #3569d7;
    --input-active: #677ca9;
    --popup-bg: rgba(72, 87, 118, 0.8);
    --chart-bg: #d2e9f5;
    --chart-fg: #4cc3ff;
    --chart-title: #87d4fb;
    --chart-button-fg: #fff;
    --chart-button-bg: #ffc555;
    --box-bg: #fff;
    --list-bg: #fff;
    --hr: #e3e5ec;
    --spinner: #b0b7c4;
    --pending: #c5c5c5;
    --pending-header: #dfdfdf;
    --pending-dark: #4f4f50;
    --dropdown-active: #fff0d2;
    --dropdown-hover: #f4f4f4;
}

.app.dark {
    --bg: #485776;
    --fg: #fff;
    --fg-hover: #e0e4ec;
    --fg-link: #a9c5ff;
    --primary: #5377c2;
    --primary-fg: #fff;
    --primary-hover: #2a5abd;
    --secondary: #fec65a;
    --secondary-fg: #fff;
    --secondary-dark: #615640;
    --secondary-hover: #f3b336;
    --trinary: #4cc3ff;
    --trinary-fg: #fff;
    --light: #c2c7d1;
    --dark: #556273;
    --warning: #f76c5e;
    --warning-fg: #fff;
    --warning-hover: #f45444;
    --success: #67dab0;
    --input-bg: #627294;
    --input-border: #717e97;
    --input-placeholder: #b0b8ca;
    --input-carret: #424c62;
    --input-active: #b8bfcd;
    --popup-bg: rgba(72, 87, 118, 0.8);
    --chart-bg: #5a6884;
    --chart-fg: #abb3c0;
    --chart-title: #a3abbb;
    --chart-button-fg: #fff;
    --chart-button-bg: #627294;
    --box-bg: #424c62;
    --list-bg: #627294;
    --hr: rgba(227, 229, 236, 0.2);
    --spinner: #b0b7c4;
    --pending: #b0b6c4;
    --pending-header: #959eb2;
    --pending-dark: #eef0f4;
    --dropdown-active: #51689a;
    --dropdown-hover: #5c6f98;
}

button {
    font-family: 'Poppins', sans-serif;
    cursor: pointer;
    color: var(--fg);
}

input, textarea {
    margin-bottom: 18px;
    padding: 0 14px;
    background: var(--input-bg);
    border-radius: 7px;
    border: 1px solid var(--input-border);
    font-family: 'Poppins', sans-serif;
    -webkit-appearance: none;
    color: var(--fg);
    font-size: 16px;
    width: 100%;
    height: 52px;
    resize: none;
    transition: border-color 0.12s cubic-bezier(0.4, 0, 0.2, 1);
}

input::-ms-clear {
    display: none;
    width: 0;
    height: 0;
}

input:focus {
    border-color: var(--input-active);
}

@media only screen and (max-height: 600px) {
    input, textarea {
        margin-bottom: 16px;
        height: 44px;
    }
}

::placeholder {
    color: var(--input-placeholder);
    font-weight: 600;
    font-size: 13px;
}

@media only screen and (max-height: 600px) {
    ::placeholder {
        line-height: 26px;
    }
}

h6 {
    color: var(--warning);
    font-size: 14px;
    text-transform: uppercase;
    font-weight: 600;
    margin-bottom: 9px;
}

label {
    display: block;
    font-weight: 600;
    margin-bottom: 7px;
}

label span {
    font-weight: 600;
}

svg {
    overflow: visible;
}

.app {
    width: 100vw;
    height: 100%; /* iOS bug with vh */
    margin: 0 auto;
    max-width: var(--max-width);
    max-height: var(--max-height);
    background: var(--bg);
    color: var(--fg);
    user-select: none;
    font-size: 13px;
    line-height: 16px;
    overflow: hidden;
    position: relative;
    box-shadow: 0px 20px 30px 5px rgba(0, 0, 0, 0.25);
}

@media (max-width: 520px) {
    html, body {
        background: transparent;
    }
    app {
        max-width: 100vw;
        max-height: 100%; /* iOS bug with vh */
        background: none;
    }
}

/* Responsive shell — Tablet & Desktop.
   NOTE: breakpoints layer on top of the base `.app` rule (which caps the
   phone frame at --max-width/--max-height). Mobile-first: the smallest
   screens keep the base 425px cap; wider screens progressively open up.
   `--max-width`/`--max-height` are re-scoped per breakpoint so the popups
   (Popup.vue et al., which read the same vars) widen along with the shell. */

/* Tablet — full screen width (fills the viewport edge-to-edge). */
@media only screen and (min-width: 768px) {
    .app {
        --max-width: 100vw;
        --max-height: 100%;
        max-width: var(--max-width);
        max-height: var(--max-height); /* iOS bug with vh */
        box-shadow: none;
    }
}

/* Desktop — cap the width so the wallpaper stays visible around a
   centered, elevated "app frame". */
@media only screen and (min-width: 1024px) {
    .app {
        --max-width: 768px;
        --max-height: 860px;
        max-width: var(--max-width);
        max-height: var(--max-height);
        border-radius: 12px;
        box-shadow: 0px 20px 30px 5px rgba(0, 0, 0, 0.25);
    }
}

@media only screen and (max-height: 680px) {
    body {
        display: block;
    }
}

/* Footer */
footer {
    display: flex;
    width: 100%;
    padding: 20px;
}

@media only screen and (max-height: 600px) {
    footer {
        padding: 16px;
    }
}

footer.tooltip {
    display: block;
    background: var(--box-bg);
    border-radius: 20px 20px 0 0;
    width: 100%;
    margin: 0;
    font-size: 12px;
}

} /* @layer base */
</style>
