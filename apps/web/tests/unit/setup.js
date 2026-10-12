/*
 * Vitest global setup (Phase B-half-2).
 *
 * Store sub-files do `new window.BITBOX()` at MODULE TOP-LEVEL (e.g.
 * `wallets/getters/getHDNode.js`, `profile/actions/initProfile.js`). In the
 * browser, `window.BITBOX` is provided by `public/js/bitbox.js` (a 2 MB UMD
 * bundle loaded via <script> in index.html). jsdom does NOT load that script,
 * so importing the real store (via the `vuex` shim alias) would throw
 * "window.BITBOX is not a constructor".
 *
 * Stub `window.BITBOX` here so the store modules can be imported in tests.
 * The stub is a Proxy-based constructor: any nested property access returns
 * another callable/constructible stub, so `bitbox.Mnemonic.fromEntropy(...)`,
 * `bitbox.Address.details(...)`, etc. are all safe no-ops that return stubs.
 * Tests that need real BITBOX behavior should mock the specific module.
 */

function makeBitboxStub() {
    /* A callable + constructible + endlessly-chainable stub. */
    const stub = new Proxy(function () {}, {
        /* `new stub()` and `stub(...)` both return another stub. */
        construct: () => makeBitboxStub(),
        apply: () => makeBitboxStub(),
        /* Any property access (e.g. `.Mnemonic`, `.Address`) returns a stub. */
        get: (target, prop) => {
            /* Let Symbol/toString inspection pass through harmlessly. */
            if (typeof prop === 'symbol') return undefined

            return makeBitboxStub()
        },
    })

    return stub
}

/* Install the global stub before any store module is imported. */
if (typeof window !== 'undefined' && !window.BITBOX) {
    window.BITBOX = makeBitboxStub()
}
