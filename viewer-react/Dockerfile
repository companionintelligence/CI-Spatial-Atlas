# Companion Atlas — viewer-react (Resium/CesiumJS + React-Three-Fiber WebXR)
# web viewer image. Multi-stage: build the Vite SPA, then serve the static
# bundle with nginx. Build context must be the REPO ROOT (`docker build -f
# viewer-react/Dockerfile .`), not viewer-react/ — this app resolves
# @companion-atlas/story via the npm workspace, so the root package.json and
# packages/story-schema must be in the build context.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
# `npm ci` fires the root `prepare` script (builds packages/story-schema), so
# that package's source must be present before `npm ci` runs.
COPY packages/story-schema/package.json packages/story-schema/tsconfig.json packages/story-schema/
COPY packages/story-schema/src packages/story-schema/src
COPY viewer-react/package.json viewer-react/
RUN npm ci
COPY . .
# Vite inlines import.meta.env.VITE_* at build time (see src/story/useStory.ts,
# src/renderers/CesiumStoryViewer.tsx). These are optional build-time
# defaults — `?memory=`/`?token=` URL params still override at runtime, so a
# single built image can point at different Companion Memory servers per load.
ARG VITE_CESIUM_ION_TOKEN=""
ARG VITE_MEMORY_URL=""
ARG VITE_MEMORY_TOKEN=""
ENV VITE_CESIUM_ION_TOKEN=$VITE_CESIUM_ION_TOKEN \
    VITE_MEMORY_URL=$VITE_MEMORY_URL \
    VITE_MEMORY_TOKEN=$VITE_MEMORY_TOKEN
RUN npm run build -w viewer-react

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/viewer-react/dist /usr/share/nginx/html
# SPA fallback so deep links (and ?story=/?memory=… URLs) resolve to index.html.
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 80
