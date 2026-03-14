import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  timeout: 30_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02
    }
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      args: ['--use-angle=metal']
    },
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'npm run vibe:dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 } }
    }
  ]
});
