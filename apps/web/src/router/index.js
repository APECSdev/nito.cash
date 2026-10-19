import { createRouter, createWebHashHistory } from 'vue-router'

/* Import MAIN components. */
import Splash from '@/views/Splash'
import Setup from '@/views/Setup'

import Concierge from '@/views/Concierge'
import ConciergeSpendAdvanced from '@/views/Concierge/Spend/Advanced'

import Dashboard from '@/views/Dashboard'

import History from '@/views/History'

import Private from '@/views/Private'

import Receive from '@/views/Receive'

import Send from '@/views/Send'

import Settings from '@/views/Settings'

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
    path: '/private',
    component: Private
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
