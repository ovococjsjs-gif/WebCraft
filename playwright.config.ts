import { defineConfig } from '@playwright/test';

// Use Playwright's standard cache for BOTH installation and execution; honour an explicit env override.
export default defineConfig({
  testDir: 'tests/browser',
  // The suite renders through software WebGL on a shared machine: a test that boots a world,
  // places blocks and reloads it can take a few times longer than on a workstation.
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1024, height: 768 },
    launchOptions: {
      args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['json', { outputFile: '.cache/browser-results.json' }]],
  forbidOnly: !!process.env.CI,
  outputDir: '.cache/playwright-results',
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
