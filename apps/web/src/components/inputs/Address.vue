<template>
    <textarea
        placeholder="Recipient address"
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
        class="input-base h-[65px] inline-block align-middle py-[5px] px-[15px]"
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
 * px-[15px]`). The remaining base styling (margin, background, border,
 * border-radius, font, colour, width, height, focus, placeholder) comes from
 * the shared `input-base` component class (the relocated former global
 * `input, textarea` rule, now in `@layer components`); the utilities sit in
 * `@layer utilities` and override its height/padding exactly as the original
 * scoped CSS overrode the global rule.
 *
 * Original commented-out declaration preserved:
 * text-transform: uppercase;
 */
</style>
