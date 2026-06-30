// ─────────────────────────────────────────────────────────────────────────
// Structured, leveled logger — the single logging primitive for the platform.
//
// Why a module instead of bare console.*:
//   • Enterprise log pipelines (Datadog, Splunk, CloudWatch, Loki) ingest JSON,
//     not free-form strings. Every line here is one JSON object with a stable
//     shape (ts, level, msg, + context) so it is queryable the moment it lands.
//   • A single LOG_LEVEL env gate means production can run at "info" while a
//     debugging session flips to "debug" with no code change.
//   • A request id threaded through `child()` lets you grep one request's full
//     lifecycle across every module it touched.
//
// It is deliberately dependency-free (works on edge + node) and never throws —
// logging must never be the thing that takes a request down.
// ─────────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  // Quiet by default in tests; informative everywhere else.
  return process.env.NODE_ENV === "test" ? "warn" : "info";
}

export type LogContext = Record<string, unknown>;

function emit(level: LogLevel, msg: string, base: LogContext, extra?: LogContext): void {
  try {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[configuredLevel()]) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...base,
      ...(extra ?? {}),
    };
    const serialized = safeStringify(line);
    // Route warn/error to stderr so platforms classify severity correctly.
    if (level === "error" || level === "warn") process.stderr.write(serialized + "\n");
    else process.stdout.write(serialized + "\n");
  } catch {
    /* logging must never throw */
  }
}

// Defensive stringify: drops circular refs and caps huge values so a stray
// object can never produce a multi-megabyte log line.
function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
    if (typeof v === "object" && v !== null) {
      if (seen.has(v as object)) return "[Circular]";
      seen.add(v as object);
    }
    if (typeof v === "string" && v.length > 2000) return v.slice(0, 2000) + "…";
    return v;
  });
}

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  /** Derive a logger that stamps every line with additional fixed context. */
  child(ctx: LogContext): Logger;
}

function make(base: LogContext): Logger {
  return {
    debug: (m, c) => emit("debug", m, base, c),
    info: (m, c) => emit("info", m, base, c),
    warn: (m, c) => emit("warn", m, base, c),
    error: (m, c) => emit("error", m, base, c),
    child: (ctx) => make({ ...base, ...ctx }),
  };
}

export const logger: Logger = make({ service: "eas-intelligence" });
