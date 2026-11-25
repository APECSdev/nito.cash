# CashShuffle-over-Nostr — finalized design

**Status:** design final (2026-11-25). Implementation is the Desk workstream.
**Wire reference:** `hushyourmoney/web/pages/research/coinjoin.vue` (the CashShuffle
protobuf spec: registration, pool, phases, blame).
**Transport reference:** `hushyourmoney/web/pages/research/cashfusion.vue` + the
NIP-59/NIP-44 research.

## 1. What changes vs. classic CashShuffle

Classic CashShuffle is a client ↔ **server** protocol over TLS with protobuf packets.
The Nostr edition replaces the server's TRANSPORT with Nostr relays and keeps the
protocol logic, but the server's ROLE must live somewhere. Final decision:

| classic | Nostr edition |
|---|---|
| TLS connection to one shuffle server | NIP-59 gift-wrapped events on a relay set |
| server assigns pool + player numbers | **coordinator** = the lowest ephemeral pubkey in the pool |
| server broadcasts/unicasts packets | coordinator publishes one gift-wrapped event per recipient (and a broadcast event) |
| server checks + relays messages | coordinator checks + republishes; relays only carry ciphertext |
| blame excludes a player | same, coordinator tallies; a failed tally aborts the round |
| ECDSA signing | Schnorr (BCH 2019+; 64-byte sigs) |

The coordinator is **deterministic** (lowest ephemeral pubkey) so every peer computes
the same one; if it disappears the round aborts and the peers re-pool (no funds move
until the final broadcast).

## 2. Transport

- **Relays:** a fixed set of 2–3 public relays (e.g. `wss://damus.io`, `wss://nos.lol`)
  plus a user-configurable relay. Browser WebSocket only — no TCP, no Tor requirement.
- **Encryption:** NIP-44 v2 payloads inside **NIP-59 gift wrap** (kind `1059`), with a
  fresh ephemeral key per message. The rumor (the actual packet) is unsigned; the seal
  is signed by the sender's ephemeral key; the gift wrap is signed by a throwaway key.
- **Authentication:** NIP-42 AUTH when a relay requires it; the AUTH key is a
  per-session ephemeral key, never the wallet key.
- **Pacing:** 80 ms between publishes (the CashFusion measured pacing); one event per
  packet; no batching (batching leaks timing).
- **Discovery:** a kind-`22230`-style announcement is DESIGN-ONLY for now (the
  CashFusion G4 pattern). The first implementation uses an out-of-band pool invite
  (a `nostr:` URI carrying the round id + relay set + coordinator hint).

## 3. Protocol phases (unchanged logic, new carrier)

1. **Register** — the client publishes its verification key + amount + protocol
   version (the classic unsigned registration), gift-wrapped to the coordinator.
2. **Pool** — the coordinator assigns player numbers and broadcasts the pool state
   until `N` (the CashShuffle fixed size; default 5).
3. **Announcement** — the coordinator publishes `Phase: ANNOUNCEMENT`.
4. **Shuffle** — each player sends its onion-wrapped output list (unicast to the next
   player, the classic onion). The coordinator relays; the final player broadcasts the
   shuffled list.
5. **Signing** — each player signs the final transaction (Schnorr, `SIGHASH_ALL|FORKID`);
   signatures are unicast to the coordinator.
6. **Broadcast** — the coordinator assembles and broadcasts the tx; every player can
   independently verify the txid.
7. **Blame** — on a missing/invalid packet, players unicast `Blame { accused_key,
   reason }`; `N-1` matching blames exclude the accused; a failed tally aborts.

## 4. Equal-amount + fees

- All inputs are the SAME amount (the classic equal-output shuffle).
- Fee is deducted proportionally from every output (the CashShuffle fee model); the
  transaction is built with the exact fee before signing.
- **Pool-native lock batching (the composition):** a shuffle round whose outputs ARE
  the role-2 tagged fuel UTXOs. Each participant's shuffled output becomes a
  15,000-sat tagged fuel UTXO; the tag identifies WHICH fuel output (the action's
  outpoints reveal that anyway), never which funder. The round therefore pays the
  pool's lock fee as part of the shuffle, and the pool action's fee privacy is
  inherited from the equal-output set.

## 5. Threat model

| adversary | mitigation |
|---|---|
| relay reads packets | NIP-44 v2 + NIP-59 gift wrap; relays see ciphertext + timing only |
| relay correlates sender | fresh ephemeral key per message; gift-wrap signature key is throwaway |
| coordinator censors/steals | coordinator never holds keys or funds; it only relays; a bad round aborts before broadcast |
| Sybil fills the pool | the pool is invite/out-of-band first; N is small; blame excludes |
| timing analysis | 80 ms pacing; equal amounts; uniform outputs; no batching |
| blame griefing | `N-1` threshold; the accused is excluded, not slashed; a failed tally aborts |
| DoS | round timeout; abort + re-pool; no funds at risk until broadcast |
| wallet-key exposure | the wallet key never touches Nostr; only ephemeral session keys |

## 6. Open questions (explicitly NOT decided)

- The production relay set + whether to run a project relay.
- NIP-42 AUTH policy per relay.
- The discovery kind/tag schema (kind 22230 is design-only).
- Whether the coordinator is always the lowest key or rotates per phase.
- The exact protobuf ↔ Nostr packet mapping (one event per packet is the default).
- The browser test harness for a multi-peer round (jsdom + mock relays first).

## 7. Acceptance

A 5-peer chipnet round on the built app: 5 equal inputs → 5 equal outputs, all
Schnorr-signed, one broadcast txid, no relay sees a wallet key. Then the same round
with the pool-native lock batching: the shuffled outputs become the tagged fuel UTXOs
of 5 role-2 actions.

— APECSdev / nito.cash, 2026-11-25
