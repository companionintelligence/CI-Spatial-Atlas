# Declarative Vibe Coding Workflow

This project uses a deterministic loop for spatial UI development.

## Commands

- `npm run account:new -- "your-account-name"`
- `npm run vibe:dev`
- `npm run vibe:build`
- `npm run vibe:test:update`
- `npm run vibe:test`
- `npm run vibe:loop`

## Loop

1. Set account context with `account:new`.
2. Run `vibe:dev` and verify real-time updates.
3. Build with `vibe:build`.
4. Generate screenshot baselines with `vibe:test:update`.
5. Validate with `vibe:test`.
6. Use `vibe:loop` as pre-merge gate.

## Determinism

Visual tests use `/?static=1` to disable animation drift for screenshots.
