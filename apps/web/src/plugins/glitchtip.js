/*
 * Error + performance reporting (GlitchTip, via the Sentry SDK).
 *
 * GlitchTip speaks the Sentry protocol, so the OFFICIAL `@sentry/vue` SDK is
 * used against a GlitchTip DSN (this replaces the retired Bugsnag setup —
 * `@bugsnag/js` / `@bugsnag/plugin-vue` are no longer dependencies).
 *
 * Verified against @sentry/vue@11.15.0:
 *   - `init({ app })` accepts the Vue 3 app instance (VueOptions.app) and
 *     installs the Vue error handler itself.
 *   - Tracing is NOT enabled automatically by `tracesSampleRate`: the browser
 *     SDK's default integration list has no tracing integration, so
 *     `browserTracingIntegration()` is added explicitly.
 *   - `autoSessionTracking` NO LONGER EXISTS (removed from the browser SDK
 *     before v11). Sessions are contributed by the default
 *     `BrowserSession` integration, which is filtered out here because
 *     GlitchTip does not support sessions.
 */
import * as Sentry from '@sentry/vue'

/*
 * The project DSN. A Sentry/GlitchTip DSN is a CLIENT-SIDE (public)
 * identifier — it grants event submission only, never read access.
 */
const GLITCHTIP_DSN = 'https://8d4c2aaa2e0d435e9b9c2a4214910b87@app.glitchtip.com/29962'

/**
 * Initialize GlitchTip for a Vue 3 application.
 *
 * Called from `main.js` after `createApp(...)`.
 *
 * @param {Object} app - the Vue application instance.
 */
export function useGlitchTip(app) {
    Sentry.init({
        app,
        dsn: GLITCHTIP_DSN,

        /* Performance sampling: 1% of transactions. */
        tracesSampleRate: 0.01,

        integrations: (defaultIntegrations) => [
            /* GlitchTip has no session support (the v11 equivalent of the
               removed `autoSessionTracking: false`). */
            ...defaultIntegrations.filter((integration) => integration.name !== 'BrowserSession'),

            /* Tracing must be added explicitly (see the note above). */
            Sentry.browserTracingIntegration(),
        ],

        /* PRIVACY — this is a wallet: component props can carry addresses,
           amounts and payment notes, so they are NEVER attached to events. */
        attachProps: false,

        /* Never send IP addresses / request headers by default. */
        sendDefaultPii: false,
    })
}

/* Export the (initialized) SDK for direct use if needed. */
export default Sentry
