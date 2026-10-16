import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 600_000, workers: 1, reporter: [['list'], ['json', { outputFile: 'qa/test-results.json' }]],
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1440, height: 900 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } },
});
