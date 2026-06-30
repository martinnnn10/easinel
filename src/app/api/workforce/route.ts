import { NextRequest, NextResponse } from "next/server";
import {
  buildMatrix,
  buildHiringBrief,
  createTechnician,
  setSkill,
  scoreCandidate,
} from "@/lib/workforce";
import { emitEvent } from "@/lib/events";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const matrix = await buildMatrix(gate.user.orgId);
  const brief = buildHiringBrief(matrix);
  return NextResponse.json({ matrix, brief });
}

export async function POST(req: NextRequest) {
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
  if (body.action === "score_candidate") {
    const matrix = await buildMatrix(orgId);
    const match = scoreCandidate(matrix, {
      name: body.name || "Candidate",
      skills: Array.isArray(body.skills) ? body.skills : [],
    });
    return NextResponse.json({ match });
  }
  if (body.action === "push_candidate_match") {
    await emitEvent(orgId, "candidate.matched", {
      name: body.name,
      fitScore: body.fitScore,
      target: body.connectorKey ?? null,
    });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
