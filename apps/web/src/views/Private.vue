<template>
    <Modal :label="$t('private-view.title')" :help="true">
        <div class="flex-1 pt-[40px] px-[20px] pb-0">
            <div class="text-[13px] font-semibold text-warning text-center">
                Chipnet development preview — no real value
            </div>

            <div class="text-[16px] font-semibold text-trinary text-center mt-[24px]">
                Shielded balance
            </div>

            <div class="text-[24px] font-semibold text-trinary text-center mt-[8px]">
                {{shieldedBalance}} PUSD
            </div>

            <div class="text-[11px] font-semibold text-secondary text-center mt-[8px]">
                {{getNoteCount}} note(s) · {{getLeaves.length}} tree leaf(s)
            </div>

            <div v-for="note in getNotes" :key="note.nf" class="mt-[16px] text-[11px] font-semibold text-secondary">
                <span v-if="note.spent">(spent)</span>
                {{note.value}} PUSD · cm {{shorten(note.cm)}}
            </div>
        </div>

        <Footer>
            <Button label="Shield (coming soon)" :disabled="true" />
            <Button label="Transfer (coming soon)" :disabled="true" />
            <Button label="Unshield (coming soon)" :disabled="true" />
        </Footer>
    </Modal>
</template>

<script>
/* Initialize vuex. */
import { mapGetters } from 'vuex'

/* Import components. */
import { Button, Footer, Modal } from '@/components'

export default {
    components: {
        Button,
        Footer,
        Modal,
    },
    computed: {
        ...mapGetters('pool', [
            'getNotes',
            'getNoteCount',
            'getLeaves',
            'getShieldedBalance',
        ]),

        shieldedBalance() {
            /* Notes store field elements as decimal strings. */
            return this.getShieldedBalance.toString()
        },
    },
    methods: {
        shorten(field) {
            const s = String(field)

            return s.length > 16 ? s.slice(0, 8) + '…' + s.slice(-8) : s
        },
    },
}
</script>
