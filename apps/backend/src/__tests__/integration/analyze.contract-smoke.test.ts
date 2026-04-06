import { describe, expect, it } from "vitest";

import { createPostHandler, resetAnalyzeRouteRateLimiterForTests } from "../../app/api/analyze/route";
import type { AnalyzeOrchestratorResult } from "../../modules/analyze/orchestrator";

const runtimeEnv = {
  nodeEnv: "test" as const,
  isProduction: false,
  supabaseUrl: "",
  supabaseServiceRoleKey: "",
  geminiApiKey: "",
  allowedOrigins: ["chrome-extension://abc123"]
};

const validRequestBody = {
  domain: "example.com",
  tcUrl: "https://example.com/terms",
  textHash: "a".repeat(64),
  text: "Sample legal terms text"
};

function createRequest(body: unknown): Request {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "chrome-extension://abc123"
    },
    body: JSON.stringify(body)
  });
}

function createOrchestratorResult(overrides?: Partial<AnalyzeOrchestratorResult>): AnalyzeOrchestratorResult {
  return {
    cached: false,
    updatedSince: false,
    analyzedAt: "2026-04-05T00:00:00.000Z",
    riskScore: 6.1,
    riskLabel: "Medium Risk",
    summary: "Summary text",
    redFlags: [],
    ...overrides
  };
}

describe("analyze API contract smoke", () => {
  it("returns contract-compliant success payload", async () => {
    resetAnalyzeRouteRateLimiterForTests();
    const handler = createPostHandler({
      parseRequestBody: (body) => body as never,
      runOrchestrator: async () => createOrchestratorResult(),
      getRuntimeEnv: () => runtimeEnv
    });

    const response = await handler(createRequest(validRequestBody));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "analyzedAt",
        "cached",
        "redFlags",
        "requestId",
        "riskLabel",
        "riskScore",
        "summary",
        "updatedSince"
      ].sort()
    );
    expect(payload.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload.redFlags).toEqual([]);
  });

  it("returns contract-compliant error envelope", async () => {
    resetAnalyzeRouteRateLimiterForTests();
    const handler = createPostHandler({
      parseRequestBody: () => {
        throw new Error("bad request");
      },
      runOrchestrator: async () => createOrchestratorResult(),
      getRuntimeEnv: () => runtimeEnv
    });

    const response = await handler(createRequest(validRequestBody));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(Object.keys(payload)).toEqual(["error"]);
    expect(Object.keys(payload.error).sort()).toEqual(["code", "message", "requestId"].sort());
    expect(typeof payload.error.code).toBe("string");
    expect(typeof payload.error.message).toBe("string");
    expect(payload.error.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });
});
