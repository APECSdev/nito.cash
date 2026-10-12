<template>
    <textarea
        placeholder="Recipient address"
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
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
textarea {
    height: 65px;
    display: inline-block;
    vertical-align: middle;
    padding: 5px 15px;
    /* text-transform: uppercase; */
}
</style>
