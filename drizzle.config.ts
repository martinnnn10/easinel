import type { Config } from "drizzle-kit";

// Note: the app auto-creates tables on boot (see src/lib/db/index.ts).
// drizzle-kit is only needed for `db:studio` / generating migrations.
export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: (process.env.DATABASE_URL ?? "file:local.db").replace(/^file:/, ""),
  },
} satisfies Config;
