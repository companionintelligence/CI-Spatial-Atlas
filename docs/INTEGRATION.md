# Companion Atlas — Platform Integration & Local Dev

> **Private & Confidential — Property of Lifescope Inc.**
> How Atlas connects to the Companion Intelligence platform: CI-Portal OIDC,
> CI-Server Memory, the CI-Hub/marketplace framework, and CI-Common theming — plus
> the local dev mode. Grounded in the current Atlas implementation (2026-09-03).

## Status legend

- ✅ **implemented + tested** in this repo
- 🟡 **written, not exercised** — real code that either has no caller in this
  repo or has never been run against the live service it targets. Every 🟡 row
  says which of the two it is, because the difference decides who unblocks it.
  (It used to read "not yet built/run — part of `viewer-react`", which implied
  the viewer was unbuilt. It is not: it has a Dockerfile, a service in
  `docker-compose.yml`, and the `npm run dev` in §1 below.)
- 🔧 **pending** (needs a change in another repo or a live service)

---

## 1. Local dev mode

Two modes, one command each. See [`.env.dev.example`](../.env.dev.example) and
[`docker-compose.dev.yml`](../docker-compose.dev.yml).

**Mode A — MOCK (default, zero external services)** ✅
```sh
cp .env.dev.example .env.dev            # issuer + memory empty
docker compose -f docker-compose.dev.yml up postgres redis minio atlas-api
cd viewer-react && npm install && npm run dev    # :4174
```
The API runs every request as `ATLAS_DEV_SUBJECT` with `*` scope (auth disabled);
memory queries return nothing. Good for UI/renderer work.

Because that bypass would give any caller full ownership of every story, the
server refuses to boot into it unless the environment says it is not a
deployment. The `dev` tasks set `NODE_ENV=development` and
`docker-compose.dev.yml` sets `ATLAS_ALLOW_DEV_AUTH=1`, so the command above
just works; if you start the API some other way and it exits with "Refusing to
start", set `ATLAS_ALLOW_DEV_AUTH=1` (see `.env.dev.example`).

**Mode B — CONNECTED (real Portal + CI-Server)** 🟡 *(code paths exist and are
unit-tested; never run against a live Portal + CI-Server — the two 🔧 items in
§5 are what stands in the way, not missing code here)*

Set in `.env.dev`:
```sh
COMPANION_OIDC_ISSUER=https://hub.ci.localhost/api/auth   # local Portal dev
CI_MEMORY_URL=http://localhost:3030/graphql               # local CI-Server
# Or use a scoped key when the server is reached directly:
CI_MEMORY_API_KEY=
```
Now the API verifies Portal JWTs and seeds stories from real located memories.
Requires the two cross-repo prerequisites in §5.

---

## 2. CI-Portal OIDC ✅ (backend) / 🟡 (SPA — written, nothing calls it)

CI-Portal is **better-auth `oidcProvider`**. Issuer = `<portal-origin>/api/auth`;
endpoints hang off it (`/oauth2/authorize`, `/oauth2/token`, `/oauth2/userinfo`,
`/jwks`, `/.well-known/openid-configuration`). Portal origins: local
`https://hub.ci.localhost`, prod `https://hub.ci.computer`.

- **Backend verify** ✅ — [`server/src/auth.ts`](../server/src/auth.ts) verifies the
  access-token JWT with `jose.jwtVerify` against `createRemoteJWKSet(<issuer>/jwks)`,
  enforcing **issuer** + **audience** (EdDSA; `aud === client_id === companion-atlas`).
  Replaces the previous decode-only stub. Empty issuer ⇒ dev subject. Tested with a
  local keypair (signature/issuer/audience/expiry) in `server/test/auth-oidc.test.ts`.
- **SPA login** 🟡 — [`viewer-react/src/auth/portal.ts`](../viewer-react/src/auth/portal.ts):
  Authorization Code + PKCE (S256), public client. Mirrors the Hub RP flow.
  **Complete, and called by nothing.** `beginLogin` / `completeLogin` /
  `portalConfigFromEnv` have no importer in the app — only the test named
  below — so none of this reaches the bundle: there is no
  `/auth/callback` handling at boot, no sign-in control in the shell, and no
  consumer for the token if one were obtained. The app being unbuilt was never
  what stood in the way; three other things do, and only the first is a code
  change here:
  1. no caller — plus an Atlas-API client to spend the bearer on
     (`VITE_ATLAS_API` has no reader in `viewer-react` today, so a completed
     login would change nothing about what the viewer can fetch);
  2. `companion-atlas` is not in CI-Portal `PUBLIC_CLIENTS` (§5.1 — another
     repo's PR; local/`.ts.net`/`.local` redirect URIs are auto-allowed, so dev
     alone needs no Portal record);
  3. `.env.default` ships `VITE_OIDC_ISSUER`/`VITE_OIDC_REDIRECT_URI` empty, so
     `portalConfigFromEnv()` returns `null` in every configuration checked in.

  Its failure paths *are* covered — `viewer-react/test/portal-auth.test.ts`
  pins that an `?error=…` callback reports Portal's own error (blocker 2 above
  arrives that way) rather than "missing authorization code", and that the PKCE
  verifier is consumed on every path.

  Separately, the viewer now has an embedded **CI-Server Memory sign-in** path
  that *is* wired in —
  [`viewer-react/src/memory/auth.ts`](../viewer-react/src/memory/auth.ts). It
  exchanges a connected Memory server's CSRF-protected credentials for a
  scoped access token, kept in `sessionStorage` scoped to the Memory URL. This
  is unrelated to the Portal OIDC flow above: it authenticates against
  CI-Server directly rather than brokering through Portal, for the case where
  a viewer is pointed at a Memory server with no Portal in front of it.

## 3. CI-Server Companion Memory ✅

CI-Server exposes **GraphQL** at `/graphql` (`:3030` direct, `/api/graphql` via proxy).
- **Query** ✅ located events via `search(input:{ includeTypes:["event"],
  hasLocation:true, sortBy:"time", sortOrder:"desc" })` → `EventType` nodes →
  canonical `MediaItem[]`. The shared query pages through CI-Server's 100-row
  limit and restores chronological order for the viewer. **Corrects PR #8:** the
  slug is `"event"` (not `"EventType"`, which returns zero rows), and
  `previewUrl`/`mediaUrl` are **relative presigned paths** that are absolutized
  against the CI-Server origin.
- **Write-back** ✅ via the idempotent `createEvent` mutation (dedups on
  source triple; `sharingLevel` from story visibility).
- Transport in [`server/src/ci-memory-client.ts`](../server/src/ci-memory-client.ts)
  (tested with a mock fetch); query/mutation/mapping live in `@companion-atlas/story`
  (`memory.ts`); the suite facade is `server/src/connectors.ts` (`CiMemoryConnector`).
- Auth: sends `Authorization: Bearer <PortalToken>` or the dedicated `x-api-key`
  header for a scoped CI-Server key. Needs `PORTAL_OIDC_ENABLED=true` +
  `companion-atlas` in CI-Server `PORTAL_OIDC_AUDIENCE` when using Portal tokens.

## 4. CI-Hub / Marketplace 🟡 *(manifests written; never installed into a Hub)*

Register Atlas as a Hub app: [`hub/config.json`](../hub/config.json) (`AppInfo`) +
[`hub/docker-compose.json`](../hub/docker-compose.json). Key blocks:
- `hub_integration.oidc` → the Hub injects `COMPANION_OIDC_ISSUER=<CI_CLOUD_URL>/api/auth`.
- `hub_integration.memory` → the Hub injects `CI_MEMORY_URL` + a minted `CI_MEMORY_TOKEN`
  (or a scoped `CI_MEMORY_API_KEY` for direct server deployments).
- `agents.mcp` + `agents.intents[]` → on install the Hub auto-registers Atlas's MCP
  tools + intents with CI-Server ("agent-declared intents"), growing the assistant's
  vocabulary.

Install fastest via the Hub **custom-app (`_user`)** path; publish to the
`ci-marketplace` store for distribution. Validate both manifests against
`CI-Hub/packages/common/src/schemas/{app-info,agent-config,dynamic-compose}.ts`
before publishing. Theming is **not** injected by the Hub — Atlas adopts the CI
tokens itself (§6). No runtime CSS injection.

## 5. Cross-repo prerequisites 🔧 (other repos)

1. **CI-Portal** — add `{ clientId: 'companion-atlas', name: 'Companion Atlas' }` to
   `PUBLIC_CLIENTS` in `apps/hono-app/src/domains/core/services/createAuth.ts` (a
   Portal PR — no self-service registration). Local/`.ts.net`/`.local` redirect URIs
   are auto-allowed; a **deployed** Atlas also needs a `FIRST_PARTY_APP_IDENTITIES`
   entry (clientId → provisioned slug + callback path).
2. **CI-Server** — set `PORTAL_OIDC_ENABLED=true` and add `companion-atlas` to
   `PORTAL_OIDC_AUDIENCE` (default allowlist omits it), or mint tokens with an
   allowed `aud` / use a scoped API key.

## 6. Theming (CI-Common) 🟡 — adopted in CSS, unresolvable in a single-repo build

CI canonical tokens are `@companionintelligence/tokens` **v0.3** — phthalo
`--primary` **#0a6358** (light) / **#c5e8dc** (dark), **Manrope** typography.

They are **not vendored.** [`viewer-react/src/theme/theme.css`](../viewer-react/src/theme/theme.css)
line 12 `@import`s the bare specifier `@companionintelligence/tokens/tokens.css`,
which `package-lock.json` resolves to a `link:` on a sibling `../ci-common`
checkout — the only such entry in the lockfile. Earlier editions of this section
said the files had been copied into `viewer-react/src/theme/` and carried a ✅;
they never were (that directory holds only `README.md`, `atlas.css`,
`authoring.css`, `presenter.css`, `theme.css`), and the ✅ concealed what the
missing copy costs: `vite build` and the viewer's Docker image cannot complete in
a checkout with no sibling CI-Common. `npm install` / `npm ci`, `npm test` and
`tsc --noEmit` are *not* affected — none of them reads that `@import`. See
[`docs/architecture.md` §8](architecture.md) for the two ways to close it
(publish to GitHub Packages, or vendor for real) and why they are not equivalent.

Consumption is **CSS only**. There is no programmatic tokens import:
`viewer-react/src/theme/index.ts` exported `primaryHex()`/`fontStack()` for the
Cesium/R3F colors, but the three files that would have used it
(`layers/cesium.ts`, `authoring/style.ts`, `authoring/entities.ts`) each ended up
carrying hex literals mirroring `theme/atlas.css`, so it had no importers at all
and has been deleted. Anything citing `primaryHex()` is describing a file that no
longer exists.

The shell is **committed dark** (`atlas.css` aliases `--atlas-*` onto the
canonical teal ramp — `--teal-950`, `--teal-900`, `--teal-200`). tokens.css also
ships a `.dark` block, but nothing in `viewer-react` ever adds that class, so it
is not the mechanism here; there is no light/dark toggle to drive.

`npm run lint:canon` (CI-Common's zero-dep gate) **fails** on a non-canon
`--primary` declaration — including the retired pre-v0.3 teals #0f717a/#abd4d8,
which is exactly what this section used to name as current. Stray hex literals
elsewhere are reported as non-blocking **warnings** (`npm run lint:canon` exits 0
with ~44 of them today), so the WebGL literals listed above are advisory, not
gated — nothing mechanically stops them drifting from `atlas.css`.

CI-Common's `auth` package is a stub (contract only) — we implemented the
verifier ourselves per §2.

## 7. What's left

- Adopt `@companion-atlas/story` in the server schema (delete the mirrored Zod) — a
  breaking migration; see `docs/CONSOLIDATION.md`.
- Wire the SPA login: give `viewer-react/src/auth/portal.ts` a caller — callback
  handling at boot, a sign-in control, and an Atlas-API client that spends the
  bearer (§2). Building the viewer is *not* part of this; it has been built and
  run since the Resium spike landed. The separate embedded CI-Server Memory
  sign-in (§2, `memory/auth.ts`) is already wired and does not depend on this.
- Make `vite build` work in a single-repo checkout (§6) — the last thing between
  this repo and a green Docker/CI image.
- ~~Drive the Cesium `Viewer` clock from the CZML doc packet.~~ Done — `AtlasApp`
  applies the story clock and `ui/TimeMachine.tsx` scrubs it; this line survived
  here for as long as it did because "wire the SPA login + Cesium clock" was one
  bullet and only half of it was still true.
- Persistence (Postgres/Redis/MinIO) + GPU reconstruction — `docs/CONSOLIDATION.md`
  Phases 3–4.
- Live end-to-end with populated located memories, Portal + CI-Server, physical
  devices, and repeatable screenshot/demo capture in release CI.
