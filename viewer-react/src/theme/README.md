# Theme — Companion Intelligence canonical tokens

Design tokens are consumed from [`@companionintelligence/tokens`](https://github.com/companionintelligence/CI-Common/tree/main/packages/tokens)
v0.3 (phthalo-mist palette, Manrope typography) via a local file dependency on
CI-Common.

- **DOM/React UI** → `theme.css` imports `tokens.css` and Manrope; dark mode
  is the `.dark` class on `<html>`.
- **WebGL (Cesium / R3F)** → import `primaryHex()` / `tokens` from `./index.ts`.
- **Gate** → `npm run lint:canon` (from the repo root) fails the build if any
  `--primary` drifts from canon.
