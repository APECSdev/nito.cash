<template>
    <button :class="[buttonClasses, classObject]">
        {{ loading ? loadingLabel : label }}
    </button>
</template>

<script>
export default {
    /*
     * NOTE (Vue 3): `.native` was removed. Parent templates listen with
     *       `@click.native="..."` / `@click="..."`; declaring `click` here lets
     *       Vue 3 treat it as fallthrough onto the inner `<button>`, so those
     *       handlers keep firing without touching every call site.
     */
    emits: ['click'],

    props: {
        label: String,
        loadingLabel: String,

        blank: Boolean,
        disabled: Boolean,
        double: Boolean,
        list: Boolean,
        loading: Boolean,
        secondary: Boolean,
        small: Boolean,
        warning: Boolean,
    },
    computed: {
        classObject: function () {
            return {
                blank: this.blank,
                disabled: this.disabled,
                double: this.double,
                list: this.list,
                loading: this.loading,
                secondary: this.secondary,
                small: this.small,
                warning: this.warning,
            }
        },

        /*
         * Phase D: the base button + variant styles (formerly scoped CSS) are
         * emitted as Tailwind utilities here, built fully conditionally so no
         * two same-property utilities ever compete in the cascade (one bg/color
         * branch, one height/font-size branch, one radius branch). The marker
         * classes in `classObject` are kept (unit tests assert them) but now
         * carry no scoped CSS — EXCEPT `double`, whose `button.double +
         * button.double` sibling override remains as scoped CSS (a sibling
         * relationship that cannot be expressed per-instance in utilities).
         */
        buttonClasses: function () {
            const c = ['block', 'w-full', 'font-bold']

            /* Background + foreground (mutually exclusive variants). */
            if (this.blank) {
                /* `background: none` kept literal for exact parity. */
                c.push('[background:none]', 'border', 'border-solid', 'border-fg', 'text-fg')
            } else if (this.secondary) {
                c.push('bg-secondary', 'text-secondary-fg', 'hover:bg-secondary-hover')
            } else if (this.warning) {
                c.push('bg-warning', 'text-warning-fg', 'hover:bg-warning-hover')
            } else {
                c.push('bg-primary', 'text-primary-fg', 'hover:bg-primary-hover')
            }

            /* Font-size + height (`small` always 45px/13px, else 54px/14px with
               the max-height:600px -> 48px override via the `short` variant). */
            if (this.small) {
                c.push('text-[13px]', 'h-[45px]')
            } else {
                c.push('text-[14px]', 'h-[54px]', 'short:h-[48px]')
            }

            /* Border-radius (the double's second-button override is scoped CSS). */
            if (this.double) {
                c.push('rounded-[30px_0_0_30px]')
            } else {
                c.push('rounded-[30px]')
            }

            /* State. */
            if (this.loading) c.push('pointer-events-none')
            if (this.disabled) c.push('pointer-events-none', 'opacity-50')

            return c
        }
    }
}
</script>

<style scoped>
/*
 * Phase D: the base button and every variant (`secondary`, `warning`, `small`,
 * `loading`, `disabled`, `blank`, the `max-height:600px` height override and
 * the `:hover` states) are converted to Tailwind utilities in the
 * `buttonClasses` computed above. The `double` base radius is a utility too.
 *
 * ONLY the `button.double + button.double` ADJACENT-SIBLING override remains
 * as scoped CSS: a button cannot know from its own props whether another
 * `double` button immediately precedes it, so this relationship genuinely
 * requires a CSS sibling selector. Being unlayered scoped CSS it correctly
 * overrides the (layered) `rounded-[30px_0_0_30px]` utility on the SECOND of
 * two adjacent `double` buttons — exactly the original behaviour.
 */
button.double + button.double {
    border-radius: 0 30px 30px 0;
    border-left: 1px solid var(--bg);
}
</style>
