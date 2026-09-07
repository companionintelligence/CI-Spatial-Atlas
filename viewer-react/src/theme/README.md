# Theme — Companion Intelligence canonical tokens

Design tokens are consumed from [`@companionintelligence/tokens`](https://github.com/companionintelligence/CI-Common/tree/main/packages/tokens)
v0.3 (phthalo-mist palette, Manrope typography) via a local file dependency on
CI-Common.

- **DOM/React UI** → `theme.css` imports `tokens.css` and Manrope; dark mode
  is the `.dark` class on `<html>`.
- **WebGL (Cesium / R3F)** → hex literals in `layers/cesium.ts`, `authoring/style.ts`
  and `authoring/entities.ts`, mirroring `atlas.css`. There is no programmatic
  tokens import — `index.ts` was written for that job, never adopted, and has
  been deleted; `npm run lint:canon` is what keeps those literals honest.
- **Gate** → `npm run lint:canon` (from the repo root) fails the build if any
  `--primary` drifts from canon.
