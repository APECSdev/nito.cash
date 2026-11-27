# B3 — Off-Chain Note Delivery (the wallet-to-wallet TRANSFER receive leg) — Design 2026-11-27

Status: DESIGN (for review) — the implementation follows after sign-off.

## 1. The problem (why B3 exists)

The role-2 action carrier (`lib/pool/role2-carrier.js`, 169 B / 201 B for the 3-out
shapes) carries the ACTION's public statement — `nf0 | nf1 | cm0 | cm1 | cm2 |
newRoot | pv` (+ the actionHash form) — and NOTHING else. The recipient's private
note material (value, rho, r) never leaves the sender's device. A wallet-to-wallet
TRANSFER therefore broadcasts fine, the sender's balance drops, but the RECIPIENT's
wallet cannot reconstruct their note:

- `lib/pool/scan.js` `detectReceived()` trial-decrypts NP01 packets from
  `action.carriers` — the role-2 decode sets `carriers: []` (there are none),
  so `received` is always empty for role-2 actions;
- without the note material the recipient can never spend their incoming PUSD.

This is B3, the last honest-leg blocker for the video's step 5 ("transfer to
another Nito Cash user") and for any real visitor receiving a shielded payment.

## 2. The existing NP01 packet machinery (shipped + tested — unchanged)

`lib/pool/carrier.js` is the ORIGINAL pool's note-carrier implementation, and it
is exactly the reusable core:

- `encryptNote(note, receiverDeliveryPoint)` → the 164-B NP01 packet
  `MAGIC | ephPub(32) | ct(128)` where `ct = value | ownerPub | rho | r`
  (32-B BE each) XORed with the ECDH keystream (fresh ephemeral key per packet,
  encrypted to the RECIPIENT'S BabyJub delivery point);
- `decryptPacket(packet, spendKey, knownLeaves)` → `{ value, ownerPub, rho, r,
  cm, leafIndex }` or `null` — Zcash-style trial decryption; the note is only
  accepted if its RECOMPUTED commitment matches a known pool leaf (and, in the
  role-2 scan wiring, against THE ACTION's on-chain cm0/cm1/cm2).

The packet is self-authenticating: a wrong key or a tampered ciphertext yields a
cm that matches nothing and is silently dropped. The only thing missing is a
TRANSPORT from the sender's device to the recipient's scan.

## 3. The design — HYBRID: the Nostr mailbox now, the on-chain packet as the backstop

### 3.1 PRIMARY: the Nostr note mailbox (no program change, works with the
deployed pools TODAY)

The sender publishes the NP01 packet to a small set of persistent Nostr relays,
anonymously, tagged by a hash of the RECIPIENT's delivery point. The recipient's
wallet fetches by that tag during every pool scan and feeds the packets straight
into the existing `decryptPacket` + validate-against-the-action-commitments path.

**The event spec** (a private convention between Nito wallets — configurable in
the pool registry):

- kind: a REGULAR (stored, non-replaceable) kind — proposed `4321` (never a
  30000-39999 kind: parameterized-replaceable keeps only the LATEST event per
  d-tag, which would DROP all but the last note per recipient);
- tags: `["d", hex(SHA256(deliveryPoint))]` — the routing tag (the delivery
  point is only ever shared sender↔recipient; the relay sees an opaque hash),
  and `["action", <txid hex>]` — the originating action, so the scan can jump
  to the right action's commitments (convenience; not trusted);
- content: `hex( packet )` — the raw 164-B NP01 packet. It is ALREADY encrypted
  to the recipient's delivery point; no second encryption layer is needed (the
  relay sees ciphertext either way);
- key: a FRESH throwaway Nostr key per publication — no sender identity, no
  linkage between packets. (The CashShuffle NIP-59 gift-wrap machinery is NOT
  used: gift wrapping targets a known RECIPIENT nostr pubkey, which we do not
  have and do not want to bootstrap — see the rejected alternatives §5.)

**The receipt** (delivery acknowledgement — the funds-safety mechanism):

- after a packet imports successfully (a note recorded), the recipient's wallet
  publishes a receipt event: same kind family (proposed `4322`), tags
  `["d", hex(SHA256(packet))]`, content empty, with a fresh key;
- the SENDER keeps the packet in a persistent OUTBOX until the receipt is seen;
  until then it re-publishes on every app boot and after every scan (relays may
  evict; relays may be down). The outbox rides the existing SEALED pool store
  (`pool.sealed`, `lib/pool/seal.js` — unlocked by `unlockPool` at boot) — no
  new secret store.

**The scan integration** (recipient):

- `scanPool` (store action) after the chain sweep: one REQ on the mailbox kind
  filtered by the wallet's OWN d-tag `hex(SHA256(own delivery point))` — the
  `Relay` class (`lib/nostr/relay.js`) already implements REQ/EVENT/CLOSE with
  per-id OK tracking, and the wallet KNOWS its own delivery point
  (`deriveDeliveryPoint(spendKey)`, same domain-separated pool key);
- every fetched packet goes through `decryptPacket(spendKey, …)` — the existing
  trial-decrypt; the note's recomputed cm is matched against the scan's action
  commitments (`cm0/cm1/cm2` + `leafIndexBase`) EXACTLY as the carriers flow
  does today, so the REAL global leaf index is assigned;
- `recordNote` (existing) records + seals it; the receipt event is published
  fire-and-forget.

**The transfer submit integration** (sender): after the action broadcast
succeeds, the outNote for the recipient (already computed by the action
orchestrator — it is in the submit result) is encrypted with
`encryptNote(note, recipientDeliveryPoint)` and published (the outbox records
it first; the relay EVENT is fire-and-forget with OK-tracking per
`relay.js`).

### 3.2 BACKSTOP (pending one Hush answer): the packet ON-CHAIN

If the deployed v4h program tolerates an EXTRA output carrying the NP01
packet — as the ORIGINAL pool's covenant empirically did (NOTE-CARRIER.md;
"a VM gate" / confirmed by the apecsdev-VM eval) — then the transfer action
adds a second OP_RETURN-style output (~174 B) with the packet. The wallet's
scan needs NO new code path for that (the decode's `carriers` extraction is
already the chain path), and the delivery risk drops to zero (the chain never
forgets).

**Relayed to the Hush 2026-11-27** (`VENDING-NITO-REQUEST-2026-11-27.md`
§the-questions): does the 42/42 acceptance set include the extra-output case,
or does the v4h covenant reject it? If YES: the mailbox becomes a UX
accelerator (the recipient learns instantly instead of at next scan) and the
chain packet is the durable record; if NO: the mailbox is the only channel and
the outbox/receipt discipline carries the durability.

NOTE (a constraint either way): the packet cannot ride INSIDE the existing
carrier — the role-2 programs parse the 169/201-B carrier exactly (the
actionHash binds its bytes). The backstop must be an ADDITIONAL output.

## 4. Why this is safe enough for real PUSD

- **The packet is useless to anyone but the recipient** (encrypted to their
  delivery point; a wrong spend key yields garbage cm → silently dropped).
- **The relay set learns nothing**: fresh key per event, an opaque d-tag, and
  ciphertext content. Correlating a mailbox event with an on-chain action
  requires knowing the delivery point — which is shared only sender↔recipient.
- **Funds-safety (the mailbox's only real risk — a lost note is lost money)**
  is handled by: (a) the persistent outbox that re-publishes until receipted;
  (b) the multi-relay default set; (c) the recipient's scan runs on every
  unlock, so receipts are timely; (d) the sender's own wallet ALSO retains the
  recipient's outNote in the action record — a last-resort manual re-delivery
  is always possible from the sender's device.
- **No identities anywhere**: neither party publishes a reusable Nostr key, so
  the mailbox adds no long-term trackable identity to either side.

## 5. Rejected alternatives (recorded for the review)

- **A delivery-point ↔ nostr-pubkey registry (NIP-59 gift wrap to the
  recipient's nostr identity)**: requires publishing the mapping (an
  enumerable privacy surface for a value that is currently shared
  peer-to-peer only) + a bootstrap step + profile machinery. Rejected: the
  d-tag bucket achieves the routing with zero new published state.
- **On-chain NP01 as the ONLY channel**: blocked on the program-tolerance
  question (and it would re-touch the program/tx shape for every pool
  variant). The mailbox ships without them.
- **A backend relay of our own**: a hosted service is a trust + privacy
  surface and a single point of failure; public relays + the receipt
  discipline are strictly better for a client-side-only wallet.

## 6. Implementation plan (after sign-off)

1. `lib/pool/note-mailbox.js` (new): the kind/tag constants; `dpTag(dp)`,
   `buildNoteEvent(packet, actionTxid, key)`, `publishNotePacket(…)`,
   `fetchNotePackets(relays, ownDp)`, `buildReceiptEvent(packet)`,
   `fetchReceipt(relays, packet)` — all on `lib/nostr/{event,relay}.js`
   (the CashShuffle transport's relay-injection pattern for tests).
2. `lib/pool/scan.js`: the mailbox packets enter through the EXISTING
   `detectReceived` path (the packets are attached to their action's
   `carriers` list by txid before the trial-decrypt — one seam, no logic
   duplication).
3. `store/modules/pool.js`: the post-broadcast publish (submitRole2Action,
   all role-2 variants), the outbox persistence (sealed), the scan-time
   mailbox fetch, the receipt publish.
4. `registry.js`: `noteMailbox: { relays: [...], kinds: [4321, 4322] }` per
   network (the relay set is a deployment decision, not a code constant).
5. Tests (the house pattern): the event build/parse round-trip with relay
   mocks (the `relay.js` suite's pattern); the encrypt→publish→fetch→decrypt
   →recordNote end-to-end with mocked relays; the outbox re-publish + the
   receipt clear; the scan-integration test in the pool-scan spec harness;
   the chipnet dress rehearsal (two real wallet profiles) after the Hush's
   chipnet rehearsal order completes.

## 7. Open decisions for the sign-off

1. The relay set for PRODUCTION (the chipnet rehearsal can use any reachable
   relay; mainnet wants 2-3 reliable, e.g. the CashShuffle candidates) — the
   standing open question for the CashShuffle transport applies here too.
2. The kind numbers (4321/4322 proposed; any unclaimed regular kind works —
   it is a private convention).
3. The Hush's NP01-tolerance answer (the backstop decision).
