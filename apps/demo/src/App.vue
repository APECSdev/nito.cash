<!-- apps/demo/src/App.vue — demo.nito.cash portal -->
<template>
    <div class="relative min-h-screen overflow-x-clip">
        <div class="bg-ornaments" aria-hidden="true">
            <span class="orb orb-a"></span>
            <span class="orb orb-b"></span>
            <span class="grid-bg"></span>
        </div>

        <header class="relative z-20">
            <div class="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-4 md:px-8">
                <a href="https://nito.cash" class="flex items-center gap-2.5">
                    <img src="/logo.png" alt="" class="h-8 w-8 rounded-[10px]" />
                    <span class="text-[16px] font-semibold tracking-tight">nito<span class="text-electric">.cash</span></span>
                    <span class="rounded-full border border-white/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-mist">demo</span>
                </a>

                <nav class="flex items-center gap-1">
                    <button class="navlink" @click="startTour">Watch</button>
                    <button class="navlink" @click="startTry">Try it</button>
                    <a class="navlink hidden sm:inline-flex" href="https://github.com/APECSdev/nito.cash" target="_blank" rel="noopener">GitHub ↗</a>
                </nav>
            </div>
        </header>

        <main class="relative z-10 mx-auto grid max-w-[1180px] gap-8 px-5 pb-10 md:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:gap-x-16">
            <section class="pt-6 md:pt-10">
                <p class="eyebrow">Live demo · no sign-up</p>

                <h1 class="mt-3 text-[44px] font-semibold leading-[1.02] tracking-[-0.035em] sm:text-[58px]">
                    Hush your <span class="text-amber">money.</span>
                </h1>

                <p class="mt-4 max-w-[48ch] text-[15px] leading-[1.7] text-mist sm:text-[16px]">
                    A non-custodial Bitcoin Cash wallet with a shielded stablecoin pool.
                    Watch the guided tour — or take the wheel and use the real app.
                </p>

                <div class="mt-6 flex flex-wrap gap-3">
                    <button class="btn-primary" @click="startTour">
                        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                        Play the walkthrough
                    </button>
                    <button class="btn-ghost" @click="startTry">Try it yourself</button>
                </div>

                <ul class="mt-6 flex flex-wrap gap-2">
                    <li class="chip">Non-custodial</li>
                    <li class="chip">Mainnet + Chipnet</li>
                    <li class="chip">Shielded PUSD</li>
                    <li class="chip">Open source</li>
                </ul>
            </section>

            <section id="phone" class="flex justify-center lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start lg:items-start lg:pt-6">
                <div class="phone">
                    <div class="phone-shell">
                        <div class="phone-screen">
                            <iframe ref="frame" src="./app/" title="Nito.cash live demo" @load="onFrameLoad"></iframe>

                            <div v-if="!ready && !failed" class="phone-loading">
                                <span class="spinner"></span>
                                Starting the live app…
                            </div>

                            <div v-if="failed" class="phone-loading">
                                <p class="px-6 text-center text-[12px] leading-[1.6]">
                                    The live app could not start.<br />{{ failed }}
                                </p>
                                <a href="https://nito.cash" class="text-[12px] font-semibold text-electric underline underline-offset-4">Open nito.cash →</a>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="stage" class="lg:col-start-1 lg:row-start-2">
                <div class="panel">
                    <div class="flex items-center justify-between">
                        <span class="live text-[10px] font-bold uppercase tracking-[0.2em] text-electric">
                            <i></i>{{ mode === 'watch' ? 'Now playing' : 'You are driving' }}
                        </span>
                        <span class="counter">{{ pad(index + 1) }} / {{ pad(CHAPTERS.length) }}</span>
                    </div>

                    <template v-if="mode === 'watch'">
                        <h2 class="mt-3 text-[23px] font-semibold leading-[1.15] tracking-[-0.02em]">
                            {{ chapter.title }}
                        </h2>
                        <p class="mt-2 text-[13.5px] leading-[1.65] text-muted">{{ chapter.body }}</p>

                        <ul class="mt-3 space-y-1.5">
                            <li v-for="bullet in chapter.bullets" :key="bullet" class="flex gap-2 text-[12.5px] leading-[1.5] text-ink/80">
                                <span class="mt-[2px] font-bold text-ok">✓</span>
                                <span>{{ bullet }}</span>
                            </li>
                        </ul>
                    </template>

                    <template v-else>
                        <h2 class="mt-3 text-[23px] font-semibold leading-[1.15] tracking-[-0.02em]">
                            The app is live.
                        </h2>
                        <p class="mt-2 text-[13.5px] leading-[1.65] text-muted">
                            This is the real wallet, seeded with a fixed test wallet and a simulated chain.
                            Tap anything — no real funds can move.
                        </p>
                        <p class="mt-3 rounded-[12px] bg-electric/[0.07] px-3 py-2 text-[12.5px] font-medium leading-[1.5] text-electric">
                            {{ chapter.hint }}
                        </p>
                    </template>

                    <div class="mt-4 flex items-center gap-2">
                        <button class="iconbtn" :disabled="index === 0" aria-label="Previous chapter" @click="goPrev">
                            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                        </button>

                        <button class="iconbtn border-transparent bg-electric text-white hover:bg-electric" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
                            <svg v-if="playing" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
                            <svg v-else class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                        </button>

                        <button class="iconbtn" aria-label="Next chapter" @click="goNext">
                            <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                        </button>

                        <div class="ml-auto flex items-center gap-3">
                            <button class="text-[11px] font-semibold text-muted underline-offset-4 hover:text-ink hover:underline" @click="restart">Restart</button>
                            <button v-if="mode === 'watch'" class="text-[11px] font-semibold text-electric underline-offset-4 hover:underline" @click="startTry">Try it →</button>
                            <button v-else class="text-[11px] font-semibold text-electric underline-offset-4 hover:underline" @click="backToTour">← Back to tour</button>
                        </div>
                    </div>

                    <div class="bar mt-4"><i :style="{ width: pct + '%' }"></i></div>

                    <div class="mt-4 flex flex-wrap gap-1.5">
                        <button
                            v-for="(item, i) in CHAPTERS"
                            :key="item.id"
                            class="chap"
                            :class="{ 'chap-on': i === index }"
                            @click="jump(i)"
                        >
                            <span class="font-mono">{{ pad(i + 1) }}</span>
                            {{ item.label }}
                        </button>
                    </div>
                </div>
            </section>
        </main>

        <footer class="relative z-10 border-t border-white/10">
            <div class="mx-auto flex max-w-[1180px] flex-col gap-3 px-5 py-6 text-[11.5px] text-mist md:flex-row md:items-center md:justify-between md:px-8">
                <p>
                    <span class="font-semibold text-paper">Demo wallet</span> — fixed test seed, simulated chain.
                    No real funds can move.
                </p>
                <div class="flex flex-wrap items-center gap-4">
                    <a href="https://nito.cash" class="hover:text-paper">nito.cash</a>
                    <a href="https://blaze.nito.cash" class="hover:text-paper">Shielded-pool evidence</a>
                    <a href="https://github.com/APECSdev/nito.cash" class="hover:text-paper">GitHub</a>
                    <span>MIT</span>
                </div>
            </div>
        </footer>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'

import { CHAPTERS } from './lib/tour'
import { clickText, closeBlaze, dismissNotification, go, reset, scrollToRound, scrollTop, seed, sleep, waitForApp } from './lib/demo'

const frame = ref(null)
const ready = ref(false)
const failed = ref('')

const mode = ref('watch')
const index = ref(0)
const playing = ref(false)
const finished = ref(false)
const elapsed = ref(0)
const holdMs = ref(CHAPTERS[0].hold)

let raf = 0
let timer = 0
let started = 0
let seeded = false
let autostart = false

const chapter = computed(() => CHAPTERS[index.value])

const pct = computed(() => {
    const within = holdMs.value ? Math.min(1, elapsed.value / holdMs.value) : 0
    const overall = Math.min(1, (index.value + within) / CHAPTERS.length)

    return Math.round(overall * 100)
})

function pad(n) {
    return String(n).padStart(2, '0')
}

function stopTimers() {
    playing.value = false
    cancelAnimationFrame(raf)
    clearTimeout(timer)
}

function tick() {
    if (!playing.value) return

    elapsed.value = Math.min(holdMs.value, performance.now() - started)

    if (elapsed.value < holdMs.value) raf = requestAnimationFrame(tick)
}

function play(ms) {
    stopTimers()

    holdMs.value = ms
    elapsed.value = 0
    started = performance.now()
    playing.value = true

    timer = window.setTimeout(advance, ms)
    raf = requestAnimationFrame(tick)
}

function resume() {
    playing.value = true
    started = performance.now() - elapsed.value
    timer = window.setTimeout(advance, Math.max(300, holdMs.value - elapsed.value))
    raf = requestAnimationFrame(tick)
}

function advance() {
    if (index.value >= CHAPTERS.length - 1) {
        stopTimers()
        finished.value = true
        elapsed.value = holdMs.value

        return
    }

    enter(index.value + 1, true)
}

async function ensureSeed(win) {
    if (seeded) return

    await seed(win)
    seeded = true
}

async function enter(i, auto = false) {
    if (i < 0 || i >= CHAPTERS.length) return

    stopTimers()
    finished.value = false
    index.value = i
    holdMs.value = CHAPTERS[i].hold
    elapsed.value = 0

    const win = frame.value && frame.value.contentWindow
    const item = CHAPTERS[i]

    if (win && ready.value) {
        if (item.seed) {
            try {
                await ensureSeed(win)
            } catch (err) {
                failed.value = err && err.message ? err.message : String(err)
            }
        }

        go(win, item.route)

        /* Splash / Setup / Dashboard each mount their own BlazeBanner with
           `open: true`; close it once the dashboard is on screen. */
        if (item.route === '/dashboard') closeBlaze(win).catch(() => {})

        if (item.action) {
            item.action({
                wait: sleep,
                click: (text) => clickText(win, text),
                scroll: () => scrollToRound(win),
                top: () => scrollTop(win),
                dismiss: () => dismissNotification(win),
            }).catch(() => {})
        }
    }

    if (auto) play(item.hold)
}

function goPrev() {
    enter(index.value - 1, playing.value)
}

function goNext() {
    if (index.value >= CHAPTERS.length - 1) {
        stopTimers()
        finished.value = true
        elapsed.value = holdMs.value

        return
    }

    enter(index.value + 1, playing.value)
}

function jump(i) {
    enter(i, playing.value)
}

function toggle() {
    if (playing.value) {
        stopTimers()

        return
    }

    if (finished.value) {
        enter(0, true)

        return
    }

    if (!ready.value) {
        startTour()

        return
    }

    resume()
}

function focusPhone() {
    if (!window.matchMedia('(max-width: 1023px)').matches) return

    const el = document.getElementById('phone')

    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function startTour() {
    mode.value = 'watch'

    if (!ready.value) {
        autostart = true

        return
    }

    enter(0, true)
    focusPhone()
}

function startTry() {
    stopTimers()
    mode.value = 'try'

    if (ready.value) focusPhone()
}

function backToTour() {
    mode.value = 'watch'
    enter(index.value, false)
}

function restart() {
    stopTimers()
    finished.value = false
    mode.value = 'watch'
    seeded = false

    const win = frame.value && frame.value.contentWindow

    if (!win) return

    reset(win)
}

async function onFrameLoad() {
    const win = frame.value && frame.value.contentWindow

    if (!win) return

    try {
        /* A fresh tab starts from a clean demo wallet: clear the framed app's
           persisted store once, then reload. The session flag stops a loop. */
        if (!sessionStorage.getItem('nito-demo-fresh')) {
            win.localStorage.clear()
            sessionStorage.setItem('nito-demo-fresh', '1')
            win.location.reload()

            return
        }

        await waitForApp(win)
        await ensureSeed(win)

        ready.value = true

        await enter(0, autostart)
        autostart = false
    } catch (err) {
        failed.value = err && err.message ? err.message : String(err)
    }
}

onBeforeUnmount(stopTimers)
</script>
