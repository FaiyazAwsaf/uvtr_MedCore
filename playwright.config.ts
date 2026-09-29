import { defineConfig, devices } from "@playwright/test"

// Parallel agents each run e2e on their own port: E2E_PORT=3317 bun run e2e
const PORT = Number(process.env.E2E_PORT ?? 3100)

/** E2E smoke tests run against a production build (Chromium only). */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  // Launcher setups run many engine commits; on a 7.8 GB machine six
  // parallel browsers made some slower than the default 5 s waits.
  expect: { timeout: 10_000 },
  workers: 3,
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
    // Only reuse a server this run started on its own port.
    reuseExistingServer: !process.env.E2E_PORT,
    timeout: 240_000,
  },
})
