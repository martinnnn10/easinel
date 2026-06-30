import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { listPrograms, listDue, createProgram } from "@/lib/pm/repository";

export const runtime = "nodejs";

// GET /api/pm?status=draft|active|archived&due=1
export async function GET(req: NextRequest) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const status = req.nextUrl.searchParams.get("status") || undefined;
  const due = req.nextUrl.searchParams.get("due");
  const programs = due ? await listDue(orgId) : await listPrograms(orgId, status);
  return NextResponse.json({ programs });
}

// POST /api/pm — create a manual draft PM (still requires approval to activate).
export async function POST(req: NextRequest) {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));
  if (!body.title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  const program = await createProgram(
    gate.user.orgId,
    {
      title: body.title,
      assetId: body.assetId ?? null,
      failureMode: body.failureMode ?? null,
      frequencyLabel: body.frequencyLabel ?? null,
      intervalDays: body.intervalDays ?? 90,
      estLaborMins: body.estLaborMins ?? null,
      tools: body.tools,
      parts: body.parts,
      safety: body.safety,
      tasks: body.tasks,
      source: "manual",
    },
    gate.user.email
  );
  return NextResponse.json({ program }, { status: 201 });
}
