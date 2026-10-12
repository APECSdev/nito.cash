<template>
    <div class="popup" :class="{ active: activeFlag, solid }">
        <slot />
    </div>
</template>

<script>
export default {
    props: {
        active: [Boolean, String],
        solid: Boolean,
    },
    computed: {
        /* NOTE (Vue 3): the template's `:class="{ active }"` reads this computed
           (shadowing the prop), and the escape handler writes it. A computed
           set() avoids the "mutating a prop" anti-pattern / Vue 3 read-only
           proxy TypeError. The parent owns `active` (1-way data flow) and never
           listened for a close event, so the write is a no-op: pressing escape
           leaves visibility unchanged, exactly as the original Vue 2 code did
           logically (its local prop write was never synced to the parent). */
        activeFlag: {
            get() {
                return this.active
            },
            set(_value) {
                /* No-op (see NOTE above). */
            },
        },
    },
    created: function () {
        /* Setup escape key press. */
        document.onkeydown = evt => {
            /* Capture window event. */
            evt = evt || window.event

            /* Detect `escape` key. */
            if (evt.keyCode === 27) {
                /* Set flag. */
                this.activeFlag = null
            }
        }
    },
}
</script>

<style scoped>
.popup {
    display: flex;
    align-items: center;
    justify-content: center;
    position: fixed;
    top: 50%;
    left: 50%;
    width: 100%;
    height: 100%;
    max-width: var(--max-width);
    max-height: var(--max-height);
    transform: translate(-50%, -50%);
    overflow: hidden;
    background: var(--popup-bg);
    z-index: 3;
    pointer-events: none;
    transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0;
}

@media (max-width: 520px) {
    .popup {
        max-width: 100%;
        max-height: 100%;
    }
}

.popup.solid {
    background: var(--bg);
}

.popup.active {
    opacity: 1;
    pointer-events: all;
}
</style>
