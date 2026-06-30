import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { generatePmProgram } from "@/lib/pm/generate";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/pm/generate
// Body: { assetId?, manufacturer?, model?, serialNumber?, assetType? }
// Generates FIVE draft PM programs (30/60/90-day, semi-annual, annual) for the
// identified machine, grounded in uploaded PM docs / OEM manuals when present.
// Everything is created as a DRAFT — approval (manage_pm) is still required to
// activate scheduling. Requires manage_pm to create the drafts.
export async function POST(req: NextRequest) {
  const gate = await requirePermission("manage_pm");
  if (gate instanceof NextResponse) return gate;
  const body = await req.json().catch(() => ({}));

  const hasIdentity =
    body.assetId ||
    body.createAsset ||
    body.model ||
    body.serialNumber ||
    body.manufacturer;
  if (!hasIdentity) {
    return NextResponse.json(
      { error: "Provide an asset, or a manufacturer / model / serial number." },
      { status: 400 }
    );
  }

  try {
    const result = await generatePmProgram(
      gate.user.orgId,
      {
        assetId: body.assetId ?? null,
        createAsset: body.createAsset ?? null,
        manufacturer: body.manufacturer ?? null,
        model: body.model ?? null,
        serialNumber: body.serialNumber ?? null,
        assetType: body.assetType ?? null,
      },
      gate.user.email
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "generation failed" },
      { status: 400 }
    );
  }
}
