import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Several suites point DATABASE_URL at an in-memory libSQL DB. Each file must
    // own its own process so the singleton db client (and the :memory: DB) is not
    // shared across files — otherwise parallel files collide with SQLITE_BUSY.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
  },
});
