# Companion Atlas — 3D processing API + MCP server image.
# Orchestration only: heavy reconstruction runs in the GPU worker image
# (../docker/Dockerfile.worker). This container stays small and CPU-only.
#
# Build context must be the REPO ROOT (`docker build -f server/Dockerfile .`,
# which is what docker-compose.yml does), with the third_party/ci-common
# submodule checked out.
#
# Dependencies install from the root package-lock.json with `npm ci`: the same
# lockfile that CI, the Cloudflare deploy and the viewer image install from, and
# the one audits cover. This image used to run `deno install`, which does not
# read package-lock.json, so each build resolved whatever server/package.json's
# ranges allowed that day.
#
# npm ci checks the lockfile against every workspace manifest, so all of them
# are copied (for the tokens workspace, that needs the submodule). Only the
# server and story-schema workspaces are installed: the viewer's WebGL
# dependencies never enter this image, and neither do the root's private
# @companionintelligence dev tools, so no registry token is needed.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/story-schema/package.json packages/story-schema/
COPY server/package.json server/
COPY viewer-react/package.json viewer-react/
COPY third_party/ci-common/packages/tokens/package.json third_party/ci-common/packages/tokens/
RUN npm ci --no-audit --no-fund --workspace server --workspace @companion-atlas/story

# server/src imports @companion-atlas/story (packages/story-schema), which ships
# from its own dist/, so build the schema package first.
COPY packages/story-schema/tsconfig.json packages/story-schema/
COPY packages/story-schema/src packages/story-schema/src
RUN npm run build -w packages/story-schema
COPY server/ server/
RUN npm run build -w server

# Production dependencies only, from the same lockfile, for the runtime stage.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/story-schema/package.json packages/story-schema/
COPY server/package.json server/
COPY viewer-react/package.json viewer-react/
COPY third_party/ci-common/packages/tokens/package.json third_party/ci-common/packages/tokens/
RUN npm ci --no-audit --no-fund --omit=dev --workspace server \
    && mkdir -p server/node_modules

FROM denoland/deno:debian-2.9.5 AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
# ffmpeg + exiftool are used by the ingest stage to sample video frames and
# read EXIF/GPMF telemetry before handing dense work to the GPU worker
# (server/src/pipeline.ts — currently orchestration stubs, not wired up to
# either CLI yet). perl is already present in this base image and is what
# the vendored exiftool-vendored.pl npm package (a pipeline.ts dependency
# for its real implementation) shells out to.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*
# Same layout as the npm workspace: hoisted packages in /app/node_modules, the
# story-schema workspace at /app/packages/story-schema (linked from
# /app/node_modules/@companion-atlas/story), the server in /app/server.
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/server/node_modules ./node_modules
COPY --from=build /app/packages/story-schema/package.json /app/packages/story-schema/package.json
COPY --from=build /app/packages/story-schema/dist /app/packages/story-schema/dist
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./
EXPOSE 8787
# No --allow-run is granted: pipeline.ts's exiftool-vendored calls are still
# stubs (see comment above), so the running server never shells out today.
# When that's wired up, scope subprocess access to the vendored binary's
# resolved path instead of widening this to -A — verified locally that
#   --allow-run="<path to node_modules/exiftool-vendored.pl/bin/exiftool>"
# is sufficient (no need to grant "perl" itself), plus --allow-sys=cpus,uid,gid
# and --allow-read covering that same path and /usr/bin/perl (see PR
# description for the full verification transcript).
CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read=.", "--allow-sys", "dist/index.js"]
