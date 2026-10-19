// apps/web/tests/unit/store/pool-store.spec.js
//
// Store-level tests for the sealed note store (src/store/modules/pool.js):
// decrypted notes live in a runtime-only mirror; only the AES-GCM ciphertext
// (`pool.sealed`) and public `pool.leaves` persist. Uses the real
// Pinia-backed facade (same pattern as popups/Import.spec.js).

import { createPinia, setActivePinia } from 'pinia'
import piniaPersist from 'pinia-plugin-persistedstate'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { useStore, StoreCompatPlugin, ensureStoreFacade, getStoreFacade } from '@/store'

/* A 32-byte entropy hex string, as profile.ms holds it. */
const ENTROPY = 'ab'.repeat(32)

function sampleNote() {
    return {
        value: '1000',
        ownerPub: '1234',
        rho: '18821383157269793795438455681495246036402687001665670618754263018637548127333',
        r: '42',
        nk: '7',
        cm: '999',
        nf: '888',
    }
}

describe('store/modules/pool', () => {
    beforeEach(async () => {
        /* Clear any persisted state from a prior test. */
        window.localStorage.clear()

        /* Fresh Pinia + facade (facade is cached on globalThis; a re-ensure
           against a new store in this isolated file realm is fine).
           Pinia defers plugins registered with `use()` until `install(app)`
           when no app is attached (no `app.use(pinia)` in tests), so set
           `_a` first to register the plugins immediately. */
        const pinia = createPinia()
        pinia._a = {}
        pinia.use(StoreCompatPlugin)
        pinia.use(piniaPersist)
        setActivePinia(pinia)
        ensureStoreFacade(useStore())

        const facade = getStoreFacade()

        /* Reset pool state + drop any seal key held from a prior test. */
        facade.state.pool.notes = []
        facade.state.pool.leaves = []
        facade.state.pool.sealed = null
        facade.dispatch('pool/lockPool')

        /* Set a wallet seed (namespaced profile mutation). */
        facade.commit('profile/setMasterSeed', ENTROPY)
    })

    it('stays locked without a seed and keeps notes runtime-only', async () => {
        const facade = getStoreFacade()

        facade.commit('profile/setMasterSeed', null)

        expect(await facade.dispatch('pool/unlockPool')).toBe(false)

        await facade.dispatch('pool/recordNote', sampleNote())

        expect(facade.state.pool.notes).toHaveLength(1)
        expect(facade.state.pool.sealed).toBeNull()
    })

    it('re-seals the ciphertext on recordNote and spendNote when unlocked', async () => {
        const facade = getStoreFacade()

        expect(await facade.dispatch('pool/unlockPool')).toBe(true)
        expect(facade.state.pool.sealed).toBeNull()

        await facade.dispatch('pool/recordNote', sampleNote())

        const sealed = facade.state.pool.sealed

        expect(sealed).toBeTruthy()
        expect(JSON.stringify(sealed)).not.toContain('18821383')
        expect(facade.state.pool.leaves).toEqual(['999'])

        await facade.dispatch('pool/spendNote', { nf: '888' })

        expect(facade.state.pool.sealed).not.toEqual(sealed)
    })

    it('rehydrates the runtime notes from the ciphertext on unlock', async () => {
        const facade = getStoreFacade()

        await facade.dispatch('pool/unlockPool')
        await facade.dispatch('pool/recordNote', sampleNote())

        /* Simulate a restart: drop the key + runtime mirror, keep `sealed`. */
        facade.dispatch('pool/lockPool')

        expect(facade.state.pool.notes).toEqual([])

        expect(await facade.dispatch('pool/unlockPool')).toBe(true)

        expect(facade.state.pool.notes).toEqual([
            { ...sampleNote(), leafIndex: 0, spent: false },
        ])
    })

    it('unlocks with an empty mirror when nothing is sealed yet', async () => {
        const facade = getStoreFacade()

        expect(await facade.dispatch('pool/unlockPool')).toBe(true)
        expect(facade.state.pool.notes).toEqual([])
    })

    it('persists only the sealed ciphertext, never plaintext notes', async () => {
        const facade = getStoreFacade()

        await facade.dispatch('pool/unlockPool')
        await facade.dispatch('pool/recordNote', sampleNote())

        /* Pinia store subscriptions flush asynchronously; let the persist
           plugin write before reading storage. */
        await nextTick()

        /* The persist plugin writes to localStorage under the 'vuex' key
           (VITE_APP_TARGET is unset in tests -> localStorage storage). */
        const persisted = window.localStorage.getItem('vuex')

        expect(persisted).toBeTruthy()

        const parsed = JSON.parse(persisted)

        /* Public leaves persist as plaintext. */
        expect(parsed.pool.leaves).toEqual(['999'])
        /* The sealed ciphertext persists... */
        expect(parsed.pool.sealed).toBeTruthy()
        /* ...but the plaintext notes mirror is omitted from persistence. */
        expect(parsed.pool.notes).toBeUndefined()
        expect(persisted).not.toContain('18821383')
    })
})
