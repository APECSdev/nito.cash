<template>
    <Popup :active="active">
        <section>
            <header>Passkey assistant — SeedVault backup</header>

            <article>
                <!-- ============ UNSUPPORTED ============ -->
                <p v-if="!supported" class="note">
                    <strong>This browser has no passkey support.</strong>
                    Use <em>Create SeedVault</em> to write the recovery phrase
                    down instead. Nothing was saved.
                </p>

                <template v-else>
                    <!-- ============ IDLE (no backup yet) ============ -->
                    <div v-if="state === 'idle' && !saved">
                        <p class="note">
                            Save this wallet's 24-word recovery phrase to a
                            <strong>passkey</strong>. The phrase is encrypted with a key
                            derived from your passkey (WebAuthn PRF extension) — the key
                            never leaves your authenticator, and nothing is sent to a
                            server.
                        </p>

                        <p class="note">
                            Anyone who can unlock this passkey on a supported device can
                            restore the wallet. Keep the written SeedVault as well.
                        </p>
                    </div>

                    <!-- ============ IDLE (backup exists) ============ -->
                    <div v-if="state === 'idle' && saved">
                        <p class="note">
                            <strong>Passkey backup found.</strong>
                            Saved {{ savedDate }}. Unlock the passkey to restore this
                            wallet on this device.
                        </p>

                        <p class="note">
                            The encrypted backup lives in THIS browser. A synced passkey
                            (iCloud / Google) can be used from your other devices, but
                            you must save the backup there first.
                        </p>
                    </div>

                    <!-- ============ BUSY ============ -->
                    <p v-if="state === 'working'" class="note">
                        <Spinner />
                        {{ busyLabel }}
                    </p>

                    <!-- ============ DONE ============ -->
                    <p v-if="state === 'saved'" class="note success">
                        <strong>Saved to your passkey.</strong>
                        The recovery phrase is encrypted in this browser and can only be
                        decrypted by this passkey.
                    </p>

                    <p v-if="state === 'restored'" class="note success">
                        <strong>Wallet restored.</strong>
                        The recovery phrase was decrypted with your passkey and the wallet
                        has been re-imported.
                    </p>

                    <!-- ============ ERROR ============ -->
                    <p v-if="state === 'error'" class="note error">
                        <strong>Could not complete.</strong>
                        {{ error }}
                    </p>

                    <!-- ============ ACTIONS ============ -->
                    <footer>
                        <template v-if="state === 'idle'">
                            <Button
                                v-if="!saved"
                                @click.native="save"
                                label="Save to Passkey" />

                            <template v-if="saved">
                                <Button @click.native="unlock" label="Restore with Passkey" />

                                <Button @click.native="forget" label="Forget backup" warning />
                            </template>
                        </template>

                        <template v-if="state === 'saved' || state === 'restored'">
                            <Button
                                @click.native="close"
                                :label="state === 'restored' ? 'Continue' : 'Done'" />
                        </template>

                        <template v-if="state === 'error' || state === 'working'">
                            <Button
                                @click.native="close"
                                label="Close"
                                blank />
                        </template>

                        <Button
                            v-if="state === 'idle'"
                            @click.native="close"
                            label="Cancel"
                            blank />
                    </footer>
                </template>
            </article>
        </section>
    </Popup>
</template>

<script>
/* Initialize vuex. */
import { mapActions, mapGetters } from 'vuex'

/* Import popup manager. */
import Popup from './Popup'

/* Import components. */
import { Button, Spinner } from '@/components'

/* Import crypto helpers (master entropy -> BIP39 mnemonic). */
import { mnemonicFromEntropy } from '@/lib/bch/crypto.js'

/* Import the passkey (WebAuthn PRF) helpers. */
import {
    createPasskeyBackup,
    forgetPasskeyBackup,
    getPasskeyRecord,
    passkeySupported,
    unlockWithPasskey,
} from '@/lib/passkey.js'

export default {
    components: {
        Button,
        Popup,
        Spinner,
    },
    props: {
        active: Boolean,
    },
    data: () => {
        return {
            supported: true,
            saved: false,
            savedDate: '',
            state: 'idle', // idle | working | saved | restored | error
            busyLabel: '',
            error: '',
        }
    },
    computed: {
        ...mapGetters('profile', [
            'getMasterSeed',
        ]),

        /* The wallet's BIP39 recovery phrase (from the master entropy). */
        mnemonic() {
            if (!this.getMasterSeed) {
                return ''
            }

            return mnemonicFromEntropy(this.getMasterSeed)
        },
    },
    methods: {
        ...mapActions([
            'displayNotification',
        ]),

        ...mapActions('wallets', [
            'restoreWallet',
        ]),

        /* Refresh the capability + stored-record state. */
        refresh() {
            this.supported = passkeySupported()

            const record = getPasskeyRecord()

            this.saved = !!record

            if (record && record.createdAt) {
                this.savedDate = new Date(record.createdAt).toLocaleDateString(navigator.language, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                })
            }
        },

        /* Encrypt the phrase to a new passkey. */
        async save() {
            this.error = ''

            if (!this.mnemonic) {
                this.state = 'error'
                this.error = 'No wallet recovery phrase is available.'

                return
            }

            this.state = 'working'
            this.busyLabel = 'Waiting for your passkey…'

            try {
                await createPasskeyBackup(this.mnemonic)

                this.refresh()
                this.state = 'saved'

                this.displayNotification('Seed phrase saved to passkey')
            } catch (err) {
                console.error('PASSKEY: save failed', err) // eslint-disable-line no-console

                this.state = 'error'
                this.error = err && err.message ? err.message : String(err)
            }
        },

        /* Decrypt the phrase with the passkey and re-import the wallet. */
        async unlock() {
            this.error = ''
            this.state = 'working'
            this.busyLabel = 'Waiting for your passkey…'

            try {
                const phrase = await unlockWithPasskey()

                this.busyLabel = 'Restoring wallet…'

                await this.restoreWallet(phrase)

                this.state = 'restored'

                this.displayNotification('Wallet restored from passkey')
            } catch (err) {
                console.error('PASSKEY: unlock failed', err) // eslint-disable-line no-console

                this.state = 'error'
                this.error = err && err.message ? err.message : String(err)
            }
        },

        /* Drop the stored ciphertext (the passkey itself stays). */
        forget() {
            forgetPasskeyBackup()

            this.refresh()
            this.state = 'idle'

            this.displayNotification('Passkey backup removed from this browser')
        },

        /* Close + reset the assistant (a restored wallet lands on the dashboard). */
        close() {
            const restored = this.state === 'restored'

            this.state = 'idle'
            this.error = ''

            this.$emit('close-passkey')

            if (restored) {
                this.$router.replace('/dashboard')
            }
        },
    },
    watch: {
        /* Re-read the stored record every time the popup opens. */
        active(_value) {
            if (_value) {
                this.state = 'idle'
                this.error = ''
                this.refresh()
            }
        },
    },
    created: function () {
        this.refresh()
    },
}
</script>

<style scoped>
section {
    position: absolute;
    top: 50%;
    left: 50%;
    width: calc(100% - 48px);
    max-width: calc(var(--max-width) - 48px);
    max-height: calc(100% - 48px);
    overflow-y: auto;
    transform: translate(-50%, -50%);
    background: var(--list-bg);
    border-radius: 10px;
}

header {
    padding: 20px 0;
    background: var(--primary);
    color: var(--primary-fg);
    text-align: center;
    border-radius: 10px 10px 0 0;
    font-size: 16px;
}

article {
    padding: 20px;
}

.note {
    font-size: 13px;
    line-height: 20px;
    color: var(--fg-muted);
    margin-bottom: 12px;
}

.note strong {
    color: var(--fg);
}

.note.success strong {
    color: var(--primary);
}

.note.error strong {
    color: var(--warning-text);
}

footer {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 16px;
}
</style>
