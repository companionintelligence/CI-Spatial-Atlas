# Companion Atlas — 3D processing API + MCP server image.
# Orchestration only: heavy reconstruction runs in the GPU worker image
# (../docker/Dockerfile.worker). This container stays small and CPU-only.

FROM denoland/deno:debian-2.9.5 AS build
WORKDIR /app

# server/src depends on the shared Story schema package (packages/story-schema,
# published as @companion-atlas/story). In local/CI dev this resolves via the
# root npm workspace's hoisted node_modules symlink, which also silently
# papered over the fact that server/package.json never actually declared the
# dependency — this Dockerfile builds server/ in isolation (deliberately,
# to avoid resolving the rest of the monorepo — see the `deno install`
# comment below) and previously failed outright with "Cannot find module
# '@companion-atlas/story'" on both `npm run build` and `deno task build`
# (verified against the prior node:22-bookworm-slim image, same error).
# Fixed by declaring the dependency explicitly (server/package.json) as a
# relative `file:` link and building the schema package first, right here.
COPY packages/story-schema/package.json packages/story-schema/deno.json packages/story-schema/tsconfig.json packages/story-schema/
COPY packages/story-schema/src packages/story-schema/src
WORKDIR /app/packages/story-schema
RUN deno install && deno task build

WORKDIR /app/server
# Only server's own manifests + the (now-built) story-schema sibling are in
# the build context — the rest of the npm/Deno workspace (viewer-react, the
# root viewer) is never copied in. That matters: Deno's npm-workspace
# resolution re-validates every workspace member's package.json on each
# `deno task` call, and viewer-react's @companionintelligence/tokens
# dependency lives on a private GitHub Packages registry (see
# viewer-react/.npmrc) this image has no reason to need credentials for.
COPY server/package.json server/package-lock.json server/deno.json ./
RUN deno install
COPY server/ ./
RUN deno task build

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
COPY --from=build /app/packages/story-schema /app/packages/story-schema
COPY --from=build /app/server/node_modules ./node_modules
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
