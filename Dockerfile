# Multi-stage container image for ff-ecommerce-ui (s11/s12).
# Serves the static SPA and proxies /api/* same-origin to the gateway without CORS.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine

ENV GATEWAY_URL=http://gateway:8080 \
    OIDC_AUTHORITY=http://keycloak.localtest.me:8888/realms/ecommerce \
    OIDC_CLIENT_ID=shop \
    JAEGER_URL=http://jaeger.localtest.me:8888 \
    GRAFANA_URL=http://grafana.localtest.me:8888 \
    PROMETHEUS_URL=http://prometheus.localtest.me:8888 \
    ALERTMANAGER_URL=http://alertmanager.localtest.me:8888 \
    MAILPIT_URL=http://mail.localtest.me:8888

COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker/30-runtime-env.sh /docker-entrypoint.d/30-runtime-env.sh
COPY --from=build /app/dist /usr/share/nginx/html

USER root
RUN chmod +x /docker-entrypoint.d/30-runtime-env.sh \
    && chown 101:101 /usr/share/nginx/html/env-config.js
USER 101

EXPOSE 8080
