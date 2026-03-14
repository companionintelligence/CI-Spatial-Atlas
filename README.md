# Companion Earth

Companion Earth is a browser-native, Three.js-powered planetary exploration prototype with an iterative vibe coding workflow.

## Current Feature Set

- Declarative scene setup for globe rendering
- Desktop drag-to-rotate globe interaction
- Account session switching
- Spatial scrapbook pin drops rendered as globe beacons
- Direct in-scene scrapbook beacon selection
- Chronological journey routes rendered across scrapbook memories
- Account-scoped local persistence for scrapbook memories
- Deterministic visual regression mode via `/?static=1`

## Iterative Vibe Loop

1. `npm install`
2. `npm run vibe:dev`
3. `npm run vibe:build`
4. `npm run vibe:test`
5. If UI changes are intentional: `npm run vibe:test:update` then `npm run vibe:test`
6. Pre-merge gate: `npm run vibe:loop`

## New Account Session

- CLI setup: `npm run account:new -- "my-account"`
- In-app setup: use the **New Account** panel and submit.

## Agent Customization Files

- `.github/copilot-instructions.md`
- `.github/instructions/vibe-loop.instructions.md`
- `.github/agents/vibe-iteration.agent.md`
- `.github/prompts/vibe-iterate.prompt.md`

These files are configured to support continuous, scoped iterations with visual stability checks.
