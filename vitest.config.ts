import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", ".claude/**"],
    setupFiles: ["tests/setup.ts"],
    // Each file seeds its own database; on this 7.8 GB machine the default
    // (one worker per core) runs out of memory and times out while parallel
    // agents and the editor are open. Four workers finish in about 20 s.
    maxWorkers: 4,
  },
})
