import { defineConfig } from "@playwright/test";
const port = Number(process.env.PAGEVOICE_TEST_PORT || 4181);
// Test-only override: the static frontend itself needs no environment variables.
const publicURL = process.env.PAGEVOICE_TEST_BASE_URL;
export default defineConfig({
  testDir: "./e2e",
  timeout: 600000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    actionTimeout: 15000,
    navigationTimeout: 30000,
    baseURL: publicURL || `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    trace: "retain-on-failure",
  },
  webServer: publicURL
    ? undefined
    : {
        command: `npm run preview -- --port ${port}`,
        url: `http://127.0.0.1:${port}`,
        reuseExistingServer: false,
        timeout: 30000,
      },
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
});
