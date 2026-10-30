#!/usr/bin/env bash
#
# Companion Atlas's stage: the Vite dev server of viewer-react, no backend.
#
# WHY THERE ARE NO COMMITTED SHOTS YET. The viewer is a live Cesium globe, and
# four things stop a frame from being filmable honestly today (see README.md):
#   1. the timeline plays in real time, so the clock in every frame differs;
#   2. basemap imagery is fetched live, so tiles arrive in a different order;
#   3. the bundled sample story shows "Unnamed location" / "Unknown place";
#   4. with no `?story=` the viewer prints "Demo data - not connected".
# This stage is complete enough to try the recipes; it is not a promise they
# are deterministic.

STAGE_PID=""

stage_up() {
  stage_down
  STAGE_PORT="$(pick_port 4174)"
  STAGE_URL="http://127.0.0.1:$STAGE_PORT"
  export APP_URL="$STAGE_URL"
  [ "$STAGE_PORT" = 4174 ] || echo "note: :4174 was busy, using :$STAGE_PORT"

  # The design tokens come from the third_party/ci-common submodule. `npm ci` is
  # not used: package-lock.json is out of sync with package.json on main today
  # (`npm ci` fails with EUSAGE), so install with `npm install`. That rewrites package-lock.json by a line;
  # do not commit it. Without the lockfile the private @companionintelligence/config
  # devDependency needs a GitHub Packages token (401), which this stage never supplies.
  ( cd "$REPO_ROOT" && git submodule update --init --depth 1 third_party/ci-common && npm install --ignore-scripts --no-audit --no-fund --silent && npm run build -w packages/story-schema --silent )

  ( cd "$REPO_ROOT/viewer-react" && exec ../node_modules/.bin/vite --host 127.0.0.1 --port "$STAGE_PORT" --strictPort ) > "$STAGE_LOG" 2>&1 &
  STAGE_PID=$!

  local code=000
  for _ in $(seq 1 60); do
    code="$(curl -sS -o /dev/null -w '%{http_code}' "$STAGE_URL/" 2>/dev/null || true)"
    [ -n "$code" ] && [ "$code" != 000 ] && break
    kill -0 "$STAGE_PID" 2>/dev/null || { echo "vite exited during startup" >&2; return 1; }
    sleep 1
  done
  [ "$code" != 000 ] || { echo "vite never answered on :$STAGE_PORT" >&2; return 1; }
  echo "stage up at $STAGE_URL"
}

stage_down() {
  if [ -n "$STAGE_PID" ] && kill -0 "$STAGE_PID" 2>/dev/null; then
    pkill -P "$STAGE_PID" 2>/dev/null || true
    kill "$STAGE_PID" 2>/dev/null || true
    wait "$STAGE_PID" 2>/dev/null || true
  fi
  local pid
  pid="$(lsof -ti "tcp:${STAGE_PORT:-4174}" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  [ -z "$pid" ] || kill "$pid" 2>/dev/null || true
  STAGE_PID=""
}
