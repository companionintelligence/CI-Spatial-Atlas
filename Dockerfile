# Companion Atlas — web viewer image.
# Multi-stage: build the Vite SPA, then serve the static bundle with nginx.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Texture generation + production build. Build-time map keys are injected as
# Vite `define` constants (see vite.config.ts); pass them as --build-arg / env.
ARG CESIUM_ION_TOKEN=""
ARG GOOGLE_MAP_PLATFORM=""
ARG MAPBOX_API_KEY=""
ARG ESRI_API_KEY=""
ENV CESIUM_ION_TOKEN=$CESIUM_ION_TOKEN \
    GOOGLE_MAP_PLATFORM=$GOOGLE_MAP_PLATFORM \
    MAPBOX_API_KEY=$MAPBOX_API_KEY \
    ESRI_API_KEY=$ESRI_API_KEY
RUN npm run textures:build && npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
# SPA fallback so deep links (and ?story=… URLs) resolve to index.html.
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' \
    > /etc/nginx/conf.d/default.conf
EXPOSE 80
