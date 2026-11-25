import { defineConfig, loadEnv, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

const stripBrowserOrigin: ProxyOptions['configure'] = (proxy) => {
  proxy.on('proxyReq', (proxyReq) => {
    proxyReq.removeHeader('origin');
    proxyReq.removeHeader('referer');
  });
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const gatewayTarget = env.VITE_GATEWAY_URL || 'http://localhost:8080';

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
