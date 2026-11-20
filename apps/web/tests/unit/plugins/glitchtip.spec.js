/* Unit tests for src/plugins/glitchtip.js (the GlitchTip/Sentry wiring).
 *
 * The SDK itself is mocked: this asserts the CONFIGURATION we ship — DSN,
 * 1% tracing, the wallet-privacy switches, and the GlitchTip session filter.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sentry } = vi.hoisted(() => ({
    sentry: {
        init: vi.fn(),
        browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
    },
}))

vi.mock('@sentry/vue', () => ({
    init: sentry.init,
    browserTracingIntegration: sentry.browserTracingIntegration,
}))

import { useGlitchTip } from '@/plugins/glitchtip'

beforeEach(() => {
    sentry.init.mockClear()
    sentry.browserTracingIntegration.mockClear()
})

describe('plugins/glitchtip', () => {
    it('initializes the SDK with the GlitchTip DSN and the Vue app', () => {
        const app = { config: {} }

        useGlitchTip(app)

        expect(sentry.init).toHaveBeenCalledTimes(1)

        const options = sentry.init.mock.calls[0][0]

        expect(options.app).toBe(app)
        expect(options.dsn).toBe('https://8d4c2aaa2e0d435e9b9c2a4214910b87@app.glitchtip.com/29962')
    })

    it('samples 1% of transactions and keeps props private', () => {
        useGlitchTip({})

        const options = sentry.init.mock.calls[0][0]

        expect(options.tracesSampleRate).toBe(0.01)
        /* Wallet privacy: no component props, no default PII. */
        expect(options.attachProps).toBe(false)
        expect(options.sendDefaultPii).toBe(false)
    })

    it('filters the BrowserSession integration (GlitchTip has no sessions)', () => {
        useGlitchTip({})

        const options = sentry.init.mock.calls[0][0]
        const defaults = [
            { name: 'GlobalHandlers' },
            { name: 'BrowserSession' },
            { name: 'Dedupe' },
        ]

        const resolved = options.integrations(defaults)

        expect(resolved.map((integration) => integration.name))
            .toEqual(['GlobalHandlers', 'Dedupe', 'BrowserTracing'])

        /* Tracing is NOT part of the browser SDK's defaults — it is added. */
        expect(sentry.browserTracingIntegration).toHaveBeenCalledTimes(1)
    })
})
