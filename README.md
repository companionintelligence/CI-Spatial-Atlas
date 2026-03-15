# Companion Earth

Companion Earth is a browser-native, Three.js-powered planetary exploration prototype with an iterative vibe coding workflow.

## Current Feature Set

- Declarative scene setup for globe rendering
- Selectable local-texture rendering mode with KTX2-backed Earth and sky assets
- Desktop drag-to-rotate globe interaction
- Account session switching
- Spatial scrapbook pin drops rendered as globe beacons
- Direct in-scene scrapbook beacon selection
- Chronological journey routes rendered across scrapbook memories
- Account-scoped local persistence for scrapbook memories
- Deterministic visual regression mode via `/?static=1`

## Iterative Vibe Loop

1. `npm install`
2. `npm run textures:build`
3. `npm run vibe:dev`
4. `npm run vibe:build`
5. `npm run vibe:test`
6. If UI changes are intentional: `npm run vibe:test:update` then `npm run vibe:test`
7. Pre-merge gate: `npm run vibe:loop`

## Texture Assets

- Source masters live in [materials](materials).
- Derived runtime files are generated into [public/textures](public/textures) and [public/basis](public/basis).
- Regenerate the texture set with `npm run textures:build`.
- Static mode defaults to local textured rendering: `/?static=1`.
- Force local textured rendering in normal browsing with `/?imagery=local`.
- Force live provider imagery with `/?imagery=live`.

## New Account Session

- CLI setup: `npm run account:new -- "my-account"`
- In-app setup: use the **New Account** panel and submit.

## Agent Customization Files

- `.github/copilot-instructions.md`
- `.github/instructions/vibe-loop.instructions.md`
- `.github/agents/vibe-iteration.agent.md`
- `.github/prompts/vibe-iterate.prompt.md`

These files are configured to support continuous, scoped iterations with visual stability checks.
