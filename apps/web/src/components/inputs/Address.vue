<template>
    <textarea
        placeholder="Recipient address"
        :value="address"
        @input="$emit('input', $event.target.value)"
    />
</template>

<script>
export default {
    props: {
        address: String,
    }
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
