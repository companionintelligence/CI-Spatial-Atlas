---
applyTo: "viewer-react/**/*.ts,viewer-react/**/*.tsx,viewer-react/**/*.css,packages/story-schema/src/**/*.ts"
description: "Use when iterating Companion Atlas viewer features under the workspace build + test loop."
---

# Iteration Instructions

When editing this codebase:

- Express new scene features with explicit state objects and helper functions.
- Keep the Cesium and WebXR renderers reading from the same `Story` model —
  entity/geometry logic belongs in shared helpers, not duplicated per renderer.
- Cover new logic with Vitest in `viewer-react/test/`; keep the suites free of
  network access (stub `fetch`).
- Take design values from `@companionintelligence/tokens`.

Before finishing any change set:

1. Run `npm test`.
2. Run `npm run build`.
