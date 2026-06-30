import { db, ensureDb } from "@/lib/db";
import { documents, chunks, auditLog } from "@/lib/db/schema";
import { chunkText } from "@/lib/rag/chunk";
import { emitEvent } from "@/lib/events";
import { id } from "@/lib/util";

export interface NewLesson {
  title: string;
  problem: string; // the technician's question / symptom
  resolution: string; // the Copilot answer (markdown)
  assetId?: string | null;
}

export interface LessonResult {
  documentId: string;
  filename: string;
  chunkCount: number;
}

// Save a resolved diagnosis as a "Lesson Learned" — a first-class, RETRIEVABLE
// knowledge document scoped to the asset. This is the memory loop: every repair
// the Copilot helps with becomes searchable context for the next one.
export async function saveLesson(orgId: string, input: NewLesson): Promise<LessonResult> {
  if (!orgId) throw new Error("saveLesson() requires orgId");
  await ensureDb();

  const documentId = id("doc");
  const date = new Date().toISOString().slice(0, 10);
  const cleanTitle = input.title.replace(/\s+/g, " ").trim().slice(0, 90);
  const filename = `Lesson Learned — ${cleanTitle}.md`;

  const body = [
    `# Lesson Learned — ${cleanTitle}`,
    `Captured: ${date}`,
    ``,
    `## Problem / Symptom`,
    input.problem.trim(),
    ``,
    `## Diagnosis & Resolution`,
    input.resolution.trim(),
  ].join("\n");

  // Index it for retrieval (same pipeline as uploaded documents).
  const pieces = chunkText(body);
  let ord = 0;
  for (const piece of pieces) {
    await db.insert(chunks).values({
      id: id("chk"),
      orgId,
      documentId,
      assetId: input.assetId ?? null,
      ordinal: ord++,
      content: piece,
    });
  }

  await db.insert(documents).values({
    id: documentId,
    orgId,
    assetId: input.assetId ?? null,
    filename,
    kind: "lesson",
    mimeType: "text/markdown",
    sizeBytes: body.length,
    storagePath: null,
    charCount: body.length,
  });

  await db.insert(auditLog).values({
    id: id("aud"),
    orgId,
    actor: "user",
    action: "lesson.saved",
    target: documentId,
    detail: JSON.stringify({ title: cleanTitle, assetId: input.assetId ?? null }),
  });

  await emitEvent(orgId, "document.indexed", {
    documentId,
    kind: "lesson",
    assetId: input.assetId ?? null,
  });

  return { documentId, filename, chunkCount: pieces.length };
}
