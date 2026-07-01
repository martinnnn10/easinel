// Conversation / session / document read-model helpers for the Copilot.
//
// Asset CRUD lives in @/lib/assets/repository (the single source of truth);
// work-order data lives in @/lib/workorders/repository. This module covers the
// chat-side reads (sessions, messages, documents) that have no dedicated
// repository yet — see "remaining tech debt" in the cleanup notes.
//
// Tenancy: every function REQUIRES orgId as its first parameter. Crucially,
// conversation/message access is filtered by orgId so a conversation ID alone
// can NEVER reach another org's messages (closed cross-tenant read risk).
import { db, ensureDb } from "@/lib/db";
import { assets, documents, chunks, conversations, messages } from "@/lib/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { id } from "@/lib/util";

export interface SessionSummary {
  id: string;
  title: string;
  assetId: string | null;
  assetName: string | null;
  messageCount: number;
  updatedAt: number;
}

// Troubleshooting sessions = conversations, surfaced as first-class records.
export async function listSessions(orgId: string, limit = 50): Promise<SessionSummary[]> {
  if (!orgId) throw new Error("listSessions() requires orgId");
  await ensureDb();
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      assetId: conversations.assetId,
      updatedAt: conversations.updatedAt,
      assetName: assets.name,
      messageCount: sql<number>`(select count(*) from messages m where m.conversation_id = ${conversations.id} and m.org_id = ${orgId})`,
    })
    .from(conversations)
    .leftJoin(assets, and(eq(conversations.assetId, assets.id), eq(assets.orgId, orgId)))
    .where(eq(conversations.orgId, orgId))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    assetId: r.assetId,
    assetName: r.assetName ?? null,
    messageCount: Number(r.messageCount ?? 0),
    updatedAt:
      r.updatedAt instanceof Date ? r.updatedAt.getTime() : Number(r.updatedAt),
  }));
}

export async function listDocuments(orgId: string, assetId?: string) {
  if (!orgId) throw new Error("listDocuments() requires orgId");
  await ensureDb();
  const where = assetId
    ? and(eq(documents.orgId, orgId), eq(documents.assetId, assetId))
    : eq(documents.orgId, orgId);
  return db.select().from(documents).where(where).orderBy(desc(documents.createdAt));
}

export interface DocumentDetail {
  document: typeof documents.$inferSelect;
  asset: { id: string; name: string } | null;
  /** True when text was extracted and indexed for retrieval. */
  indexed: boolean;
  chunkCount: number;
  /** Concatenated extracted-text preview (bounded). */
  textPreview: string;
  /** Whether the original binary is retrievable for open/download. */
  hasOriginal: boolean;
}

// Single document + everything the detail view needs, strictly org-scoped so a
// document id alone can never reach another tenant's file.
export async function getDocumentDetail(
  orgId: string,
  docId: string
): Promise<DocumentDetail | null> {
  if (!orgId) throw new Error("getDocumentDetail() requires orgId");
  await ensureDb();
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.orgId, orgId), eq(documents.id, docId)));
  const document = rows[0];
  if (!document) return null;

  let asset: { id: string; name: string } | null = null;
  if (document.assetId) {
    const a = await db
      .select({ id: assets.id, name: assets.name })
      .from(assets)
      .where(and(eq(assets.orgId, orgId), eq(assets.id, document.assetId)));
    asset = a[0] ?? null;
  }

  const pieces = await db
    .select({ content: chunks.content })
    .from(chunks)
    .where(and(eq(chunks.orgId, orgId), eq(chunks.documentId, docId)))
    .orderBy(asc(chunks.ordinal));

  const fullText = pieces.map((p) => p.content).join("\n\n");
  const PREVIEW_LIMIT = 6000;
  const textPreview =
    fullText.length > PREVIEW_LIMIT ? fullText.slice(0, PREVIEW_LIMIT) + "…" : fullText;

  return {
    document,
    asset,
    indexed: pieces.length > 0,
    chunkCount: pieces.length,
    textPreview,
    hasOriginal: Boolean(document.storagePath),
  };
}

export async function getOrCreateConversation(
  orgId: string,
  conversationId: string | null | undefined,
  assetId: string | null | undefined,
  title: string
): Promise<string> {
  if (!orgId) throw new Error("getOrCreateConversation() requires orgId");
  await ensureDb();
  if (conversationId) {
    // CRITICAL: scope the existence check to THIS org. A conversation ID minted
    // in another tenant must never resolve here.
    const rows = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.orgId, orgId), eq(conversations.id, conversationId)));
    if (rows[0]) return conversationId;
  }
  const newId = id("cnv");
  await db.insert(conversations).values({
    id: newId,
    orgId,
    assetId: assetId ?? null,
    title: title.slice(0, 80),
  });
  return newId;
}

export async function listConversations(orgId: string, assetId?: string | null) {
  if (!orgId) throw new Error("listConversations() requires orgId");
  await ensureDb();
  const where =
    assetId === undefined
      ? eq(conversations.orgId, orgId)
      : and(
          eq(conversations.orgId, orgId),
          assetId === null
            ? eq(conversations.assetId, "__none__") // never matches; global handled in route
            : eq(conversations.assetId, assetId)
        );
  return db
    .select()
    .from(conversations)
    .where(where)
    .orderBy(desc(conversations.updatedAt));
}

export async function listMessages(orgId: string, conversationId: string) {
  if (!orgId) throw new Error("listMessages() requires orgId");
  await ensureDb();
  // CRITICAL: messages are filtered by org_id, so a conversation ID alone
  // cannot read another tenant's messages.
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.orgId, orgId), eq(messages.conversationId, conversationId)))
    .orderBy(messages.createdAt);
}

export async function addMessage(
  orgId: string,
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  meta?: unknown
) {
  if (!orgId) throw new Error("addMessage() requires orgId");
  await ensureDb();
  await db.insert(messages).values({
    id: id("msg"),
    orgId,
    conversationId,
    role,
    content,
    meta: meta ? JSON.stringify(meta) : null,
  });
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(and(eq(conversations.orgId, orgId), eq(conversations.id, conversationId)));
}

// Thin shim: the rich asset context now lives in the asset repository so the
// Copilot and the digital-twin page share one source of truth. Existing call
// sites (chat route, public ask route) keep working unchanged.
export async function buildAssetContext(orgId: string, assetId: string): Promise<string> {
  if (!orgId) throw new Error("buildAssetContext() requires orgId");
  const { buildAssetContext: build } = await import("@/lib/assets/repository");
  return build(orgId, assetId);
}
