import { defineConfig, devices } from '@playwright/test';

declare const process: { env: Record<string, string | undefined> };

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const isCi = Boolean(process.env.CI);

export default defineConfig({
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'ui',
      testDir: './e2e/ui',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'live',
      testDir: './e2e/live',
      fullyParallel: false,
      timeout: 60_000,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !isCi,
    timeout: 60_000,
  },
});
