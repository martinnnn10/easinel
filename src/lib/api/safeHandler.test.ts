import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { safeHandler } from "./safeHandler";

function req(): NextRequest {
  return new NextRequest("http://localhost/api/test", { method: "POST" });
}

describe("safeHandler", () => {
  it("passes a normal response through untouched", async () => {
    const handler = safeHandler("test.ok", async () =>
      new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "content-type": "application/json" } })
    );
    const res = await handler(req());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("converts a thrown error into a clean 500 envelope (no stack leak)", async () => {
    const handler = safeHandler("test.throws", async () => {
      throw new Error("boom: secret internal detail");
    });
    const res = await handler(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(body.requestId).toMatch(/^req_/);
    // The internal error message / stack must NOT leak to the caller.
    expect(JSON.stringify(body)).not.toContain("secret internal detail");
  });

  it("stamps an x-request-id header and honors an inbound one", async () => {
    const handler = safeHandler("test.throws", async () => {
      throw new Error("x");
    });
    const inbound = new NextRequest("http://localhost/api/test", {
      method: "POST",
      headers: { "x-request-id": "trace-abc12345" },
    });
    const res = await handler(inbound);
    expect(res.headers.get("x-request-id")).toBe("trace-abc12345");
  });

  it("forwards trailing args (dynamic route ctx) to the handler", async () => {
    const handler = safeHandler(
      "test.ctx",
      async (_r: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
        const { id } = await ctx.params;
        return new Response(JSON.stringify({ id }), { status: 200 });
      }
    );
    const res = await handler(req(), { params: Promise.resolve({ id: "wo_42" }) });
    expect(await res.json()).toEqual({ id: "wo_42" });
  });
});
