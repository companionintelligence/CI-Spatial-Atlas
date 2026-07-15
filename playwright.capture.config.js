import { defineConfig, devices } from '@playwright/test';

// Demo capture: screenshots + a flythrough video of the offline (?static=1&imagery=local)
// classic renderer. Software WebGL (SwiftShader) so the globe renders headless.
export default defineConfig({
  testDir: './tests/demo',
  testMatch: '**/*.capture.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  outputDir: './capture/results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    video: { mode: 'on', size: { width: 1440, height: 900 } },
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--enable-webgl',
      ],
    },
  },
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run vibe:dev',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
