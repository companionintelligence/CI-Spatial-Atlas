# Companion Atlas Copilot Instructions

One viewer — `viewer-react/` (Resium/CesiumJS for desktop + mobile,
React-Three-Fiber + `@react-three/xr` for WebXR) — over the shared 4D `Story`
schema in `packages/story-schema/`, with the processing server in `server/`.

## Core loop

1. Make one scoped change at a time.
2. Keep scene state declarative and modular.
3. Run `npm test` after every meaningful edit set.
4. Run `npm run build` before considering a change complete.

## Implementation conventions

- Prefer small focused modules in `viewer-react/src/` over large monolithic files.
- Model changes belong in `packages/story-schema/` (Zod is the source of truth;
  regenerate JSON Schema with `npm run gen:schema -w @companion-atlas/story`),
  not in viewer-local types.
- Use account-scoped persistence for user-authored data.
- Preserve mobile + desktop compatibility in all UI changes, and keep the WebXR
  renderer (`viewer-react/src/renderers/xr/`) working off the same model.

## Safety checks

- Do not merge features without a passing `npm test` and `npm run build`.
- Add Vitest coverage in `viewer-react/test/` for new logic.
- Keep all new code browser-native; design tokens come from
  `@companionintelligence/tokens`, not hardcoded values.
