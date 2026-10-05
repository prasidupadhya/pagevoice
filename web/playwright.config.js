import { defineConfig } from "@playwright/test";
const port=Number(process.env.PAGEVOICE_TEST_PORT || 4181);
export default defineConfig({
  testDir: "./e2e",
  timeout: 600000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    actionTimeout:15000,
    navigationTimeout:30000,
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run preview -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
});
