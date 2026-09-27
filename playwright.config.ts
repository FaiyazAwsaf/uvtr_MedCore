import { defineConfig, devices } from "@playwright/test"

const PORT = 3100

/** E2E smoke tests run against a production build (Chromium only). */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 960, height: 600 },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 960, height: 600 },
      },
    },
  ],
  webServer: {
    command: `bun run build && bunx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 240_000,
  },
})
