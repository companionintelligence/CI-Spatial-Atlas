# Companion Atlas — viewer-react (Resium/CesiumJS + React-Three-Fiber WebXR)
# web viewer image. Multi-stage: build the Vite SPA, then serve the static
# bundle with nginx. Build context must be the REPO ROOT (`docker build -f
# viewer-react/Dockerfile .`), not viewer-react/ — this app resolves
# @companion-atlas/story via the npm workspace, so the root package.json and
# packages/story-schema must be in the build context.
#
# The @companionintelligence/tokens dependency used to make this image
# impossible to build: package-lock.json resolved it to `link:../ci-common`, a
# path outside the build context. It is now a pinned git submodule inside the
# repo (third_party/ci-common) and an npm workspace, so a clean checkout with
# `--recurse-submodules` builds with nothing else on the machine. Verified by
# building with the sibling checkout removed entirely.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/story-schema/package.json packages/story-schema/tsconfig.json packages/story-schema/
COPY packages/story-schema/src packages/story-schema/src
COPY viewer-react/package.json viewer-react/
# The tokens package is an npm *workspace* now, vendored as a pinned submodule
# at third_party/ci-common (see .gitmodules). npm ci reads the lockfile before
# `COPY . .` lands, and a workspace whose directory is absent fails the install
# outright — so its manifest has to be here already. The whole package is copied
# rather than just package.json because the build consumes its tokens.css
# directly, and it is ~7KB.
COPY third_party/ci-common/packages/tokens third_party/ci-common/packages/tokens
# @companionintelligence/* resolve to npm.pkg.github.com in package-lock.json, which
# needs a token even for reads. The token comes in as a BuildKit secret (never an
# ARG/ENV, so it is not in any layer) and the scope npmrc is written and removed in
# the same RUN. The build still works without the secret for registries that need none.
RUN --mount=type=secret,id=NODE_AUTH_TOKEN \
    if [ -s /run/secrets/NODE_AUTH_TOKEN ]; then \
      printf '@companionintelligence:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n' "$(cat /run/secrets/NODE_AUTH_TOKEN)" > /root/.npmrc; \
    fi; \
    npm ci; rc=$?; rm -f /root/.npmrc; exit $rc
COPY . .
# packages/story-schema ships from its own dist/, which nothing builds
# automatically (no root lifecycle hook does this — a `prepare` script here
# once broke the CI job that installs a single workspace at a time with
# --workspaces=false, since that install never resolves story-schema's own
# `zod` dependency). Build it explicitly, every time something needs it.
RUN npm run build -w packages/story-schema
# Vite inlines import.meta.env.VITE_* at build time (see src/story/useStory.ts,
# src/renderers/CesiumStoryViewer.tsx). These are optional build-time
# defaults — `?memory=`/`?token=`/`?apiKey=` URL params still override at runtime,
# so a single built image can point at different Companion Memory servers per load.
ARG VITE_CESIUM_ION_TOKEN=""
ARG VITE_MEMORY_URL=""
ARG VITE_MEMORY_TOKEN=""
ARG VITE_MEMORY_API_KEY=""
# Self-hosted quantized-mesh terrain: the only terrain route that needs no
# account, and the reason renderers/terrain.ts exists. These have to be ARGs,
# not runtime ENVs — Vite inlines VITE_* at build time, so an env var on the
# running container reaches a bundle that was already compiled. The credit
# carries the DEM's own attribution, which Copernicus and every other free
# global DEM worth tiling require and only the operator can know.
ARG VITE_TERRAIN_URL=""
ARG VITE_TERRAIN_CREDIT=""
# The Atlas API this bundle uploads photos and videos to. A build arg for the
# same reason as the two above — an `environment:` entry on the running
# container reaches a bundle that was compiled hours earlier. Empty means the
# Import & export panel renders its upload control disabled and says why, which
# is the honest state of an image built without one.
ARG VITE_ATLAS_API=""
ENV VITE_CESIUM_ION_TOKEN=$VITE_CESIUM_ION_TOKEN \
    VITE_MEMORY_URL=$VITE_MEMORY_URL \
    VITE_MEMORY_TOKEN=$VITE_MEMORY_TOKEN \
    VITE_MEMORY_API_KEY=$VITE_MEMORY_API_KEY \
    VITE_TERRAIN_URL=$VITE_TERRAIN_URL \
    VITE_TERRAIN_CREDIT=$VITE_TERRAIN_CREDIT \
    VITE_ATLAS_API=$VITE_ATLAS_API
RUN npm run build -w viewer-react

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/viewer-react/dist /usr/share/nginx/html
# Serve on 8080 to match the port this app advertises to CI-Hub in both
# hub/config.json ("port": 8080) and hub/docker-compose.json
# ("internalPort": 8080). This image listened on 80 while it was the secondary
# viewer; now that it is *the* viewer, a Hub install would route to a dead port.
#
# SPA fallback so deep links (and ?story=/?memory=… URLs) resolve to index.html.
RUN printf 'server {\n  listen 8080;\n  root /usr/share/nginx/html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 8080
