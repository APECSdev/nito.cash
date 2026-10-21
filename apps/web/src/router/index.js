import { createRouter, createWebHashHistory } from 'vue-router'

/* Import MAIN components. */
import Splash from '@/views/Splash'
import Setup from '@/views/Setup'

import Concierge from '@/views/Concierge'
import ConciergeSpendAdvanced from '@/views/Concierge/Spend/Advanced'

import Dashboard from '@/views/Dashboard'

import History from '@/views/History'

import Receive from '@/views/Receive'

import Send from '@/views/Send'

import Settings from '@/views/Settings'

import Wallet from '@/views/Wallet'

/**
 * Initialize Routes
 */
const routes = [{
    path: '/',
    component: Splash
}, {
    path: '/concierge',
    component: Concierge
}, {
    path: '/concierge/spend/advanced',
    component: ConciergeSpendAdvanced
}, {
    path: '/dashboard',
    component: Dashboard
}, {
    path: '/history',
    component: History
}, {
    /* The old placeholder shielded view is superseded by the 4-wallet screen;
       redirect any stale link to the Nito Cash wallet. */
    path: '/private',
    redirect: '/wallets/nito-cash'
}, {
    /* The 4-wallet model; `/wallets` (no param) lands on the default
       wallet (Nito Cash). */
    path: '/wallets/:walletId?',
    component: Wallet
}, {
    path: '/receive',
    component: Receive
}, {
    path: '/send',
    component: Send
}, {
    path: '/settings',
    component: Settings
}, {
    path: '/setup',
    component: Setup
}]

/* Export Vue Router. */
export default createRouter({
    /* Hash mode preserves the existing (Vue 2) '#/...' URLs and static hosting. */
    history: createWebHashHistory(),
    routes,
})
