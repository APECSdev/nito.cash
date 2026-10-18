# HANDOFF — `fulcrum.apecs.dev` + `chaingraph.apecs.dev` subdomain wiring

From: `APECSdev/nito.cash` (Private Payments workstream)
To: `APECSdev/apecs.dev` (infrastructure / DNS owner)

This document is self-contained. Facts are cited to a file path or command output;
anything not yet verified is marked **[VERIFY]**. House rules from
`apecs.dev/AGENTS.md` §2 apply to whoever picks this up (no guessing, exact pins,
minimum diff, cite everything).

---

## 1. What nito.cash needs

The nito.cash Private Payments workstream (BCH Blaze 2026 submission) is standing up
note-detection infrastructure on the LunaNode VPS **`bch-infra`** (Toronto, m.8,
IP `170.75.165.167`, Ubuntu 24.04). Two public services must be reachable under the
`apecs.dev` domain:

| Subdomain | Service | Backend port (on bch-infra) | Purpose |
| --- | --- | --- | --- |
| `fulcrum.apecs.dev` | Fulcrum (Electrum-protocol server) | `50001` (TCP) / `50002` (SSL) / `50004` (WSS) | BCH + Chipnet blockchain data for the wallet's `FulcrumCluster` (`apps/web/src/lib/bch/provider.js`) |
| `chaingraph.apecs.dev` | Chaingraph indexer (Hasura GraphQL) | `443`/`80` reverse-proxy → Hasura `:8080` **[VERIFY]** | Note-detection / transaction-history indexing for the shielded pool |

The wallet currently hardcodes public third-party Fulcrum servers in
`apps/web/src/lib/bch/networks.js` (mainnet: `bch.imaginary.cash`,
`electrum.imaginary.cash`, `blackie.c3-soft.com`, `bch.loping.net`; chipnet:
`chipnet.imaginary.cash`, `chipnet.bch.ninja`). The goal is to add
`fulcrum.apecs.dev` as a first-party, operator-controlled cluster member so the
quorum does not depend entirely on third parties.

---

## 2. Verified current state

| Fact | Value | Source |
| --- | --- | --- |
| `apecs.dev` DNS | Cloudflare (`172.67.213.138`, `104.21.53.145`) — zone is in the owner's CF account | `dig +short apecs.dev` (verified 2026-10-13, cited in `admin/HANDOFF.md` §1) |
| Precedent for subdomain split | `admin.apecs.dev` → standalone Nuxt app in `APECSdev/admin`; `apecs.dev/v1/*` → Cloudflare Worker in `APECSdev/api` | `apecs.dev/AGENTS.md` §1, §5.9 |
| bch-infra reachability | SSH via `apecsdev` jump host (`ssh apecsdev` → `ssh bch-infra`) | nito.cash project notes |
| Fulcrum on bch-infra | **not yet installed** | nito.cash project notes (infra workstream not started) |
| Chaingraph on bch-infra | **not yet installed** | nito.cash project notes |
| Correct Chaingraph repo | **[VERIFY]** — the canonical BCH Chaingraph implementation is `bitauth/chaingraph` (Hasura + Postgres + a BCHN node agent); confirm before cloning | — |

**Nothing in this handoff has been implemented.** This document is a request for
the apecs.dev side to own DNS + TLS + reverse-proxy, while the nito.cash side owns
the services themselves on bch-infra.

---

## 3. Division of labor

### apecs.dev side (this handoff)

1. **DNS** — in the owner's Cloudflare account, create:
   - `fulcrum.apecs.dev` → A record → `170.75.165.167` (grey-cloud / DNS-only;
     Cloudflare proxy does not pass raw TCP/SSL Electrum traffic on standard ports,
     and WSS through CF proxy needs the port to be one CF supports — see [VERIFY]).
   - `chaingraph.apecs.dev` → A record → `170.75.165.167` (orange-cloud OK if it
     stays HTTP/WebSocket; grey-cloud also fine).
   - **[VERIFY]** `dig +short fulcrum.apecs.dev` and `dig +short chaingraph.apecs.dev`
     currently return empty (expected, same as `admin.apecs.dev` did).
2. **TLS** — cert for both subdomains. If grey-cloud, terminate on bch-infra
   (Caddy/nginx + Let's Encrypt). If orange-cloud for chaingraph, CF edge cert
   suffices; origin cert still recommended.
3. **Reverse proxy** — `chaingraph.apecs.dev` → Hasura on bch-infra. Hasura's
   console must be admin-secret-gated; the GraphQL endpoint needs a read-only role
   for the wallet. **[VERIFY]** Hasura port once the container is up.
4. **WSS for Fulcrum** — the wallet speaks secure websockets (`port 50004, encrypted:
   true` in `networks.js`). Either terminate WSS at the proxy and forward to Fulcrum's
   TCP/SSL port, or expose Fulcrum's own SSL port directly. **[VERIFY]** which path
   survives the CF proxy port restrictions (CF only proxies specific ports; 50004 is
   not among them — so either move Fulcrum WSS to 443 via the proxy, or grey-cloud
   the record and connect directly).

### nito.cash side (already owned by this workstream)

1. Install + sync Fulcrum on bch-infra against a BCHN node (mainnet and chipnet
   instances; chipnet first — the pool is chipnet-only for the hackathon).
2. Install Chaingraph (`bitauth/chaingraph` **[VERIFY]**) with Postgres + Hasura,
   indexing chipnet.
3. Once `fulcrum.apecs.dev` resolves and serves, add it to
   `apps/web/src/lib/bch/networks.js` as an additional cluster member (minimum-diff
   edit: one entry in each `servers` array; quorum stays 2).
4. Update `apps/docs/private-payments/roadmap.md` to mark note-detection infra
   in progress.

---

## 4. Constraints carried over from nito.cash AGENTS.md

- **All heavy compute on bch-infra, never on the dev host.** Fulcrum's initial
  sync and Chaingraph's initial index are multi-hour jobs — run them detached
  (`setsid bash -c '... > log 2>&1; echo "EXIT=$?" >> log' &`) and poll the log.
- **VM resource policy:** APECS VM capped at 4 CPU / 8 GB; only one VM runs at a
  time. bch-infra is a separate LunaNode VPS and is not subject to the cap, but
  confirm disk headroom before the Fulcrum sync (**[VERIFY]** `df -h` on bch-infra;
  a full BCH Fulcrum DB is hundreds of GB — chipnet is small, mainnet is not).
- **Secrets:** LunaNode API key stays in gitignored `chmod 600` dotfiles only.
  Hasura admin secret and any Fulcrum RPC credentials go in the same store, never
  in a repo.

---

## 5. Acceptance criteria

1. `dig +short fulcrum.apecs.dev` and `dig +short chaingraph.apecs.dev` return
   `170.75.165.167`.
2. `wscat`-style or `@electrum-cash/network` connect to `wss://fulcrum.apecs.dev`
   completes the Electrum `server.version` handshake (chipnet first, then mainnet).
3. `https://chaingraph.apecs.dev/v1/graphql` answers an unauthenticated
   introspection query with the read-only role; the Hasura console is not publicly
   reachable.
4. `apps/web/src/lib/bch/networks.js` lists `fulcrum.apecs.dev` in both clusters
   and `pnpm test:unit` still passes (86/86).
