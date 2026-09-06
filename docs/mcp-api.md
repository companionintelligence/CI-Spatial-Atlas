# Companion Atlas — MCP API reference

The Atlas MCP server (`server/src/mcp.ts`) is the programmatic surface for
building and publishing **4D scrapbook stories** — manually (a person in an
MCP‑capable app) or automatically (OpenClaw, Hermes, the CI agent). Every tool
operates on a `companion.atlas/story@1` document (see
[`../packages/story-schema/src/`](../packages/story-schema/src)).

See [`architecture.md` §6.1](architecture.md#61-auto-compose-flow-the-automatic-path)
for a sequence diagram of the automatic recipe below end to end.

## Transports

- **stdio** — local agents / editors:
  ```sh
  claude mcp add companion-atlas -- node /path/to/server/dist/mcp-stdio.js
  ```
  or, equivalently, an `mcp.json`-style entry:
  ```json
  { "mcpServers": {
      "companion-atlas": { "command": "node", "args": ["/path/to/server/dist/mcp-stdio.js"] }
  } }
  ```
- **Streamable HTTP** — suite services, OIDC‑authenticated: `POST /mcp` on the
  `atlas-api` container. Send the Companion OIDC bearer token in
  `Authorization: Bearer <jwt>`.
  ```json
  { "mcpServers": {
      "companion-atlas": { "url": "https://atlas.ci.computer/mcp",
                            "headers": { "Authorization": "Bearer <jwt>" } }
  } }
  ```

## Authorisation

Tools are scoped to the caller's verified OIDC subject (see
[`server/src/auth.ts`](../server/src/auth.ts)). Over Streamable HTTP the bearer
token on the `POST /mcp` request supplies that subject; over stdio the local
process is the trust boundary and tools run as the `*`-scoped dev subject.

- **Writes** (`atlas_create_story`, `atlas_ingest_media`, `atlas_add_scene`,
  `atlas_set_timeline`, `atlas_add_layer`, `atlas_auto_compose`,
  `atlas_publish_story`) need a verified subject, and the story must be one the
  caller owns — otherwise the tool returns an error result
  (`Unauthenticated: …` / `Forbidden: …`) rather than acting.
- `atlas_create_story` records the caller as the owner. The `author` input is a
  display name only; it does not confer ownership.
- **Reads** (`atlas_get_story`, `atlas_list_stories`, the `story://{id}`
  resource) follow story visibility: `public`/`unlisted` are readable by
  anyone, `private` only by its owner. `atlas_list_stories` filters to what the
  caller may read.
- `atlas_query_memory` and `atlas_get_job` need a verified subject; a job is
  readable by whoever may read its story.

## Tools

| Tool | Purpose | Key inputs |
|---|---|---|
| `atlas_create_story` | Create an empty story | `title`, `description?`, `author?` |
| `atlas_query_memory` | Find geotagged media in CI‑Server memory to seed a story | `text?`, `bbox?`, `timeRange?`, `limit?` |
| `atlas_ingest_media` | Ingest images/image‑set/video → `MediaItem`s; optionally start 3D reconstruction | `storyId`, `sources[]`, `reconstruct?`, `defaultLocation?` |
| `atlas_get_job` | Poll an ingest/reconstruct/tile job | `jobId` |
| `atlas_add_scene` | Append a narrative scene (scrapbook page / keyframe) | `storyId`, `title`, `narrative?`, `time?`, `camera?`, `mediaIds?` |
| `atlas_set_timeline` | Set the playback clock | `storyId`, `start`, `stop`, `multiplier?`, `loop?` |
| `atlas_add_layer` | Attach a 3D‑tiles / splat / terrain / imagery / geojson layer | `storyId`, `kind`, `name?`, `uri?`, `format?`, `attribution?`, `availability?`, `opacity?`, `visible?`, `order?` |
| `atlas_auto_compose` | Auto‑sequence located media into scenes + camera flights + timeline | `storyId` |
| `atlas_get_story` | Return the full story document | `storyId` |
| `atlas_list_stories` | List stories | — |
| `atlas_publish_story` | Publish; returns a shareable viewer URL; writes back to memory / notifies Hermes | `storyId`, `visibility?`, `notify?` |

Resource: `story://{id}` returns the story JSON, subject to the same read rules.

`atlas_add_layer`'s `attribution` (`{ text, licence?, url?, onScreen? }`) is the
source credit the layer's licence requires — OpenStreetMap (ODbL), EOX and
CARTO (CC BY) and OpenSeaMap (CC BY‑SA) all condition use on displaying it, so
set it whenever you attach third‑party imagery. `format` names the wire format
of `uri` (`xyz`, `tms`, `wmts`, `wms`, `geojson`, `kml`, `czml`, `3d-tiles`,
`gaussian-splat`, `quantized-mesh`) for the cases `kind` cannot stand in for —
`imagery` spans xyz/tms/wmts/wms, and `geojson` is also where kml and czml land.

## Recipes

### Automatic — "make a scrapbook map of my trip"
```text
atlas_create_story        { "title": "Iceland, March 2026" }            -> storyId
atlas_query_memory        { "bbox": [-25,63,-13,67],
                            "timeRange": {"start":"2026-03-10","stop":"2026-03-18"} } -> memories[]
atlas_ingest_media        { "storyId", "sources": [<memory uris>],
                            "reconstruct": "auto" }                       -> mediaIds, reconstructJob
atlas_get_job             { "jobId": reconstructJob }   (poll to succeeded)
atlas_auto_compose        { "storyId" }                  -> scenes + fitted timeline
atlas_publish_story       { "storyId", "visibility": "unlisted" }         -> viewerUrl
```

### Manual — curate before publishing
```text
atlas_create_story → atlas_ingest_media → atlas_add_scene (×N, hand‑written
narrative + camera) → atlas_set_timeline → atlas_add_layer → atlas_publish_story
```

## Output

`atlas_publish_story` returns:
```json
{ "viewerUrl": "https://atlas.ci.computer/?story=https%3A%2F%2F…%2Fapi%2Fpublic%2Fstories%2Fstory_…",
  "storyJsonUrl": "https://atlas.ci.computer/api/public/stories/story_…",
  "visibility": "unlisted" }
```
Opening `viewerUrl` renders the story. Today that runs on the three.js globe via
the `?story=` loader; Phase 2 renders it on CesiumJS with the full timeline,
3D Tiles, and Gaussian‑splat layers.

## REST parity

Every MCP tool has a REST equivalent on `atlas-api` (`server/src/api.ts`), e.g.
`POST /api/stories`, `POST /api/stories/:id/media`, `POST /api/stories/:id/compose`,
`POST /api/stories/:id/publish`, `GET /api/public/stories/:id` (the viewer's
fetch target), `GET /api/jobs/:id`.
