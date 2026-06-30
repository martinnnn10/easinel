import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { suggestPmFromWorkOrder } from "@/lib/pm/suggest";
import { createProgram } from "@/lib/pm/repository";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/pm/suggest  { workOrderId }
// "Should this become a PM?" — generates a GROUNDED draft PM from a closed work
// order and saves it as `draft` (awaiting human approval). Never activates.
export async function POST(req: NextRequest) {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  if (!body.workOrderId) {
    return NextResponse.json({ error: "workOrderId required" }, { status: 400 });
  }
  const suggestion = await suggestPmFromWorkOrder(body.workOrderId, gate.user.orgId);
  if (!suggestion) {
    return NextResponse.json({ error: "work order not found" }, { status: 404 });
  }
  const program = await createProgram(gate.user.orgId, suggestion, gate.user.email);
  return NextResponse.json({ program, confidence: suggestion.confidence, evidenceCount: suggestion.evidenceCount }, { status: 201 });
}
