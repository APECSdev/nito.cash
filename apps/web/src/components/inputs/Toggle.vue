<template>
    <div class="toggle block relative w-[41px] h-[23px] rounded-[23px] bg-box-bg cursor-pointer"
        @click="update"
        :class="[{ disabled }, disabled ? 'pointer-events-none' : '']">
        <div class="knob absolute top-[2px] h-[19px] w-[19px] rounded-[19px] bg-primary transition-all duration-100 ease-[cubic-bezier(0.4,0,0.2,1)]"
            :class="[{ active }, (active && !disabled) ? 'left-[20px] opacity-100' : 'left-[2px] opacity-20']" />
    </div>
</template>

<script>
export default {
    props: {
        disabled: Boolean,
        on: Boolean,
    },
    data: () => {
        return {
            selectedPos: null,
        }
    },
    computed: {
        active: function () {
            return this.selectedPos !== null ? this.selectedPos : this.on
        }
    },
    methods: {
        update() {
            /* Initialize selected position (if necessary). */
            if (this.selectedPos === null) {
                this.selectedPos = this.on
            }

            /* Toggle position. */
            this.selectedPos = !this.selectedPos

            /* Notify any (listening) parent of the (new) position. */
            // NOTE: Backward-compatible — existing usages (eg. Dark mode,
            //       Notifications) attach no listener and are unaffected.
            this.$emit('toggle', this.selectedPos)
        }
    },

}
</script>

<style scoped>
/*
 * Phase D: `.toggle` / `.toggle.disabled` / `.knob` / `.knob.active` are
 * converted to Tailwind utilities on the template above. The `toggle`, `knob`,
 * `active` and `disabled` classes are kept as state hooks (unit tests assert
 * `.knob` `active` and `.toggle` `disabled`), now carrying no scoped CSS.
 *
 * The `.toggle.disabled .knob.active` override (a DISABLED toggle renders its
 * knob in the inactive position/colour even when `active`) is preserved by
 * making the knob's `left`/`opacity` conditional on `active && !disabled` —
 * the `active` marker class still tracks `active` alone (as before), while the
 * visual position/opacity honour the disabled override, exactly matching the
 * original specificity (.toggle.disabled .knob.active beat .knob.active).
 */
</style>
