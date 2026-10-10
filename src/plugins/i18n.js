import Vue from 'vue'
import VueI18n from 'vue-i18n'

/* Import (default) locale. */
import en from '@/i18n/en-US'

/* Initialize messages. */
const messages = { en }

/* Initialize (auto-detected) locale. */
// FIXME: Improve "lazy-loading".
//        http://kazupon.github.io/vue-i18n/guide/lazy-loading.html
// messages.ar = require('@/i18n/ar') // Arabic
// messages.cs = require('@/i18n/cs') // Czech
// messages.da = require('@/i18n/da') // Danish
messages.de = require('@/i18n/de') // German
// messages.es = require('@/i18n/es') // Spanish
// messages.et = require('@/i18n/et') // Estonian
// messages.fi = require('@/i18n/fi') // Finnish
messages.fr = require('@/i18n/fr') // French
// messages.ga = require('@/i18n/ga') // Irish
// messages.hi = require('@/i18n/hi') // Hindi
// messages.hr = require('@/i18n/hr') // Croatian
// messages.hu = require('@/i18n/hu') // Hungarian
// messages.in = require('@/i18n/in') // Indonesian
// messages.it = require('@/i18n/it') // Italian
// messages.iw = require('@/i18n/iw') // Hebrew
// messages.ja = require('@/i18n/ja') // Japanese
// messages.ko = require('@/i18n/ko') // Korean
// messages.nl = require('@/i18n/nl') // Dutch
// messages.no = require('@/i18n/no') // Norwegian
// messages.po = require('@/i18n/po') // Polish
// messages.pt = require('@/i18n/pt') // Portuguese
// messages.ru = require('@/i18n/ru') // Russian
// messages.sw = require('@/i18n/sw') // Swahili
// messages.sv = require('@/i18n/sv') // Swedish
// messages.ta = require('@/i18n/ta') // Tamil
// messages.th = require('@/i18n/th') // Thai
// messages.tr = require('@/i18n/tr') // Turkish
// messages.uk = require('@/i18n/uk') // Ukrainian
// messages.vi = require('@/i18n/vi') // Vietnamese
messages['zh-CN'] = require('@/i18n/zh-CN') // Chinese (PRC)
messages['zh-HK'] = require('@/i18n/zh-HK') // Chinese (Hong Kong)

/* Initialize plugin. */
Vue.use(VueI18n)

export const i18n = new VueI18n({
    /* Set (default) locale. */
    locale: 'en',

    /* Set (fallback) locale. */
    fallbackLocale: 'en',

    /* Set messages. */
    messages
})
