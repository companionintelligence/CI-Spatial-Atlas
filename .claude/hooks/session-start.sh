#!/bin/bash
# Claude Code on the web — SessionStart hook for Companion Atlas.
#
# Gets a fresh cloud checkout into a buildable/testable state:
#   1. third_party/ci-common (private submodule; @companionintelligence/tokens,
#      which viewer-react's theme imports directly) — not checked out by a
#      plain `git clone` unless --recurse-submodules was used.
#   2. `npm install` at the workspace root, which also needs a real
#      read:packages token for @companionintelligence/config (+ its
#      @companionintelligence/content dep) on npm.pkg.github.com — see .npmrc.
#      This session's own git-proxy GITHUB_TOKEN does not carry that scope
#      (proven by hand: 401 unauthenticated), so a PAT must be supplied
#      separately as NODE_AUTH_TOKEN.
#
# Never fails the session: every step degrades to a loud, actionable warning
# rather than a non-zero exit, so a missing token blocks only the install, not
# the whole cloud session from starting.

set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR" || exit 0

echo "== Companion Atlas: session-start =="

# ── 1. Private submodule ────────────────────────────────────────────────────
if [ -f .gitmodules ]; then
  echo "-> git submodule update --init third_party/ci-common"
  if ! git submodule update --init --depth 1 third_party/ci-common; then
    echo "!! Submodule init failed — if this session has no GitHub access to"
    echo "!! companionintelligence/CI-Common, viewer-react's theme import"
    echo "!! (@companionintelligence/tokens) will not resolve and the build will fail."
  fi
fi

# ── 2. npm install (needs GitHub Packages auth for @companionintelligence/*) ─
AUTH_TOKEN="${NODE_AUTH_TOKEN:-${GITHUB_TOKEN:-}}"

if [ -z "$AUTH_TOKEN" ]; then
  echo "!! NODE_AUTH_TOKEN is not set — skipping npm install."
  echo "!! @companionintelligence/config (root devDependency; pulls in"
  echo "!! @companionintelligence/content) is fetched from npm.pkg.github.com"
  echo "!! (.npmrc) and 401s without a token scoped read:packages on the"
  echo "!! companionintelligence org."
  echo "!! @companionintelligence/tokens ALSO hits the registry despite the"
  echo "!! third_party/ci-common submodule above: viewer-react asks for ^1.0.0"
  echo "!! but the submodule's packages/tokens is pinned at 0.3.1 (latest on"
  echo "!! CI-Common main as of this writing), so npm's workspace version match"
  echo "!! fails and it falls through to the registry for that package too."
  echo "!!"
  echo "!! Fix: add NODE_AUTH_TOKEN in this environment's settings (session"
  echo "!! title bar -> Edit -> environment variables) with a GitHub PAT"
  echo "!! (classic, read:packages scope, SSO-authorized for companionintelligence),"
  echo "!! then start a new session."
  exit 0
fi

export NODE_AUTH_TOKEN="$AUTH_TOKEN"
echo "-> npm install"
if ! npm install --no-audit --no-fund; then
  echo "!! npm install failed. A 401/403 on @companionintelligence/* means the"
  echo "!! configured NODE_AUTH_TOKEN lacks read:packages on companionintelligence."
  exit 0
fi

echo "-> npm run build -w packages/story-schema (workspace dep for viewer-react + server)"
if ! npm run build -w packages/story-schema; then
  echo "!! @companion-atlas/story build failed — viewer-react/server typecheck will fail too."
fi

echo "== session-start done =="
