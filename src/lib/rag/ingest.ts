import { db, ensureDb } from "@/lib/db";
import { documents, chunks, auditLog } from "@/lib/db/schema";
import { chunkText } from "./chunk";
import { extractDocument, classifyKind, isImage, isDrawingName, type ExtractStatus } from "./extract";
import { putObject } from "@/lib/storage";
import { id } from "@/lib/util";
import { parsePlcBuffer, savePlcProject, plcSummaryText } from "@/lib/plc/store";
import { getEmbeddingProvider } from "@/lib/embeddings";

// Persist a list of chunk texts WITH embeddings. Embeddings are computed via the
// provider abstraction: the keyword-fallback today, real semantic vectors the
// moment an embedding key is configured (no code change). Embedding failure is
// non-fatal — chunks still store and lexical retrieval still works.
async function insertChunksWithEmbeddings(
  orgId: string,
  documentId: string,
  assetId: string | null,
  pieces: string[]
): Promise<void> {
  let vectors: (number[] | null)[] = pieces.map(() => null);
  try {
    const provider = getEmbeddingProvider();
    const results = await provider.embedBatch(pieces);
    vectors = results.map((r) => r.vector);
  } catch (err) {
    console.error("[ingest] embedding failed (storing chunks without vectors):", (err as Error).message);
  }
  let ord = 0;
  for (let i = 0; i < pieces.length; i++) {
    await db.insert(chunks).values({
      id: id("chk"),
      orgId,
      documentId,
      assetId,
      ordinal: ord++,
      content: pieces[i],
      embedding: vectors[i] ? JSON.stringify(vectors[i]) : null,
    });
  }
}

export interface IngestResult {
  documentId: string;
  filename: string;
  kind: string;
  chunkCount: number;
  charCount: number;
  indexed: boolean;
  /** Honest extraction status surfaced to the user. */
  status: ExtractStatus | "image" | "plc";
  /** Human-readable explanation when the file was not fully indexed. */
  message?: string;
  /** Set when the file was parsed as a PLC project (.l5x/.acd). */
  plcProjectId?: string;
  plcFidelity?: string;
  /** True when the uploaded file looks like an engineering drawing/schematic. */
  isSchematic?: boolean;
  /**
   * For schematics specifically: whether the drawing was actually loaded into
   * the workspace at all (always true once stored) and whether its TEXT was
   * made searchable by the Copilot (false for image-only/scanned drawings,
   * which are still analyzed visually on demand).
   */
  schematicConfirmation?: string;
}

function isPlcFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return ["l5x", "acd"].includes(ext);
}

export async function ingestFile(
  orgId: string,
  file: { name: string; type?: string; buffer: Buffer },
  opts: { assetId?: string | null } = {}
): Promise<IngestResult> {
  if (!orgId) throw new Error("ingestFile() requires orgId");
  await ensureDb();

  const documentId = id("doc");
  const kind = classifyKind(file.name, file.type);
  const storagePath = await putObject(
    `${documentId}__${sanitize(file.name)}`,
    file.buffer,
    file.type
  );

  let charCount = 0;
  let chunkCount = 0;
  let indexed = false;
  let status: IngestResult["status"] = "unsupported";
  let message: string | undefined;
  let plcProjectId: string | undefined;
  let plcFidelity: string | undefined;
  let extractMethod: "text_layer" | "ocr" | undefined;

  // ── PLC files (.l5x/.acd): parse into the structured IR for the Explorer,
  // and index a compact human-readable summary for RAG (instead of dumping
  // raw XML bytes, which is noisy and unhelpful to the Copilot). ──
  if (isPlcFile(file.name)) {
    try {
      const ir = parsePlcBuffer(file.buffer, file.name);
      plcProjectId = await savePlcProject(orgId, {
        documentId,
        assetId: opts.assetId ?? null,
        filename: file.name,
        ir,
      });
      plcFidelity = ir.fidelity;
      const summary = plcSummaryText(ir, file.name);
      charCount = summary.length;
      const pieces = chunkText(summary);
      await insertChunksWithEmbeddings(orgId, documentId, opts.assetId ?? null, pieces);
      chunkCount = pieces.length;
      indexed = chunkCount > 0;
      status = "plc";
      if (plcFidelity && plcFidelity !== "full") {
        message = `Indexed a structural summary of "${file.name}". For full logic search, export the .L5X (XML) from Studio 5000 and upload that.`;
      }
    } catch (err) {
      // Never fail the whole upload because of a parse problem.
      console.error("[ingest] PLC parse failed:", (err as Error).message);
      status = "error";
      message = `Could not parse "${file.name}" as a PLC project: ${(err as Error).message}`;
    }
  } else if (isImage(file.name, file.type)) {
    // Images are stored (and passed to vision in chat) but not text-indexed here.
    status = "image";
    message = `"${file.name}" was attached as an image. Ask a question about it and the Copilot will analyze it visually.`;
  } else {
    const result = await extractDocument(file.buffer, file.name, file.type);
    status = result.status;
    message = result.detail;
    charCount = result.text.length;
    extractMethod = result.method;
    if (result.status === "extracted" && result.text.trim()) {
      const pieces = chunkText(result.text);
      await insertChunksWithEmbeddings(orgId, documentId, opts.assetId ?? null, pieces);
      chunkCount = pieces.length;
      indexed = chunkCount > 0;
    }
  }

  // ── Explicit schematic / drawing load confirmation ──────────────────────
  // The user wants to know, unambiguously, whether a schematic actually loaded.
  // A drawing is always STORED once we reach here; what differs is whether its
  // TEXT is searchable (text PDF / DXF) or it is image-only (scanned PDF / image
  // file), in which case it is analyzed visually rather than text-indexed.
  const isSchematic = isDrawingName(file.name, file.type);
  let schematicConfirmation: string | undefined;
  if (isSchematic) {
    if (status === "image") {
      schematicConfirmation = `Schematic "${file.name}" loaded as an image. It is stored and the Copilot will read it visually when you ask about it, but its text is NOT indexed for keyword search. For full searchable text, upload a text-based PDF or the CAD/DXF export.`;
    } else if (indexed) {
      schematicConfirmation =
        extractMethod === "ocr"
          ? `Schematic "${file.name}" loaded and indexed via OCR — it was a scanned/image drawing, so its text was recovered by optical character recognition and is now searchable (accuracy depends on scan quality).`
          : `Schematic "${file.name}" loaded and indexed — its text is searchable and the Copilot can cite it.`;
    } else if (status === "binary_unsupported") {
      schematicConfirmation = `Schematic "${file.name}" was stored, but it appears to be a scanned/image-only file with no embedded text, so it could not be indexed for search. Upload a text-based or OCR'd version to make it searchable.`;
    } else {
      schematicConfirmation = `Schematic "${file.name}" was stored, but its text could NOT be extracted (${status}), so it is not searchable. ${message ?? ""}`.trim();
    }
  }

  await db.insert(documents).values({
    id: documentId,
    orgId,
    assetId: opts.assetId ?? null,
    filename: file.name,
    kind,
    mimeType: file.type ?? null,
    sizeBytes: file.buffer.length,
    storagePath,
    charCount,
  });

  await db.insert(auditLog).values({
    id: id("aud"),
    orgId,
    actor: "user",
    action: "document.ingest",
    target: documentId,
    detail: JSON.stringify({ filename: file.name, kind, chunkCount, status }),
  });

  return {
    documentId,
    filename: file.name,
    kind,
    chunkCount,
    charCount,
    indexed,
    status,
    message,
    plcProjectId,
    plcFidelity,
    isSchematic,
    schematicConfirmation,
  };
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}
