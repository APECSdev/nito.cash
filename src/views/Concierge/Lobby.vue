<template>
    <main>
        <header>
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

<style scoped>
main {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 20px 20px 0;
}

header {
    padding: 15px;
}
</style>
