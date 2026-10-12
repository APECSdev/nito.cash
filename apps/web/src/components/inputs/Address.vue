<template>
    <textarea
        placeholder="Recipient address"
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
        class="h-[65px] inline-block align-middle py-[5px] px-[15px]"
    />
</template>

<script>
export default {
    /*
     * NOTE (Vue 3): `v-model` now passes `modelValue` and listens for
     *       `update:modelValue` (previously `value` / `input`). The parent
     *       `<Address v-model="receiver" :address="receiver" />` keeps working;
     *       its `:address` prop is now simply unused by this component.
     */
    props: {
        modelValue: String,
    },
    emits: ['update:modelValue'],
}
</script>

<style scoped>
/*
 * Phase D: the scoped `textarea` overrides are converted to Tailwind utilities
 * on the template above (`h-[65px] inline-block align-middle py-[5px]
 * px-[15px]`); being in `@layer utilities` they correctly override App.vue's
 * global `input, textarea` base rule (in `@layer base`) for height and
 * padding, exactly as the original scoped CSS did. The remaining base styling
 * (background, border, colour, focus, placeholder) still comes from that
 * global rule, which is retained for now (shared with Amount/Send/Spend).
 *
 * Original commented-out declaration preserved:
 * text-transform: uppercase;
 */
</style>
