import { NextRequest, NextResponse } from "next/server";
import { db, ensureDb } from "@/lib/db";
import { assetPhotos } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getObject } from "@/lib/storage";
import { requirePermission } from "@/lib/auth/guard";

export const runtime = "nodejs";

// Stream a stored asset photo. Kept behind the same org/view gate so photos are
// not world-readable. Storage backend (local disk or S3) is resolved by the
// storage abstraction, so this works in ephemeral hosting too.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const gate = await requirePermission("view");
  if (gate instanceof NextResponse) return gate;
  const { id: assetId, photoId } = await params;
  await ensureDb();
  const rows = await db
    .select()
    .from(assetPhotos)
    .where(
      and(
        eq(assetPhotos.orgId, gate.user.orgId),
        eq(assetPhotos.id, photoId),
        eq(assetPhotos.assetId, assetId)
      )
    );
  const photo = rows[0];
  if (!photo) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  try {
    const bytes = await getObject(photo.storagePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": photo.mimeType || "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("photo serve failed", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
