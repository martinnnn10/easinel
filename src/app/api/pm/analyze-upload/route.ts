import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { analyzePmUpload } from "@/lib/pm/analyzeUpload";
import { safeHandler } from "@/lib/api/safeHandler";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/pm/analyze-upload  (multipart/form-data, field "file")
// Detect-only: reads an uploaded PM/manual doc, detects the machine identity +
// cadence hints, and returns a proposed asset resolution for the user to CONFIRM.
// Saves NOTHING. The confirmed identity is then sent to /api/pm/generate.
export const POST = safeHandler("pm.analyze-upload", async (req: NextRequest) => {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a file." }, { status: 400 });
  }
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const f = file as File;
  const buffer = Buffer.from(await f.arrayBuffer());

  try {
    const result = await analyzePmUpload(gate.user.orgId, buffer, f.name, f.type || undefined);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message || "analysis failed" }, { status: 400 });
  }
});
