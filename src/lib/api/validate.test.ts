import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, Priority } from "./validate";

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const Schema = z.object({
  title: z.string().trim().min(1),
  priority: Priority.optional(),
});

describe("parseBody", () => {
  it("returns typed data for a valid payload", async () => {
    const r = await parseBody(jsonReq({ title: "  Fix pump  ", priority: "high" }), Schema);
    expect(r.response).toBeUndefined();
    expect(r.data).toEqual({ title: "Fix pump", priority: "high" });
  });

  it("rejects an invalid enum with a 400 listing the field", async () => {
    const r = await parseBody(jsonReq({ title: "x", priority: "normal" }), Schema);
    expect(r.data).toBeUndefined();
    expect(r.response!.status).toBe(400);
    const body = await r.response!.json();
    expect(body.error).toBe("validation_failed");
    expect(body.message).toContain("priority");
    expect(body.requestId).toMatch(/^req_/);
  });

  it("rejects a missing required field", async () => {
    const r = await parseBody(jsonReq({ priority: "low" }), Schema);
    expect(r.response!.status).toBe(400);
    expect((await r.response!.json()).message).toContain("title");
  });

  it("rejects a non-JSON body with invalid_json", async () => {
    const r = await parseBody(jsonReq("{not json"), Schema);
    expect(r.response!.status).toBe(400);
    expect((await r.response!.json()).error).toBe("invalid_json");
  });
});
