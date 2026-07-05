import { NextRequest, NextResponse } from "next/server";
import { buildMatrix, createTechnician, setSkill } from "@/lib/workforce";
import { requirePermission } from "@/lib/auth/guard";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";

// Team Skills API — the technician skills matrix (coverage + key-person risk)
// used for cross-training and safe work assignment. Recruiting features
// (candidate scoring, hiring briefs, ATS push) are NOT part of the product.
export const GET = safeHandler("workforce.get", async () => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const matrix = await buildMatrix(gate.user.orgId);
  return NextResponse.json({ matrix });
});

export const POST = safeHandler("workforce.post", async (req: NextRequest) => {
  const gate = await requirePermission("manage_workforce");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const body = await req.json().catch(() => ({}));
  if (body.action === "add_technician") {
    if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const tech = await createTechnician(orgId, {
      name: body.name,
      role: body.role,
      level: body.level,
      email: body.email,
    });
    return NextResponse.json({ technician: tech }, { status: 201 });
  }
  if (body.action === "set_skill") {
    await setSkill(orgId, body.technicianId, body.skillId, Number(body.proficiency) || 0);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
});
