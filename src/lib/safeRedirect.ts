// Resolve a post-login `next` target to a SAFE same-origin path, closing the
// open-redirect class of bugs. A prefix check like startsWith("/") &&
// !startsWith("//") is not enough — browsers normalize backslashes, so "/\evil"
// resolves to a cross-origin "//evil". The only robust test is to resolve the
// candidate against the real origin and confirm the origin is unchanged, then
// return just the path+query+hash (never a full URL).
export function resolveSafeNext(raw: string | null | undefined, origin: string): string {
  const candidate = raw && raw.trim() ? raw.trim() : "/today";
  try {
    const u = new URL(candidate, origin);
    if (u.origin === origin) return u.pathname + u.search + u.hash;
  } catch {
    /* malformed — fall through to the safe default */
  }
  return "/today";
}
