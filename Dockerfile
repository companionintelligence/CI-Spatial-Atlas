# Companion Atlas — web viewer image.
# Multi-stage: build the Vite SPA, then serve the static bundle with nginx.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Production build. Build-time map keys are injected as Vite `define`
# constants (see vite.config.ts); pass them as --build-arg / env.
#
# NOTE: `npm run textures:build` is deliberately NOT run here. It shells out to
# ImageMagick (`magick`), which is not present in node:22-alpine, so including
# it made this image impossible to build (the failure mode that left
# ghcr.io/companionintelligence/companion-atlas-viewer unpublished). The
# generated textures under public/textures/ are committed to the repo, so the
# build does not need to regenerate them; run `npm run textures:build` locally
# and commit the result when the source material in materials/ changes.
ARG CESIUM_ION_TOKEN=""
ARG GOOGLE_MAP_PLATFORM=""
ARG MAPBOX_API_KEY=""
ARG ESRI_API_KEY=""
ENV CESIUM_ION_TOKEN=$CESIUM_ION_TOKEN \
    GOOGLE_MAP_PLATFORM=$GOOGLE_MAP_PLATFORM \
    MAPBOX_API_KEY=$MAPBOX_API_KEY \
    ESRI_API_KEY=$ESRI_API_KEY
RUN npm run cesium:assets && npm run build

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
