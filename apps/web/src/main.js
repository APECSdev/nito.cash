/* Import (core) modules. */
import Vue from 'vue'
import VueSVGIcon from 'vue-svgicon'

/* Import (local) modules. */
import router from './router'
import store from './store'

/* Import main application. */
import App from './App.vue'

/* Import i18n module. */
import { i18n } from './plugins/i18n'

/* Initialize Bugsnag (error-handling). */
require('./plugins/bugsnag')

/* Initialize SVG icons. */
Vue.use(VueSVGIcon)

/* Set production flag. */
Vue.config.productionTip = false

/* Initialize Vue. */
new Vue({
    i18n,
    router,
    store,
    render: h => h(App),
}).$mount('#app')
