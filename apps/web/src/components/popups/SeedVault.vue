<template>
    <Popup :active="active">
        <section>
            <header>SeedVault — wallet backup</header>

            <article>
                <p class="seed-warning">
                    <strong>Write these words down and keep them safe.</strong>
                    This is the ONLY way to recover this wallet. Anyone with
                    these words can spend your funds — never share them.
                </p>

                <div class="seed-words">
                    <span v-for="(word, index) of words" :key="index">{{word}}</span>
                </div>

                <footer>
                    <Button @click.native="copy" :label="copied ? 'Copied ✓' : 'Copy SeedVault'" />

                    <Button
                        @click.native="$emit('close-seed-vault')"
                        label="Done"
                        blank />
                </footer>
            </article>
        </section>
    </Popup>
</template>

<script>
/* Initialize vuex. */
import { mapGetters } from 'vuex'

/* Import popup manager. */
import Popup from './Popup'

/* Import components. */
import { Button } from '@/components'

/* Import crypto helpers (master entropy -> BIP39 mnemonic). */
import { mnemonicFromEntropy } from '@/lib/bch/crypto.js'

export default {
    components: {
        Button,
        Popup,
    },
    props: {
        active: Boolean,
    },
    data: () => {
        return {
            copied: false,
            copiedTimer: null,
        }
    },
    computed: {
        ...mapGetters('profile', [
            'getMasterSeed',
        ]),

        /* The wallet's BIP39 recovery phrase (from the master entropy). */
        mnemonic() {
            /* Validate (master) seed. */
            if (!this.getMasterSeed) {
                return ''
            }

            /* Return (BIP39) mnemonic. */
            return mnemonicFromEntropy(this.getMasterSeed)
        },

        /* The mnemonic, split into words (for the display grid). */
        words() {
            return this.mnemonic ? this.mnemonic.split(' ') : []
        },
    },
    methods: {
        /**
         * Copy (SeedVault) mnemonic
         */
        copy() {
            /* Validate (mnemonic). */
            if (!this.mnemonic) {
                return
            }

            /* Set clipboard. */
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(this.mnemonic).catch(() => {})
            }

            /* Update (copied) display state. */
            this.copied = true

            clearTimeout(this.copiedTimer)

            this.copiedTimer = setTimeout(() => {
                this.copied = false
            }, 1600)
        },
    },
    beforeUnmount() {
        /* Cleanup (copied) timer. */
        clearTimeout(this.copiedTimer)
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
    background: var(--warning);
    color: var(--warning-fg);
    text-align: center;
    border-radius: 10px 10px 0 0;
    font-size: 16px;
    font-weight: 600;
    text-transform: uppercase;
}

article {
    padding: 24px 24px 16px;
}

p.seed-warning {
    font-size: 13px;
    line-height: 19px;
    margin-bottom: 16px;
}

p.seed-warning strong {
    font-weight: 600;
}

div.seed-words {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    padding: 14px 12px;
    background: var(--box-bg);
    border: 1px solid var(--input-border);
    border-radius: 10px;
    font-size: 13px;
    line-height: 18px;
    text-align: center;
    word-break: break-word;
    user-select: all;
}

footer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 16px;
    padding-bottom: 8px;
}
</style>
