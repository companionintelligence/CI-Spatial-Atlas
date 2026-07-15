# Theme — Companion Intelligence canonical tokens

`tokens.css`, `tokens.json`, and `montserrat.ts` are **vendored copies** of
[`@companionintelligence/tokens`](https://github.com/companionintelligence/CI-Common/tree/main/packages/tokens)
(CI-Common). Vendoring is the sanctioned offline consumption path for repos that
don't wire GitHub Packages auth — the governance rule is that per-repo token
files **track** the package and never fork, and that `--primary` always resolves
to CI teal (`#0f717a` light / `#abd4d8` dark).

- **DOM/React UI** → `theme.css` imports `tokens.css` and Montserrat; dark mode
  is the `.dark` class on `<html>`.
- **WebGL (Cesium / R3F)** → import `primaryHex()` / `tokens` from `./index.ts`.
- **Gate** → `npm run lint:canon` (from the repo root) fails the build if any
  `--primary` drifts from canon.

To resync after CI-Common updates: copy `packages/tokens/src/{tokens.css,tokens.json,montserrat.ts}`
from CI-Common over these files. When Atlas adopts GitHub Packages auth, replace
the vendored files with a `@companionintelligence/tokens` dependency.
