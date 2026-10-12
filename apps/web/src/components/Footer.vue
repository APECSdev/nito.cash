<template>
    <footer
        :class="tooltip
            ? 'tooltip block w-full m-0 text-[12px] bg-box-bg rounded-t-[20px] p-5 short:p-4'
            : 'flex w-full p-5 short:p-4'"
    >
        <slot />
    </footer>
</template>

<script>
export default {
    props: {
        tooltip: Boolean,
    }
}
</script>

<style scoped>
</style>
