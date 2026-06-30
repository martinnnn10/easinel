import { NextResponse } from "next/server";
import { getCurrentUser, authRequired } from "./session";
import { can, type Permission, type Role } from "./roles";
import { isReservedOrg } from "@/lib/util";
import type { User } from "@/lib/db/schema";

export interface AuthResult {
  user: User;
}

// Use at the top of a protected route handler:
//   const gate = await requirePermission("manage_users");
//   if (gate instanceof NextResponse) return gate;
//   const { user } = gate;
export async function requirePermission(
  perm: Permission
): Promise<AuthResult | NextResponse> {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "unauthenticated", message: "Sign in required." },
      { status: 401 }
    );
  }

  // ── Hard tenant boundary ──────────────────────────────────────────────────
  // The Demo Organization (and the global knowledge scope) are reserved, fully
  // separate tenants. A REAL authenticated session must NEVER resolve to one of
  // them — doing so would mean a customer is operating inside demo/system data.
  // The ONLY legitimate reserved-org actor is the open-mode synthetic owner
  // (id "open-mode"), which is how the public, no-auth live demo runs.
  if (isReservedOrg(user.orgId)) {
    const isOpenModeSynthetic = !authRequired() && user.id === "open-mode";
    if (!isOpenModeSynthetic) {
      return NextResponse.json(
        {
          error: "forbidden",
          message: "This session is not permitted to access reserved tenant data.",
        },
        { status: 403 }
      );
    }
  }

  if (!can(user.role as Role, perm)) {
    return NextResponse.json(
      {
        error: "forbidden",
        message: `Your role (${user.role}) lacks the '${perm}' permission.`,
      },
      { status: 403 }
    );
  }
  return { user };
}
