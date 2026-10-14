<template>
    <div>
        <Header :label="$t('concierge-view.title')" />

        <Tabs :tabs="tabs" :tab="tab" v-on:tab-change="updateTab" />

        <Lobby v-if="tab === 'Lobby'" />
        <Earn v-if="tab === 'Earn'" />
        <Spend v-if="tab === 'Spend'" />
    </div>
</template>

<script>
/* Initialize vuex. */
import { mapActions } from 'vuex'

/* Import components. */
import { Header, Tabs } from '@/components'

/* Import views. */
import Earn from './Concierge/Earn'
import Lobby from './Concierge/Lobby'
import Spend from './Concierge/Spend'

export default {
    components: {
        Header,
        Tabs,

        Earn,
        Lobby,
        Spend,
    },
    data: () => {
        return {
            tab: 'Lobby',
            tabs: ['Earn', 'Lobby', 'Spend'],
        }
    },
    computed: {
        /* Returns history items. */
        items() {
            /* Return items (from history). */
            return []
        },
    },
    methods: {
        ...mapActions([
            'displayError',
            'displayNotification',
        ]),

        /**
         * Update Tab
         */
        updateTab(_tab) {
            /* Update tab. */
            this.tab = _tab
        },

    },
    created: function () {
        //
    },
    mounted: function () {
        //
    }
}
</script>
