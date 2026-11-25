/* apps/demo/scripts/copy-app.mjs
 *
 * Copies the built wallet (apps/web/dist-vite) into the demo bundle at
 * dist/app/ so the portal can frame the REAL app same-origin. Same-origin is
 * the whole point: the tour seeds the store and installs the mock chain
 * through `iframe.contentWindow` (src/lib/demo.js).
 *
 * The copy is post-processed:
 *   - <meta name="robots" content="noindex"> — the framed app is not a page
 *   - the Matomo block is removed — the demo must not report into the
 *     production analytics site
 *
 * Run AFTER `pnpm build` (the web wallet build); CI does this in order.
 */
import { cp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../web/dist-vite')
const dest = resolve(here, '../dist/app')

try {
    await stat(resolve(src, 'index.html'))
} catch {
    console.error('demo: missing web build at', src)
    console.error('demo: run `pnpm build` (apps/web) before building the demo')
    process.exit(1)
}

await rm(dest, { recursive: true, force: true })
await cp(src, dest, { recursive: true })

/* The proving key is 93 MiB and gitignored (never in the CI build); Cloudflare
   Pages caps files at 25 MiB. Drop it defensively when a local build carries it. */
await rm(resolve(dest, 'proving/pool_final.zkey'), { force: true })

const indexPath = resolve(dest, 'index.html')
let html = await readFile(indexPath, 'utf8')

/* No double-injection if the source ever carries a robots tag. */
html = html.replace(/<meta\s+name="robots"[^>]*>\s*/gi, '')
html = html.replace('<head>', '<head>\n    <meta name="robots" content="noindex">')

/* Strip the production analytics block (comment + script + end marker). */
html = html.replace(/<!-- Matomo[\s\S]*?<!-- End Matomo Code -->\s*/g, '')

await writeFile(indexPath, html)

console.log('demo: copied web build ->', dest)
