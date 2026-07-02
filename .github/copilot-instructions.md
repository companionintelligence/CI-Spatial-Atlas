# Companion Atlas Copilot Instructions

This repository is optimized for iterative vibe coding.

## Core loop

1. Make one scoped change at a time.
2. Keep scene state declarative and modular.
3. Run `npm run vibe:build` after every meaningful edit set.
4. Run `npm run vibe:test` before considering a change complete.
5. If rendering/UI changes, update baselines with `npm run vibe:test:update` and rerun `npm run vibe:test`.

## Implementation conventions

- Prefer small focused modules in `src/` over large monolithic files.
- Keep deterministic behavior for tests using `/?static=1`.
- Use account-scoped persistence for user-authored data.
- Preserve mobile + desktop compatibility in all UI changes.

## Safety checks

- Do not remove visual regression coverage.
- Do not merge features without passing `npm run vibe:loop`.
- Keep all new code OSS-friendly and browser-native.
