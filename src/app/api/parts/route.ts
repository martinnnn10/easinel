import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { listParts, searchParts, createPart } from "@/lib/parts/repository";
import { safeHandler } from "@/lib/api/safeHandler";
import { parseBody } from "@/lib/api/validate";
import { z } from "zod";

export const runtime = "nodejs";

const CreatePartSchema = z
  .object({
    description: z.string().trim().min(1, "description is required").max(2000),
    partNumber: z.string().trim().max(200).optional().nullable(),
    manufacturer: z.string().trim().max(200).optional().nullable(),
    manufacturerPartNumber: z.string().trim().max(200).optional().nullable(),
    category: z.string().trim().max(120).optional().nullable(),
  })
  .passthrough();

// GET /api/parts?q=<search>
export const GET = safeHandler("parts.list", async (req: NextRequest) => {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const orgId = gate.user.orgId;
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const parts = q ? await searchParts(orgId, q) : await listParts(orgId);
  return NextResponse.json({ parts, query: q ?? null });
});

export const POST = safeHandler("parts.create", async (req: NextRequest) => {
  const gate = await requirePermission("manage_parts");
  if (gate instanceof NextResponse) return gate;
  const parsed = await parseBody(req, CreatePartSchema);
  if (parsed.response) return parsed.response;
  const body = parsed.data;
  const part = await createPart(
    gate.user.orgId,
    {
      description: body.description,
      partNumber: body.partNumber ?? null,
      manufacturer: body.manufacturer ?? null,
      manufacturerPartNumber: body.manufacturerPartNumber ?? null,
      category: body.category ?? null,
    },
    gate.user.email
  );
  return NextResponse.json({ part }, { status: 201 });
});
