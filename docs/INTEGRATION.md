# Companion Atlas — Platform Integration & Local Dev

> **Private & Confidential — Property of Lifescope Inc.**
> How Atlas connects to the Companion Intelligence platform: CI-Portal OIDC,
> CI-Server Memory, the CI-Hub/marketplace framework, and CI-Common theming — plus
> the local dev mode. Grounded in the current Atlas implementation (2026-09-03).

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

**Mode B — CONNECTED (real Portal + CI-Server)** 🟡
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
  Authorization Code + PKCE (S256), public client. The module mirrors the Hub
  RP flow but is not yet wired into the viewer shell. The viewer does provide a
  separate embedded CI-Server sign-in/retry path for a connected Memory source;
  it exchanges the server's CSRF-protected credentials for a scoped bearer kept
  in the browser tab.

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

## 4. CI-Hub / Marketplace 🟡

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

## 6. Theming (CI-Common) ✅

The small CI token contract used by Atlas is kept in the standalone
[`viewer-react/src/theme/atlas-tokens.css`](../viewer-react/src/theme/atlas-tokens.css)
bridge so a fresh checkout does not depend on a sibling CI-Common checkout or a
private registry. `theme.css` imports the bridge and `theme/index.ts` exposes
`primaryHex()` for Cesium/R3F colors. Manrope is self-hosted via `@fontsource`.
`npm run lint:canon` remains the brand-color gate. CI-Common's `auth` package is
a stub (contract only) — we implemented the verifier ourselves per §2.

## 7. What's left

- Adopt `@companion-atlas/story` in the server schema (delete the mirrored Zod) — a
  breaking migration; see `docs/CONSOLIDATION.md`.
- Wire the Portal SPA login into the viewer shell and define token refresh/logout
  semantics. The Cesium clock, React shell, scrapbook, and CI-Server sign-in
  recovery are already implemented in `viewer-react`.
- Persistence (Postgres/Redis/MinIO) + GPU reconstruction — `docs/CONSOLIDATION.md`
  Phases 3–4.
- Live end-to-end with populated located memories, Portal + CI-Server, physical
  devices, and repeatable screenshot/demo capture in release CI.
