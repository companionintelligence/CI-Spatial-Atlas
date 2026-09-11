# Companion Atlas — web viewer image.
# Multi-stage: build the Vite SPA under Deno (npm/Node compat mode), then serve
# the static bundle with nginx.

FROM denoland/deno:alpine-2.9.5 AS build
WORKDIR /app
# Only this package's own manifests are copied in — the sibling npm/Deno
# workspace members (packages/story-schema, viewer-react, server) are never
# added to this image. The root viewer doesn't depend on any of them, and
# Deno's npm-workspace resolution re-checks *every* workspace member's
# package.json on each `deno task` invocation (unlike `npm run`, which only
# resolves once at `npm ci` time) — this image intentionally copies only the
# root viewer manifests so unrelated workspace packages and browser-only
# dependencies cannot affect its build.
COPY package.json package-lock.json deno.json ./
RUN deno install
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY materials ./materials
COPY tests ./tests
# Production build. Build-time map keys are injected as Vite `define`
# constants (see vite.config.ts); pass them as --build-arg / env.
#
# NOTE: `deno task textures:build` is deliberately NOT run here (same fix as
# the npm-based image, PR #19/#20 — the Deno migration branched before that
# landed and had independently reached for installing ImageMagick instead).
# It shells out to ImageMagick (`magick`), which isn't present in this image,
# and would make the build fail the way it used to before #19/#20. The
# generated textures under public/textures/ are committed to the repo, so the
# build doesn't need to regenerate them; run `deno task textures:build` (or
# `npm run textures:build`) locally and commit the result when the source
# material in materials/ changes.
ARG CESIUM_ION_TOKEN=""
ARG GOOGLE_MAP_PLATFORM=""
ARG MAPBOX_API_KEY=""
ARG ESRI_API_KEY=""
ENV CESIUM_ION_TOKEN=$CESIUM_ION_TOKEN \
    GOOGLE_MAP_PLATFORM=$GOOGLE_MAP_PLATFORM \
    MAPBOX_API_KEY=$MAPBOX_API_KEY \
    ESRI_API_KEY=$ESRI_API_KEY
RUN deno task cesium:assets && deno task build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
# Serve on 8080 to match the port this app advertises to CI-Hub in both
# hub/config.json ("port": 8080) and hub/docker-compose.json
# ("internalPort": 8080). The image previously listened on 80, so a Hub
# install would have routed to a dead port.
#
# SPA fallback so deep links (and ?story=… URLs) resolve to index.html.
RUN printf 'server {\n  listen 8080;\n  root /usr/share/nginx/html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 8080
