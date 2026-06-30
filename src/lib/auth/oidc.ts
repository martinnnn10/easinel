// Generic OIDC (OpenID Connect) SSO via the authorization-code flow. Works with
// any compliant IdP — Okta, Auth0, Microsoft Entra ID, Google Workspace,
// PingFederate — configured purely through env vars:
//
//   OIDC_ISSUER          e.g. https://login.example.com (or full /.well-known host)
//   OIDC_CLIENT_ID
//   OIDC_CLIENT_SECRET
//   OIDC_DEFAULT_ROLE    role assigned to first-time SSO users (default: technician)
//   APP_BASE_URL         used to build the redirect URI (else derived from request)
//
// SAML can be added behind the same login UI later; OIDC covers the majority of
// modern enterprise IdPs.

import type { Role } from "./roles";

export function oidcConfigured(): boolean {
  return Boolean(
    process.env.OIDC_ISSUER &&
      process.env.OIDC_CLIENT_ID &&
      process.env.OIDC_CLIENT_SECRET
  );
}

export function oidcDefaultRole(): Role {
  const r = process.env.OIDC_DEFAULT_ROLE as Role | undefined;
  return r ?? "technician";
}

interface OidcMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

let cached: OidcMetadata | null = null;

export async function discover(): Promise<OidcMetadata> {
  if (cached) return cached;
  const issuer = process.env.OIDC_ISSUER!.replace(/\/$/, "");
  const url = issuer.includes(".well-known")
    ? issuer
    : `${issuer}/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
  cached = (await res.json()) as OidcMetadata;
  return cached;
}

export function redirectUri(origin: string): string {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? origin;
  return `${base}/api/auth/oidc/callback`;
}

export async function buildAuthUrl(state: string, origin: string): Promise<string> {
  const meta = await discover();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.OIDC_CLIENT_ID!,
    redirect_uri: redirectUri(origin),
    scope: "openid email profile",
    state,
  });
  return `${meta.authorization_endpoint}?${params.toString()}`;
}

export async function exchangeCode(
  code: string,
  origin: string
): Promise<{ access_token: string; id_token?: string }> {
  const meta = await discover();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin),
    client_id: process.env.OIDC_CLIENT_ID!,
    client_secret: process.env.OIDC_CLIENT_SECRET!,
  });
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OIDC token exchange failed: ${res.status}`);
  return res.json();
}

export async function fetchUserInfo(
  accessToken: string
): Promise<{ email: string; name: string; sub: string }> {
  const meta = await discover();
  const res = await fetch(meta.userinfo_endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`OIDC userinfo failed: ${res.status}`);
  const info = (await res.json()) as {
    email?: string;
    name?: string;
    preferred_username?: string;
    sub: string;
  };
  return {
    email: info.email ?? info.preferred_username ?? `${info.sub}@sso`,
    name: info.name ?? info.preferred_username ?? info.email ?? "SSO User",
    sub: info.sub,
  };
}
