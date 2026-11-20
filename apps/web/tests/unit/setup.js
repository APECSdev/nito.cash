/* apps/web/tests/unit/setup.js
 *
 * Global test setup (registered as `setupFiles` in vitest.config.js).
 *
 * jsdom has no camera stack and no <video> playback, so mounting Send.vue
 * (whose `mounted` hook starts the QR scanner) created a QrScanner around a
 * null element and threw inside an async hook — an UNHANDLED rejection that
 * vitest reports as a suite-level error (it fails CI even when every
 * assertion passed). The scanner is replaced by an inert stub here; the
 * scanner-specific branches are exercised by the specs that mount Send.
 */
import { vi } from 'vitest'

vi.mock('qr-scanner', () => {
    class QrScannerStub {
        constructor(_video, _onDecode, _options) {
            this.video = _video
            this.onDecode = _onDecode
        }

        start() {
            return Promise.resolve()
        }

        stop() {}

        destroy() {}

        static hasCamera() {
            return Promise.resolve(false)
        }
    }

    return { default: QrScannerStub }
})
