import { describe, it, expect } from "vitest";
import {
  workOrderPayload,
  flushCaptures,
  OfflineError,
  type FieldCapture,
  type CaptureStore,
} from "./offlineQueue";

function cap(id: string, over: Partial<FieldCapture> = {}): FieldCapture {
  return {
    id,
    symptom: "F007 overload trip after warmup",
    assetId: "ast_1",
    assetName: "Case Packer",
    priority: "high",
    photo: null,
    createdAt: Number(id.replace(/\D/g, "")) || 0,
    ...over,
  };
}

// A simple in-memory store standing in for IndexedDB.
function memStore(initial: FieldCapture[] = []): CaptureStore {
  let items = [...initial];
  return {
    async add(c) {
      items = [...items.filter((x) => x.id !== c.id), c];
    },
    async list() {
      return [...items];
    },
    async remove(id) {
      items = items.filter((x) => x.id !== id);
    },
  };
}

describe("workOrderPayload", () => {
  it("mirrors the online field-capture payload (title from symptom, source=field)", () => {
    const p = workOrderPayload(cap("1", { symptom: "  bearing noise on drive end  " }));
    expect(p.title).toBe("bearing noise on drive end");
    expect(p.symptom).toBe("bearing noise on drive end");
    expect(p.type).toBe("corrective");
    expect(p.source).toBe("field");
    expect(p.assetId).toBe("ast_1");
  });

  it("truncates an over-long title to 90 chars but keeps the full symptom", () => {
    const long = "x".repeat(200);
    const p = workOrderPayload(cap("1", { symptom: long }));
    expect(p.title.length).toBe(90);
    expect(p.symptom.length).toBe(200);
  });

  it("normalizes a blank assetId to null (log without a machine)", () => {
    const p = workOrderPayload(cap("1", { assetId: "" as unknown as string }));
    expect(p.assetId).toBeNull();
  });
});

describe("flushCaptures", () => {
  it("syncs every queued capture oldest-first and empties the queue", async () => {
    const store = memStore([cap("c3"), cap("c1"), cap("c2")]);
    const order: string[] = [];
    const res = await flushCaptures(store, async (c) => {
      order.push(c.id);
      return "wo_" + c.id;
    });
    expect(res).toEqual({ synced: 3, remaining: 0 });
    expect(order).toEqual(["c1", "c2", "c3"]); // ordered by createdAt
    expect(await store.list()).toHaveLength(0);
  });

  it("stops on a network failure and leaves the rest queued (no data loss)", async () => {
    const store = memStore([cap("c1"), cap("c2"), cap("c3")]);
    let n = 0;
    const res = await flushCaptures(store, async (c) => {
      n++;
      if (n === 2) throw new OfflineError(); // connection drops mid-flush
      return "wo_" + c.id;
    });
    expect(res.synced).toBe(1);
    expect(res.remaining).toBe(2); // c2 and c3 stay safe on the device
    const left = (await store.list()).map((c) => c.id).sort();
    expect(left).toEqual(["c2", "c3"]);
  });

  it("skips a server-rejected capture but keeps flushing the others", async () => {
    const store = memStore([cap("c1"), cap("c2"), cap("c3")]);
    const res = await flushCaptures(store, async (c) => {
      if (c.id === "c2") throw new Error("422 bad request");
      return "wo_" + c.id;
    });
    expect(res.synced).toBe(2); // c1 and c3 synced
    expect(res.remaining).toBe(1); // c2 kept queued, never dropped
    expect((await store.list())[0].id).toBe("c2");
  });

  it("is a no-op on an empty queue", async () => {
    const res = await flushCaptures(memStore([]), async () => "wo");
    expect(res).toEqual({ synced: 0, remaining: 0 });
  });
});
