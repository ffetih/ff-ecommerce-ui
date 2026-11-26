import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const stripBrowserOrigin: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.removeHeader('origin');
    proxyReq.removeHeader('referer');
  });
};

export default defineConfig(async ({ mode }) => {
  // *.localtest.me returns both AAAA (::1) and A (127.0.0.1); k3d on WSL2 publishes on IPv4.
  const dnsModule = 'node:dns';
  const dns = (await import(/* @vite-ignore */ dnsModule)) as {
    setDefaultResultOrder?: (order: 'ipv4first' | 'verbatim') => void;
  };
  dns.setDefaultResultOrder?.('ipv4first');

  const env = loadEnv(mode, '.', '');
  const gatewayTarget = env.VITE_GATEWAY_URL || 'http://shop.localtest.me:8888';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        // Same-origin proxy to the routing-only gateway (no CORS config needed on gateway).
        '/api': {
          target: gatewayTarget,
          changeOrigin: true,
          configure: stripBrowserOrigin,
        },
      },
    },
  };
});
