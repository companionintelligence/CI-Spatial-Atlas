# Companion Atlas — 3D processing API + MCP server image.
# Orchestration only: heavy reconstruction runs in the GPU worker image
# (../docker/Dockerfile.worker). This container stays small and CPU-only.

FROM node:22-bookworm-slim AS build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install
COPY server/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app/server
ENV NODE_ENV=production
# ffmpeg + exiftool are used by the ingest stage to sample video frames and
# read EXIF/GPMF telemetry before handing dense work to the GPU worker.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./
EXPOSE 8787
CMD ["node", "dist/index.js"]
