<!-- src/views/Concierge/Desk/CashShuffle.vue -->
<!--
    The CashShuffle service (Desk · guest service 03).

    A live protocol demo: the round state machine in lib/cashshuffle/protocol.js
    is driven through the classic phases (REGISTER → POOL → ANNOUNCEMENT →
    SHUFFLE → SIGNING → BROADCAST) with a deterministic coordinator (the lowest
    ephemeral pubkey), and the blame tally can abort a round before broadcast.
    No relay is contacted and no coin moves — the transport is the next layer.
-->
<template>
    <div>
        <!-- Back to the guest-services landing. -->
        <div class="shrink-0">
            <Button label="← Guest services" @click.native="$emit('back')" />
        </div>

        <!-- The service plaque. -->
        <section class="mt-[12px] shrink-0 overflow-hidden rounded-[16px] border border-hr bg-box-bg">
            <div class="flex items-start gap-[10px] p-[14px]">
                <div class="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] border border-hr text-[13px] font-bold tabular-nums">
                    03
                </div>
                <div class="min-w-0 flex-1">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        Guest service &middot; 03
                    </div>
                    <h2 class="mt-[2px] text-[18px] font-semibold leading-[22px]">
                        CashShuffle
                    </h2>
                    <p class="mt-[4px] text-[12px] leading-[17px] text-fg-muted">
                        The classic equal-output shuffle, carried over Nostr relays. No coordinator
                        server: the lowest ephemeral pubkey runs the round, and a blame tally aborts
                        before anything is broadcast.
                    </p>
                </div>
                <span class="shrink-0 rounded-full bg-secondary px-[8px] py-[2px] text-[8px] font-bold uppercase tracking-[0.12em] text-secondary-fg">
                    Protocol live
                </span>
            </div>

            <dl class="border-t border-hr px-[14px] py-[10px] text-[11px] leading-[15px]">
                <div v-for="fact of facts" :key="fact.k" class="flex gap-[10px] py-[3px]">
                    <dt class="w-[78px] shrink-0 text-fg-muted">{{ fact.k }}</dt>
                    <dd class="min-w-0 flex-1">{{ fact.v }}</dd>
                </div>
            </dl>
        </section>

        <!-- The round. -->
        <section class="mt-[12px] shrink-0 overflow-hidden rounded-[16px] border border-hr bg-box-bg">
            <div class="flex items-center justify-between gap-[10px] p-[14px]">
                <div>
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        Round
                    </div>
                    <div class="text-[15px] font-semibold">{{ round.roundId }}</div>
                </div>
                <div class="text-right">
                    <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                        Phase
                    </div>
                    <div class="text-[13px] font-semibold text-fg-link">{{ round.phase }}</div>
                </div>
            </div>

            <!-- Phase rail. -->
            <div class="flex flex-wrap gap-[6px] border-t border-hr px-[14px] py-[10px]">
                <span v-for="phase of phases" :key="phase"
                    class="rounded-full border px-[8px] py-[2px] text-[9px] font-bold uppercase tracking-[0.08em]"
                    :class="phase === round.phase ? 'border-secondary text-secondary' : 'border-hr text-fg-muted'">
                    {{ phase }}
                </span>
            </div>

            <!-- Players. -->
            <div class="border-t border-hr px-[14px] py-[10px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    Players &middot; {{ round.players.length }} / {{ round.poolSize }}
                </div>
                <div v-for="player of round.players" :key="player.key"
                    class="mt-[4px] flex items-center justify-between gap-[10px] text-[11px]">
                    <span class="font-semibold">{{ player.key.slice(0, 12) }}&hellip;</span>
                    <span class="text-fg-muted">
                        #{{ player.number }}
                        <template v-if="player.key === round.coordinator"> &middot; coordinator</template>
                    </span>
                </div>
            </div>

            <!-- Blame tally. -->
            <div v-if="Object.keys(round.blames).length" class="border-t border-hr px-[14px] py-[10px]">
                <div class="text-[9px] font-bold uppercase tracking-[0.22em] text-fg-muted">
                    Blame
                </div>
                <div v-for="(accusers, accused) of round.blames" :key="accused"
                    class="mt-[4px] flex items-center justify-between gap-[10px] text-[11px]">
                    <span class="font-semibold">{{ accused.slice(0, 12) }}&hellip;</span>
                    <span class="text-fg-muted">{{ accusers.length }} / {{ round.poolSize - 1 }} to abort</span>
                </div>
            </div>

            <p v-if="round.aborted" class="border-t border-hr px-[14px] py-[10px] text-[11px] font-semibold text-warning-text">
                Round aborted — the blame threshold was reached before any broadcast.
            </p>

            <!-- Controls. -->
            <div class="flex flex-wrap gap-[8px] border-t border-hr p-[12px]">
                <Button label="Open round" @click.native="openRound" />
                <Button label="Announce" :disabled="round.phase !== 'ANNOUNCEMENT'" @click.native="doAnnounce" />
                <Button label="Shuffle" :disabled="round.phase !== 'SHUFFLE'" @click.native="doShuffle" />
                <Button label="Sign" :disabled="round.phase !== 'SIGNING'" @click.native="doSign" />
                <Button label="Broadcast" :disabled="round.phase !== 'BROADCAST'" @click.native="doBroadcast" />
                <Button label="Blame #5" :disabled="round.aborted" @click.native="doBlame" />
            </div>
        </section>

        <Footer>
            <p class="text-[11px] leading-[15px] text-fg-muted">
                Protocol demo only. No relay is contacted, no transaction is built, and no coin
                leaves this device. The Nostr transport (NIP-59/NIP-44) is the next layer.
            </p>
        </Footer>
    </div>
</template>

<script>
import { Button, Footer } from '@/components'
import {
    PHASES,
    blame,
    broadcast,
    createRound,
    register,
    announcement,
    shuffle,
    signing,
    snapshot,
} from '@/lib/cashshuffle/protocol'

const PLAYERS = ['aa', 'bb', 'cc', 'dd', 'ee']

export default {
    components: { Button, Footer },
    data: () => ({
        phases: PHASES,
        facts: [
            { k: 'Transport', v: 'NIP-59 gift wrap (kind 1059) + NIP-44 v2' },
            { k: 'Coordinator', v: 'Lowest ephemeral pubkey — no server' },
            { k: 'Amounts', v: 'Equal inputs, proportional fee' },
            { k: 'Abort', v: 'N-1 blame, before broadcast' },
        ],
        round: snapshot(createRound({ roundId: 'r-1', relay: 'wss://relay.example', poolSize: 5 })),
        _round: createRound({ roundId: 'r-1', relay: 'wss://relay.example', poolSize: 5 }),
    }),
    methods: {
        sync() { this.round = snapshot(this._round) },
        openRound() {
            this._round = createRound({ roundId: `r-${Date.now()}`, relay: 'wss://relay.example', poolSize: 5 })
            for (const key of PLAYERS) register(this._round, { key, amount: 100000n })
            this.sync()
        },
        doAnnounce() { announcement(this._round, { from: this._round.coordinator }); this.sync() },
        doShuffle() { shuffle(this._round, { from: 'bb', onion: 'onion-1' }); this._round.phase = 'SIGNING'; this.sync() },
        doSign() { signing(this._round, { from: 'bb', signature: 'sig-1' }); this._round.phase = 'BROADCAST'; this.sync() },
        doBroadcast() { broadcast(this._round, { from: this._round.coordinator, txid: 'demo-txid' }); this.sync() },
        doBlame() {
            for (const from of ['bb', 'cc', 'dd', 'ee']) {
                if (this._round.aborted) break
                blame(this._round, { from, accused: 'aa', reason: 'timeout' })
            }
            this.sync()
        },
    },
}
</script>
