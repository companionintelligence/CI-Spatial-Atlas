# Companion Atlas — processing server + MCP API

The 3D processing server for Companion Atlas: a Fastify REST API and an MCP
server that build, store, and publish 4D scrapbook stories, plus the
orchestration for the image/video → 3D reconstruction pipeline and the
Companion Intelligence suite connectors.

> Scaffold status: stores are in‑memory, auth is decode‑only, and reconstruction
> shells out to tools that live in the GPU worker image. See
> [`../REIMAGINE.md`](../REIMAGINE.md) for the roadmap. Heavy native tools
> (COLMAP, OpenDroneMap, Nerfstudio, ffmpeg) are **not** npm deps — they run in
> `../docker/Dockerfile.worker`.

## Run locally

```sh
npm install
npm run dev            # REST API + MCP-over-HTTP on :8787
# or the stdio MCP server for local agents:
npm run mcp:stdio
```

Register the stdio server with Claude Code:
```sh
npm run build
claude mcp add companion-atlas -- node "$PWD/dist/mcp-stdio.js"
```

Or under Deno (`deno.json` mirrors the npm scripts as tasks; run from the repo
root so the `@companion-atlas/story` workspace dependency resolves):

```sh
deno install            # once, from the repo root
cd server
deno task dev            # REST API + MCP-over-HTTP on :8787
deno task test            # vitest, run under Deno's npm/Node compat
```

The container (`server/Dockerfile`) runs the compiled server with a scoped
permission set (`--allow-net --allow-env --allow-read=. --allow-sys`) — no
`--allow-run`, since `src/pipeline.ts`'s `exiftool-vendored` calls are still
orchestration stubs. See the Dockerfile's comments for the exact `--allow-run`
scoping to add once that's wired up.

## Layout

| File | Responsibility |
|---|---|
| `src/schema.ts` | Zod runtime mirror of the `Story` schema |
| `src/store.ts` | `StoryStore` + `JobStore` (in‑memory; swap for Postgres/Redis) |
| `src/mcp.ts` | **MCP API** — the tool surface (see `../docs/mcp-api.md`) |
| `src/api.ts` | REST API + the public `GET /api/public/stories/:id` viewer endpoint |
| `src/compose.ts` | Auto‑composition (time ordering, flight pacing) |
| `src/pipeline.ts` | ingest → reconstruct → tile orchestration |
| `src/connectors.ts` | CI‑Server memory, OpenClaw, Hermes connectors |
| `src/auth.ts` | Companion OIDC bearer verification |
| `src/index.ts` | Entry: Fastify + Streamable‑HTTP MCP at `/mcp` |
| `src/mcp-stdio.ts` | Entry: stdio MCP transport |

## Configuration

See [`../.env.default`](../.env.default) for `CI_MEMORY_URL`, optional
`CI_MEMORY_TOKEN` / `CI_MEMORY_API_KEY`, `OPENCLAW_URL`,
`HERMES_URL`, `COMPANION_OIDC_*`, `DATABASE_URL`, `REDIS_URL`, and `S3_*`.
With no OIDC issuer set, auth is disabled and everything runs as a single dev
subject.

## Cloudflare deployment (prod)

`wrangler.toml` + `src/worker.ts` are a **second, parallel entry point** —
not a replacement for the Fastify server above — for a standalone deployment
at `https://atlas.ci.computer`. One Worker (`ci-atlas-prod`) serves the
`viewer-react` build as static assets and this REST API surface at `/api/*`,
against D1 (`src/store-d1.ts`) and R2 (`src/object-store-r2.ts`) instead of
Postgres/Redis/MinIO.

**Deliberately out of scope** — see `wrangler.toml` and `worker.ts`'s header
comments for the full reasoning:
- The MCP tool surface (`mcp.ts`) — OpenClaw/Hermes/agents keep using the
  containerized Fastify server's `/mcp`.
- Real 3D reconstruction (`pipeline.ts`'s `reconstruct()`) — COLMAP,
  OpenDroneMap, and Nerfstudio need a GPU worker container Workers cannot
  run. Reconstruct jobs enqueue here but nothing drains them.

**Before this deployment serves anything but `/healthz`**, `COMPANION_OIDC_ISSUER`
must be set (in `wrangler.toml`'s `[vars]`, or as a secret) — the Worker
refuses every other request with a 500 otherwise, the same rule
`assertAuthSafeToBoot()` enforces once at process boot for the Fastify
server, applied per-request since a Worker has no boot phase.

```sh
npm run build          # from the repo root — builds viewer-react/dist
cd server
npm run deploy         # wrangler deploy
```

CI does this automatically on push to `main`
(`.github/workflows/deploy-cloudflare.yml`), given `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` repository secrets.

**One manual step this repo cannot do for you:** attaching the
`atlas.ci.computer` custom domain to the `ci-atlas-prod` Worker is a
Cloudflare-dashboard, DNS-zone change (Workers & Pages → `ci-atlas-prod` →
Settings → Domains & Routes), not something `wrangler.toml` or CI can express
— do this once, as someone with access to the `ci.computer` zone.
