import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const stripBrowserOrigin: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.removeHeader('origin');
    proxyReq.removeHeader('referer');
  });
};

// Keycloak's `shop` client registers http://localhost:5173/* (not 127.0.0.1:5173).
const redirectLoopbackIpToLocalhost: Plugin = {
  name: 'redirect-loopback-ip-to-localhost',
  configureServer(server) {
    server.middlewares.use((rawReq, rawRes, next) => {
      const req = rawReq as unknown as {
        headers?: Record<string, string | string[] | undefined>;
        url?: string;
      };
      const res = rawRes as unknown as {
        statusCode: number;
        setHeader: (name: string, value: string) => void;
        end: () => void;
      };
      const host = typeof req.headers?.host === 'string' ? req.headers.host : '';
      const url = req.url ?? '/';
      if (host.startsWith('127.0.0.1:') && !url.startsWith('/api')) {
        const port = host.slice('127.0.0.1:'.length);
        res.statusCode = 302;
        res.setHeader('Location', `http://localhost:${port}${url}`);
        res.end();
        return;
      }
      next();
    });
  },
};

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const gatewayTarget = env.VITE_GATEWAY_URL || 'http://shop.localtest.me:8888';

  // Scope IPv4 lookup strictly to the /api proxy agent (never global dns.setDefaultResultOrder,
  // which makes Vite advertise http://127.0.0.1:5173 instead of http://localhost:5173).
  const httpMod = 'node:http';
  const dnsMod = 'node:dns';
  const http = (await import(/* @vite-ignore */ httpMod)) as {
    Agent: new (options: Record<string, unknown>) => unknown;
  };
  const dns = (await import(/* @vite-ignore */ dnsMod)) as {
    lookup: (hostname: string, options: Record<string, unknown>, callback: unknown) => void;
  };
  const ipv4ProxyAgent = gatewayTarget.startsWith('http://')
    ? new http.Agent({
        keepAlive: true,
        lookup: (hostname: string, options: Record<string, unknown>, cb: unknown) =>
          dns.lookup(hostname, { ...options, family: 4 }, cb),
      })
    : undefined;

  return {
    plugins: [react(), redirectLoopbackIpToLocalhost],
    server: {
      host: 'localhost',
      port: 5173,
      strictPort: true,
      proxy: {
        // Same-origin proxy to the routing-only gateway (no CORS config needed on gateway).
        '/api': {
          target: gatewayTarget,
          changeOrigin: true,
          ...(ipv4ProxyAgent ? { agent: ipv4ProxyAgent as never } : {}),
          configure: stripBrowserOrigin,
        },
      },
    },
  };
});
