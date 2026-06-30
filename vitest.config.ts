import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Force the in-memory DB BEFORE any module loads. Individual suites also set
    // these at the top of the file, but ESM hoists `import` above those
    // assignments, so the db module could read process.env first and fall back to
    // a persistent `file:local.db`. Setting them here (vitest applies test.env
    // before module evaluation) makes every run hermetic: no stray local.db is
    // created, and the suite is deterministic instead of depending on a fresh
    // checkout.
    env: {
      DATABASE_URL: ":memory:",
      EMBEDDINGS_DISABLED: "1",
      NODE_ENV: "test",
    },
    // Single fork so the in-memory libSQL client (a module-level singleton) is
    // shared across files within a run; fileParallelism off avoids SQLITE_BUSY.
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
  },
});
