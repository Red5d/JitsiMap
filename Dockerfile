# JitsiMap app image (SPEC §12.2).
# Stage 1: pinned Node build. lib-jitsi-meet + strophe.js are vendored
# tarballs (vendor/*.tgz, pinned versions + sha256 in docs/lib-surface.md).

FROM node:22.20.0-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY vendor/ ./vendor/
RUN npm ci --no-audit --no-fund

COPY index.html tsconfig.json vite.config.ts ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

# Stage 2: pinned nginx, unprivileged on 8080, runtime config at start.
FROM nginx:1.27.5-alpine

COPY docker/nginx.conf.template /opt/jitsimap/nginx.conf.template
COPY docker/render-config.sh /opt/jitsimap/render-config.sh
COPY docker/entrypoint.sh /opt/jitsimap/entrypoint.sh
COPY public/config.template.json /opt/jitsimap/config.template.json
COPY --from=build /app/dist/ /usr/share/nginx/html/

RUN chmod +x /opt/jitsimap/entrypoint.sh /opt/jitsimap/render-config.sh \
    && rm -f /etc/nginx/conf.d/default.conf

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:8080/healthz | grep -q ok || exit 1

ENTRYPOINT ["/opt/jitsimap/entrypoint.sh"]
