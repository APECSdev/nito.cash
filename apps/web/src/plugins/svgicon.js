/**
 * SVG Icon Plugin
 *
 * A minimal, dependency-free replacement for the (removed) `vue-svgicon`
 * package, compatible with Vue 3.
 *
 * The generated icon modules in `@/compiled-icons/*` still call
 * `icon.register({ '<name>': { width, height, viewBox, data } })`, so this
 * plugin exposes a compatible registry at `window.__svgicons` (see
 * `@/compiled-icons/register.js`). The global `<svgicon>` component renders
 * the registered icon's raw SVG `data`, honouring the per-path `_fill`
 * colours embedded at generation time.
 *
 * Usage (unchanged from vue-svgicon):
 *     <svgicon icon="alarm" width="54" height="54" :fill="false" :original="true" />
 */

import { h } from 'vue'

/* Initialize (global) icon registry. */
const registry = (typeof window !== 'undefined')
    ? (window.__svgicons = window.__svgicons || {})
    : {}

/* Register one (or more) icons into the registry. */
export function register(icons) {
    Object.keys(icons).forEach((name) => {
        registry[name] = icons[name]
    })
}

/* Expose the registry (used by `@/compiled-icons/register.js`). */
if (typeof window !== 'undefined') {
    window.__svgicons = registry
    window.__svgiconRegister = register
}

/**
 * SvgIcon Component
 */
const SvgIcon = {
    name: 'svgicon',

    props: {
        /* Icon name (as registered). */
        icon: {
            type: String,
            required: true,
        },
        /* Rendered width (falls back to the icon's intrinsic width). */
        width: {
            type: [String, Number],
            default: null,
        },
        /* Rendered height (falls back to the icon's intrinsic height). */
        height: {
            type: [String, Number],
            default: null,
        },
        /* vue-svgicon compat: `true` = use `fill` colour, `false` = original colours. */
        fill: {
            type: Boolean,
            default: false,
        },
        /* vue-svgicon compat: `true` keeps the icon's original (embedded) colours. */
        original: {
            type: Boolean,
            default: false,
        },
    },

    computed: {
        /* Retrieve the registered icon. */
        _icon() {
            return registry[this.icon] || null
        },

        /* Compute the viewBox. */
        _viewBox() {
            /* Return the icon's own viewBox, if set. */
            if (this._icon && this._icon.viewBox) {
                return this._icon.viewBox
            }

            /* Fallback to a width/height box. */
            if (this._icon) {
                return `0 0 ${this._icon.width} ${this._icon.height}`
            }

            return '0 0 0 0'
        },

        /* Compute the rendered width. */
        _width() {
            return this.width || (this._icon && this._icon.width) || 0
        },

        /* Compute the rendered height. */
        _height() {
            return this.height || (this._icon && this._icon.height) || 0
        },

        /* Build the SVG inner content (convert the generator's `_fill` to `fill`). */
        _content() {
            if (!this._icon) {
                return ''
            }

            /* Replace the generator's `_fill` attribute with a real `fill`. */
            return String(this._icon.data).replace(/ _fill=/g, ' fill=')
        },
    },

    /* Render the icon as inline SVG. */
    render() {
        return h('svg', {
            class: 'svg-icon',
            xmlns: 'http://www.w3.org/2000/svg',
            width: this._width,
            height: this._height,
            viewBox: this._viewBox,
            /* NOTE: `innerHTML` is used to inject the (trusted, generated) SVG path data. */
            innerHTML: this._content,
        })
    },
}

/* Export plugin (Vue 3 `install`). */
export default {
    install(app) {
        app.component('svgicon', SvgIcon)
    },
}
