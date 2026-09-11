# Theme — Companion Intelligence canonical tokens

Atlas keeps the small set of CI design tokens it consumes in this workspace so
the viewer can be installed and previewed from a fresh checkout without a
sibling CI-Common directory. The values mirror the dark Companion Intelligence
v0.3 contract.

- **DOM/React UI** → `theme.css` imports `atlas-tokens.css` and Manrope; dark mode
  is the `.dark` class on `<html>`.
- **WebGL (Cesium / R3F)** → import `primaryHex()` / `tokens` from `./index.ts`.
- **Gate** → `npm run lint:canon` (from the repo root) fails the build if any
  `--primary` drifts from canon.
