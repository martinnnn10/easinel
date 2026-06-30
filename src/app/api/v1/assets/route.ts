import { NextRequest, NextResponse } from "next/server";
import { withApiKey } from "@/lib/apiAuth";
import { listAssets, createAsset } from "@/lib/assets/repository";

export const runtime = "nodejs";

export const GET = withApiKey(async (_req: NextRequest, orgId: string) => {
  const assets = await listAssets(orgId);
  return NextResponse.json({ assets });
});

export const POST = withApiKey(async (req: NextRequest, orgId: string) => {
  const body = await req.json().catch(() => ({}));
  if (!body.name) {
    return NextResponse.json(
      { error: "bad_request", message: "`name` is required." },
      { status: 400 }
    );
  }
  // The repository owns asset.created (event + audit), so no manual emit here.
  const asset = await createAsset(orgId, body, "api");
  return NextResponse.json({ asset }, { status: 201 });
});
