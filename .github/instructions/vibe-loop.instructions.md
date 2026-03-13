---
applyTo: "src/**/*.js,index.html,src/**/*.css,tests/visual/**/*.js,playwright.config.js"
description: "Use when iterating Companion Earth features under the declarative vibe workflow and visual regression loop."
---

# Vibe Loop Instruction

When editing this codebase:

- Express new scene features with explicit state objects and helper functions.
- Keep animation deterministic under `?static=1`.
- Maintain test stability by avoiding random UI text/content in visual snapshots.
- Update visual tests when UX structure changes.

Before finishing any change set:

1. Run `npm run vibe:build`.
2. Run `npm run vibe:test`.
3. If snapshots changed intentionally, run `npm run vibe:test:update` then `npm run vibe:test`.
