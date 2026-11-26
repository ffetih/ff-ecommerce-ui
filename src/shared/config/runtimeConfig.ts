export interface RuntimeConfig {
  oidcAuthority: string;
  oidcClientId: string;
  jaegerUrl: string;
  grafanaUrl: string;
  prometheusUrl: string;
  alertmanagerUrl: string;
  mailpitUrl: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<RuntimeConfig>;
  }
}

export const K3D_DEFAULTS: RuntimeConfig = {
  oidcAuthority: 'http://keycloak.localtest.me:8888/realms/ecommerce',
  oidcClientId: 'shop',
  jaegerUrl: 'http://jaeger.localtest.me:8888',
  grafanaUrl: 'http://grafana.localtest.me:8888',
  prometheusUrl: 'http://prometheus.localtest.me:8888',
  alertmanagerUrl: 'http://alertmanager.localtest.me:8888',
  mailpitUrl: 'http://mail.localtest.me:8888',
};

function normalizeUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function resolveValue(
  runtimeValue: string | undefined,
  envValue: string | undefined,
  fallback: string,
): string {
  if (runtimeValue !== undefined) return normalizeUrl(runtimeValue);
  if (envValue !== undefined) return normalizeUrl(envValue);
  return fallback;
}

/**
 * Resolves deployment endpoints in priority order:
 *   1. Container runtime config (`window.__APP_CONFIG__` from `/env-config.js`)
 *   2. Build/dev Vite env (`VITE_*`)
 *   3. Local k3d + Flux defaults (`*.localtest.me:8888`)
 */
export function getRuntimeConfig(): RuntimeConfig {
  const runtime = typeof window !== 'undefined' ? window.__APP_CONFIG__ : undefined;
  return {
    oidcAuthority:
      resolveValue(runtime?.oidcAuthority, import.meta.env.VITE_OIDC_AUTHORITY, K3D_DEFAULTS.oidcAuthority) ||
      K3D_DEFAULTS.oidcAuthority,
    oidcClientId:
      (runtime?.oidcClientId ?? import.meta.env.VITE_OIDC_CLIENT_ID ?? K3D_DEFAULTS.oidcClientId).trim() ||
      K3D_DEFAULTS.oidcClientId,
    jaegerUrl: resolveValue(runtime?.jaegerUrl, import.meta.env.VITE_JAEGER_URL, K3D_DEFAULTS.jaegerUrl),
    grafanaUrl: resolveValue(runtime?.grafanaUrl, import.meta.env.VITE_GRAFANA_URL, K3D_DEFAULTS.grafanaUrl),
    prometheusUrl: resolveValue(
      runtime?.prometheusUrl,
      import.meta.env.VITE_PROMETHEUS_URL,
      K3D_DEFAULTS.prometheusUrl,
    ),
    alertmanagerUrl: resolveValue(
      runtime?.alertmanagerUrl,
      import.meta.env.VITE_ALERTMANAGER_URL,
      K3D_DEFAULTS.alertmanagerUrl,
    ),
    mailpitUrl: resolveValue(runtime?.mailpitUrl, import.meta.env.VITE_MAILPIT_URL, K3D_DEFAULTS.mailpitUrl),
  };
}

export function jaegerTraceUrl(traceId: string, config = getRuntimeConfig()): string | null {
  if (!config.jaegerUrl || !traceId) return null;
  return `${config.jaegerUrl}/trace/${encodeURIComponent(traceId)}`;
}

export interface ObservabilityToolLink {
  id: string;
  label: string;
  url: string;
  description: string;
}

export function getObservabilityLinks(config = getRuntimeConfig()): ObservabilityToolLink[] {
  const candidates: Array<ObservabilityToolLink & { enabled: boolean }> = [
    {
      id: 'jaeger',
      label: 'Jaeger',
      url: config.jaegerUrl,
      description: 'Distributed traces across HTTP, outbox, and Kafka',
      enabled: Boolean(config.jaegerUrl),
    },
    {
      id: 'grafana',
      label: 'Grafana',
      url: config.grafanaUrl,
      description: 'Service health, HTTP latency, and outbox/DLT dashboard',
      enabled: Boolean(config.grafanaUrl),
    },
    {
      id: 'prometheus',
      label: 'Prometheus',
      url: config.prometheusUrl,
      description: 'Authenticated scrape targets and firing alert rules',
      enabled: Boolean(config.prometheusUrl),
    },
    {
      id: 'alertmanager',
      label: 'Alertmanager',
      url: config.alertmanagerUrl,
      description: 'Active alert routing and silences',
      enabled: Boolean(config.alertmanagerUrl),
    },
    {
      id: 'mailpit',
      label: 'Mailpit',
      url: config.mailpitUrl,
      description: 'Local inbox for delivered Alertmanager emails',
      enabled: Boolean(config.mailpitUrl),
    },
  ];
  return candidates.filter((item) => item.enabled).map(({ enabled: _ignored, ...link }) => link);
}
