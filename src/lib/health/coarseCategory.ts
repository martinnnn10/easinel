// Coarse category for an error string. The /health endpoint is UNAUTHENTICATED,
// so it must never expose raw provider/DB error text, secrets, env paths,
// DATABASE_URL, or stack traces. Raw detail is logged server-side only; the
// public body carries only this bucket. Kept in its own module (not the route
// file) because Next.js route modules may only export route handlers.
export type ProviderErrorCategory = "auth" | "rate_limit" | "upstream" | "down";

export function coarseCategory(
  msg: string | null | undefined
): ProviderErrorCategory | null {
  if (!msg) return null;
  const m = msg.toLowerCase();
  if (/401|403|unauthor|forbidden|api key|invalid.*key|authenticat|credential/.test(m)) return "auth";
  if (/429|rate.?limit|quota|too many/.test(m)) return "rate_limit";
  if (/timeout|etimedout|econnreset|enotfound|network|fetch failed|socket|dns|upstream|503|502/.test(m)) return "upstream";
  return "down";
}
