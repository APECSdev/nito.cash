<template>
    <button :class="[buttonClasses, classObject]">
        {{ loading ? loadingLabel : label }}
    </button>
</template>

<script>
export default {
    /*
     * NOTE (Vue 3): the compiler strips the `.native` modifier, so every
     *       parent handler (`@click.native="..."` / `@click="..."`) arrives as
     *       a plain `onClick` prop. `click` must therefore NOT be declared in
     *       `emits`: a declared emit is filtered OUT of attrs fallthrough, and
     *       this component never `$emit`s one — every call site's handler
     *       would silently never fire (verified empirically on vue 3.5.43).
     *       With no `emits` entry, the listener falls through onto the inner
     *       `<button>` and fires as a native click, keeping all call sites
     *       unchanged.
     */

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
            /* Modern base: pill, semibold, gentle lift + halo on hover,
               visible focus ring, pressed scale. (Marker classes for the
               variants still live in `classObject`.) */
            const c = [
                'block',
                'w-full',
                'font-semibold',
                'tracking-[0.01em]',
                'transition-[transform,box-shadow,filter,opacity]',
                'duration-150',
                'ease-out',
                'active:scale-[0.985]',
                'focus-visible:ring-2',
                'focus-visible:ring-ring',
            ]

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

            /* Elevation (per variant, so the halo color matches the surface). */
            if (this.blank || this.disabled) {
                /* Flat — no halo for outline/disabled states. */
            } else if (this.secondary) {
                c.push('shadow-[0_10px_26px_-12px_rgba(255,197,85,0.65)]')
            } else if (this.warning) {
                c.push('shadow-[0_10px_26px_-12px_rgba(211,63,73,0.6)]')
            } else {
                c.push('shadow-[0_10px_26px_-12px_rgba(47,102,224,0.55)]')
            }

            if (!this.disabled && !this.loading) {
                c.push('hover:-translate-y-[1px]', 'hover:brightness-110')
            }

            /* Border-radius. NOTE: `double` is now a fully-rounded pill too —
               the old flush-halves join (0-radius inner corners + a 1px
               --bg divider, “buttons touching”) read as cramped; the pair
               now gets its spacing from the Footer gap (below). */
            c.push('rounded-[30px]')

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
 * `buttonClasses` computed above.
 *
 * REDESIGN: the old `button.double + button.double` adjacent-sibling join
 * (flush halves with a 0-radius inner corner + 1px divider — the “buttons
 * touching” effect) is GONE. Both pair members are now fully-rounded pills;
 * their spacing comes from the Footer's flex gap, and the pair still splits
 * the row evenly because each member keeps `w-full` (flex-shrink halves
 * them around the gap).
 */
</style>
