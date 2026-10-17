# Ledger (Hardware Wallet)

Nito.cash integrates **Ledger** hardware wallets over WebUSB, using
`@ledgerhq/hw-transport-webusb` and `@ledgerhq/hw-app-btc`.

## Current state

Ledger support is being expanded from a single debug screen into a full feature. Today the only
usage is in **Concierge → Spend → Advanced** (`ledgerConnect()`), which reads the public key on the
BCH derivation path `44'/145'/0'/0/0`. This is marked **"for development purposes only."**

## Full-integration plan

1. **Transport layer** — WebUSB for desktop; consider WebHID as a fallback for broader browser
   support.
2. **Connection management** — a dedicated store module/composable that owns the transport
   lifecycle (connect / disconnect / reconnect, device events).
3. **Address derivation** — BCH path `44'/145'/…` (BCH coin type = 145), consistent with the
   existing `wallets` store.
4. **Balance / UTXO** — fetch UTXOs for Ledger-derived addresses via the existing Fulcrum access
   layer, not Ledger's own explorer.
5. **Transaction signing** — build unsigned BCH transactions in the app, sign inputs on-device,
   broadcast via the existing send pipeline.
6. **UI** — connect, account selection, receive-address display / verify-on-device, and send
   confirmation, integrated into Send / Receive / Settings.
7. **Error handling** — user-facing states for a locked device, wrong app, user rejection
   (`0x6985`), and transport disconnects, routed through the existing `displayError` /
   `displayNotification` system store actions.
