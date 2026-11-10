import { defineConfig, devices } from '@playwright/test';
import { OPERATOR_KEY, FAUCET_KEY, secretJson } from './e2e/keys';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // WebKit's trace screencast slows every action by about a second, so it's off there.
    { name: 'webkit', use: { ...devices['Desktop Safari'], trace: 'off' } },
  ],
  webServer: {
    command: `pnpm exec tsx e2e/prepare-db.ts && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/stats`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      DATABASE_URL: 'postgres://uproar@127.0.0.1:54329/uproar_e2e',
      RPC_URLS: 'http://127.0.0.1:8899',
      NEXT_PUBLIC_CLUSTER: 'localnet',
      NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
      CRON_SECRET: 'e2e-cron-secret',
      ADMIN_SESSION_SECRET: 'e2e-admin-secret-with-enough-length-to-be-realistic',
      ADMIN_WALLETS: OPERATOR_KEY.address,
      FAUCET_SECRET: secretJson(FAUCET_KEY),
      DEFAULT_COUNTRY: 'US',
    },
  },
});
