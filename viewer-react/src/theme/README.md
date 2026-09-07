# Theme — Companion Intelligence canonical tokens

Design tokens are consumed from [`@companionintelligence/tokens`](https://github.com/companionintelligence/CI-Common/tree/main/packages/tokens)
v0.3 (phthalo-mist palette — `--primary` `#0a6358` light / `#c5e8dc` dark — and
Manrope typography) via a local `link:` dependency on a sibling CI-Common
checkout. Nothing here is vendored: `theme.css` line 12 `@import`s the bare
specifier, which is why `vite build` (and only `vite build`) needs that sibling.
See `docs/architecture.md` §8.

- **DOM/React UI** → `theme.css` imports `tokens.css` and Manrope. tokens.css
  ships a `.dark` block, but nothing in `viewer-react` ever adds that class:
  the shell is committed dark through `atlas.css`, which aliases `--atlas-*`
  onto the canonical ramp (`--teal-950`, `--teal-900`, `--teal-200`). There is
  no light/dark toggle to drive.
- **WebGL (Cesium / R3F)** → hex literals in `layers/cesium.ts`, `authoring/style.ts`
  and `authoring/entities.ts`, mirroring `atlas.css`. There is no programmatic
  tokens import — `index.ts` was written for that job, never adopted, and has
  been deleted.
- **Gate** → `npm run lint:canon` (from the repo root) fails the build if any
  `--primary` declaration drifts from canon, and names the replacement when the
  value is a retired brand teal.

**What the gate does *not* cover.** An earlier version of this file said
`lint:canon` is "what keeps those literals honest". It is not: read
`scripts/lint-canon.mjs`, and loose hex literals matched by the HEX regex go to
`warns`, which are explicitly non-blocking — only a non-canon `--primary`
declaration, a `brand*`-prefixed JS key, or a generic `primary*` key holding a
retired value push onto `fails`. Run it today and it prints warnings for
`authoring/style.ts:73`, `authoring/icons.ts:160`, `renderers/xr/ComfortPanel.tsx:252`
and ~40 more, then exits 0. So the WebGL colors are held to `atlas.css` by
review and by these comments alone. Making them genuinely gated means either
promoting HEX warnings to failures under `src/{layers,authoring,renderers}/` or
restoring a programmatic tokens import for those files once the package is
resolvable from a clean checkout — until one of those happens, do not rely on
the gate to catch a drifted literal.
