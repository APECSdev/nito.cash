<template>
    <main class="flex flex-col justify-between flex-1 px-[20px] h-[calc(100vh-58px-65px)] overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <header class="p-[15px]">
            Welcome to the Concierge Lobby!
        </header>

        <footer>
            <Button @click.native="coming" label="Open Chat" double secondary :disabled="!hasPrivilege" />
            <Button @click.native="coming" label="Today's Deals" double secondary :disabled="!hasPrivilege" />
        </footer>

        <Footer>
            what should we put here??
        </Footer>
    </main>
</template>

<script>
/* Import components. */
import { Button, Footer } from '@/components'

export default {
    components: {
        Button,
        Footer,
    },
    data: () => {
        return {
            hasPrivilege: false,
        }
    },
    methods: {
        coming() {
            console.log('COMING SOON...')
        }
    },
}
</script>
