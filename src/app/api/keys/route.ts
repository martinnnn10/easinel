import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/lib/db";
import { apiKeys } from "@/lib/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createApiKey } from "@/lib/apiAuth";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requirePermission("manage_api_keys");
  if (gate instanceof NextResponse) return gate;
  await ensureDb();
  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.orgId, gate.user.orgId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt));
  return NextResponse.json({ keys });
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission("manage_api_keys");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  const name = (body.name ?? "Default key").toString().slice(0, 60);
  const key = await createApiKey(gate.user.orgId, name);
  // plaintext returned exactly once
  return NextResponse.json({ key });
}

export async function DELETE(req: NextRequest) {
  const gate = await requirePermission("manage_api_keys");
  if (gate instanceof NextResponse) return gate;
  await ensureDb();
  const idParam = req.nextUrl.searchParams.get("id");
  if (!idParam) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.orgId, gate.user.orgId), eq(apiKeys.id, idParam)));
  return NextResponse.json({ ok: true });
}
