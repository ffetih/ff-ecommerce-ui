#!/bin/sh
set -eu

escape_js() {
  printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat <<EOF > /usr/share/nginx/html/env-config.js
window.__APP_CONFIG__ = {
  oidcAuthority: "$(escape_js "${OIDC_AUTHORITY:-}")",
  oidcClientId: "$(escape_js "${OIDC_CLIENT_ID:-}")",
  jaegerUrl: "$(escape_js "${JAEGER_URL:-}")",
  grafanaUrl: "$(escape_js "${GRAFANA_URL:-}")",
  prometheusUrl: "$(escape_js "${PROMETHEUS_URL:-}")",
  alertmanagerUrl: "$(escape_js "${ALERTMANAGER_URL:-}")",
  mailpitUrl: "$(escape_js "${MAILPIT_URL:-}")"
};
EOF
