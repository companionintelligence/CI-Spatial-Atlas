# Companion Atlas — Platform Integration & Local Dev

> **Private & Confidential — Property of Lifescope Inc.**
> How Atlas connects to the Companion Intelligence platform: CI-Portal OIDC,
> CI-Server Memory, the CI-Hub/marketplace framework, and CI-Common theming — plus
> the local dev mode. Grounded in recon of each repo's default branch (2026-07).

## Status legend

- ✅ **implemented + tested** in this repo
- 🟡 **scaffolded** (real code, not yet built/run — part of `viewer-react`)
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

**Mode B — CONNECTED (real Portal + CI-Server)** 🟡
Set in `.env.dev`:
```sh
COMPANION_OIDC_ISSUER=https://hub.ci.localhost/api/auth   # local Portal dev
CI_MEMORY_URL=http://localhost:3030/graphql               # local CI-Server
```
Now the API verifies Portal JWTs and seeds stories from real located memories.
Requires the two cross-repo prerequisites in §5.

---

## 2. CI-Portal OIDC ✅ (backend) / 🟡 (SPA)

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

## 3. CI-Server Companion Memory ✅

CI-Server exposes **GraphQL** at `/graphql` (`:3030` direct, `/api/graphql` via proxy).
- **Query** ✅ located photos/videos via `search(input:{ includeTypes:["event"],
  hasLocation:true, eventTypes:["photo","video"], sortBy:"time" })` → `EventType`
  nodes → canonical `MediaItem[]`. **Corrects PR #8:** the slug is `"event"` (not
  `"EventType"`, which returns zero rows), and `previewUrl`/`mediaUrl` are **relative
  presigned paths** that are absolutized against the CI-Server origin.
- **Write-back** ✅ via the idempotent `createEvent` mutation (dedups on
  source triple; `sharingLevel` from story visibility).
- Transport in [`server/src/ci-memory-client.ts`](../server/src/ci-memory-client.ts)
  (tested with a mock fetch); query/mutation/mapping live in `@companion-atlas/story`
  (`memory.ts`); the suite facade is `server/src/connectors.ts` (`CiMemoryConnector`).
- Auth: sends `Authorization: Bearer <PortalToken>`. Needs `PORTAL_OIDC_ENABLED=true`
  + `companion-atlas` in CI-Server `PORTAL_OIDC_AUDIENCE` (or a CI-Server JWT / key).

## 4. CI-Hub / Marketplace 🟡

Register Atlas as a Hub app: [`hub/config.json`](../hub/config.json) (`AppInfo`) +
[`hub/docker-compose.json`](../hub/docker-compose.json). Key blocks:
- `hub_integration.oidc` → the Hub injects `COMPANION_OIDC_ISSUER=<CI_CLOUD_URL>/api/auth`.
- `hub_integration.memory` → the Hub injects `CI_MEMORY_URL` + a minted `CI_MEMORY_TOKEN`.
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

## 6. Theming (CI-Common) ✅

CI canonical tokens (`@companionintelligence/tokens`, teal `--primary`
#0f717a/#abd4d8 + Montserrat) are **vendored** (sanctioned offline path) into
[`viewer-react/src/theme/`](../viewer-react/src/theme/) — `tokens.css`/`tokens.json`
imported by `theme.css`; `primaryHex()` for Cesium/R3F colors; dark mode = `.dark`
on `<html>`. `npm run lint:canon` (CI-Common's zero-dep gate) fails the build if
`--primary` drifts. CI-Common's `auth` package is a stub (contract only) — we
implemented the verifier ourselves per §2.

## 7. What's left

- Adopt `@companion-atlas/story` in the server schema (delete the mirrored Zod) — a
  breaking migration; see `docs/CONSOLIDATION.md`.
- Build `viewer-react` (Resium spike), wire the SPA login + Cesium clock.
- Persistence (Postgres/Redis/MinIO) + GPU reconstruction — `docs/CONSOLIDATION.md`
  Phases 3–4.
- Live end-to-end (Portal + CI-Server up) + screenshots/demo videos.
