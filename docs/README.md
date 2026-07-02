# Companion Atlas documentation

| Doc | What's in it |
|---|---|
| [`ui-guide.md`](ui-guide.md) | Every screen, panel, card, and button in the web viewer, with screenshots and interaction tables |
| [`architecture.md`](architecture.md) | How it works: mermaid diagrams for the system, render loop, camera model, pin lifecycle, WebXR, texture pipeline, the `Story` data model, and the processing server — plus reference tables (scripts, env vars, Docker services, REST endpoints) |
| [`mcp-api.md`](mcp-api.md) | The MCP tool reference for creating and publishing stories, manually or by an agent |

Start with [`../REIMAGINE.md`](../REIMAGINE.md) for *why* the product is
shaped this way — the open-web-GIS research, the 4D story concept, and the
migration roadmap. Start with [`ui-guide.md`](ui-guide.md) if you just want to
know what a button does.

## Regenerating screenshots

```sh
npm run vibe:dev            # terminal 1
npm run docs:screenshots    # terminal 2, once the dev server is up
```

Screenshots live in [`screenshots/`](screenshots) and are captured under
`?static=1` so output is reproducible across runs.
