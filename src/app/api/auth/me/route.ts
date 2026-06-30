import { NextResponse } from "next/server";
import { getCurrentUser, authRequired, countAllRealUsers, getOrg } from "@/lib/auth/session";
import { oidcConfigured } from "@/lib/auth/oidc";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const GET = safeHandler("auth.me", async () => {
  const user = await getCurrentUser();
  const hasUsers = (await countAllRealUsers()) > 0;
  const org = user ? await getOrg(user.orgId) : null;
  const workspaceMode = process.env.OPEN_MODE_ORG === "production" ? "production" : "demo";
  return NextResponse.json({
    authRequired: authRequired(),
    workspaceMode,
    oidc: oidcConfigured(),
    hasUsers,
    org: org ?? (user ? { id: user.orgId, name: "Workspace" } : null),
    user: user
      ? { id: user.id, name: user.name, email: user.email, role: user.role }
      : null,
  });
});
