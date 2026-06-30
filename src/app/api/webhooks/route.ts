import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/lib/db";
import { webhooks } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { id } from "@/lib/util";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

export const GET = safeHandler("webhooks.get", async () => {
  const gate = await requirePermission("manage_webhooks");
  if (gate instanceof NextResponse) return gate;
  await ensureDb();
  const hooks = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.orgId, gate.user.orgId))
    .orderBy(desc(webhooks.createdAt));
  return NextResponse.json({ webhooks: hooks });
});

export const POST = safeHandler("webhooks.post", async (req: NextRequest) => {
  const gate = await requirePermission("manage_webhooks");
  if (gate instanceof NextResponse) return gate;
  await ensureDb();
  const body = await req.json().catch(() => ({}));
  if (!body.url || !/^https?:\/\//.test(body.url)) {
    return NextResponse.json({ error: "valid url required" }, { status: 400 });
  }
  const hookId = id("wh");
  const secret = "whsec_" + randomBytes(18).toString("base64url");
  await db.insert(webhooks).values({
    id: hookId,
    orgId: gate.user.orgId,
    url: body.url,
    events: body.events || "*",
    secret,
    active: true,
  });
  return NextResponse.json({
    webhook: { id: hookId, url: body.url, events: body.events || "*", secret },
  });
});

export const DELETE = safeHandler("webhooks.delete", async (req: NextRequest) => {
  const gate = await requirePermission("manage_webhooks");
  if (gate instanceof NextResponse) return gate;
  await ensureDb();
  const idParam = req.nextUrl.searchParams.get("id");
  if (!idParam) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.delete(webhooks).where(and(eq(webhooks.orgId, gate.user.orgId), eq(webhooks.id, idParam)));
  return NextResponse.json({ ok: true });
});
