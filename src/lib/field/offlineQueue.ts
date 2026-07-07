/**
 * Offline capture queue for the at-the-machine /field view. Plant floors have
 * real dead zones (metal buildings, basements, remote skids); a capture taken
 * there must NEVER be lost. When the network is unreachable, the work order is
 * saved on the device (IndexedDB, so a photo Blob survives too) and flushed
 * automatically when connectivity returns.
 *
 * Trust rules:
 *   - Nothing is dropped silently. A capture leaves the queue only after the
 *     server has accepted it (or is kept queued if the server rejects it).
 *   - The UI must never claim "logged" for a capture that is only queued — the
 *     caller distinguishes a synced submit from a queued one by which path ran.
 *
 * The pure pieces (payload shape, flush orchestration) are dependency-injected
 * so they can be unit-tested without a browser IndexedDB.
 */

export interface FieldCapture {
  id: string; // local id, assigned on the device
  symptom: string;
  assetId: string | null;
  assetName: string | null;
  priority: string;
  photo?: Blob | null;
  photoName?: string | null;
  createdAt: number;
}

// The server payload for a captured work order — identical in shape to the
// online path so a queued capture becomes the exact same work order.
export function workOrderPayload(c: FieldCapture) {
  const symptom = c.symptom.trim();
  return {
    title: symptom.slice(0, 90),
    symptom,
    assetId: c.assetId || null,
    priority: c.priority,
    type: "corrective" as const,
    source: "field" as const,
  };
}

// Thrown when the network itself is unreachable (as opposed to the server
// rejecting a request). Signals the flush loop to stop and retry later.
export class OfflineError extends Error {
  constructor(message = "offline") {
    super(message);
    this.name = "OfflineError";
  }
}

// Submit one capture to the real endpoints. Resolves with the created work-order
// id. Throws OfflineError on a network failure (queue it / keep it queued) and a
// plain Error if the server rejected it.
export async function submitCapture(c: FieldCapture): Promise<string> {
  let r: Response;
  try {
    r = await fetch("/api/work-orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(workOrderPayload(c)),
    });
  } catch {
    throw new OfflineError();
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d.message || `Server rejected the work order (${r.status}).`);
  }
  const d = await r.json().catch(() => ({}));
  const woId: string = d.workOrder?.id ?? d.id ?? "";

  // Best-effort photo attach (photos live on the asset). A photo failure never
  // fails the capture — the work order is already saved.
  if (c.photo && c.assetId) {
    try {
      const fd = new FormData();
      fd.append("files", c.photo, c.photoName ?? "field-photo.jpg");
      await fetch(`/api/assets/${c.assetId}/photos`, { method: "POST", body: fd });
    } catch {
      /* keep the work order; the photo just didn't attach */
    }
  }
  return woId;
}

export interface CaptureStore {
  add(c: FieldCapture): Promise<void>;
  list(): Promise<FieldCapture[]>;
  remove(id: string): Promise<void>;
}

export interface FlushResult {
  synced: number;
  remaining: number;
}

// Flush queued captures oldest-first. Stops on the first network failure (still
// offline — try again later) but skips past a server-rejected capture so one bad
// item can't block the rest. A capture is removed only after a successful sync.
export async function flushCaptures(
  store: CaptureStore,
  submit: (c: FieldCapture) => Promise<string> = submitCapture
): Promise<FlushResult> {
  const pending = (await store.list()).sort((a, b) => a.createdAt - b.createdAt);
  let synced = 0;
  for (const c of pending) {
    try {
      await submit(c);
      await store.remove(c.id);
      synced++;
    } catch (e) {
      if (e instanceof OfflineError) break; // no connection — leave the rest queued
      /* server rejected this one: keep it queued, move on to the next */
    }
  }
  const remaining = (await store.list()).length;
  return { synced, remaining };
}

// ── IndexedDB-backed store (browser only) ────────────────────────────────────
const DB_NAME = "eas_field";
const STORE = "captures";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      })
  );
}

// A no-op store for SSR / environments without IndexedDB — the queue simply
// can't persist there, which the caller treats as "couldn't save offline".
const unavailable: CaptureStore = {
  async add() {
    throw new Error("offline storage unavailable");
  },
  async list() {
    return [];
  },
  async remove() {
    /* nothing to remove */
  },
};

export function getCaptureStore(): CaptureStore {
  if (typeof indexedDB === "undefined") return unavailable;
  return {
    add: (c) => tx("readwrite", (s) => s.put(c)).then(() => undefined),
    list: () => tx<FieldCapture[]>("readonly", (s) => s.getAll() as IDBRequest<FieldCapture[]>),
    remove: (id) => tx("readwrite", (s) => s.delete(id)).then(() => undefined),
  };
}
