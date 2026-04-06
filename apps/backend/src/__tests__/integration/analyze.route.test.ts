import { describe, expect, it } from "vitest";

import { createPostHandler, resetAnalyzeRouteRateLimiterForTests } from "../../app/api/analyze/route";
import { parseAnalyzeRequest } from "../../modules/analyze/schema";
import type { AnalyzeOrchestratorResult } from "../../modules/analyze/orchestrator";

const allowedEnv = {
  nodeEnv: "test" as const,
  isProduction: false,
  supabaseUrl: "",
  supabaseServiceRoleKey: "",
  geminiApiKey: "",
  allowedOrigins: ["chrome-extension://abc123"]
};

function createRequest(origin: string | null, body: unknown): Request {
  return new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {})
    },
    body: JSON.stringify(body)
  });
}

function buildOrchestratorResult(overrides?: Partial<AnalyzeOrchestratorResult>): AnalyzeOrchestratorResult {
  return {
    cached: false,
    updatedSince: false,
    analyzedAt: "2026-04-05T00:00:00.000Z",
    riskScore: 5,
    riskLabel: "Medium Risk",
    summary: "summary",
    redFlags: [],
    ...overrides
  };
}

describe("analyze route integration", () => {
  it("returns 400 INVALID_REQUEST for invalid payload", async () => {
    resetAnalyzeRouteRateLimiterForTests();
    const handler = createPostHandler({
      parseRequestBody: parseAnalyzeRequest,
      runOrchestrator: async () => buildOrchestratorResult(),
      getRuntimeEnv: () => allowedEnv
    });

    const response = await handler(createRequest("chrome-extension://abc123", { bad: true }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_REQUEST");
  });

  it("returns cache hit response when orchestrator reports cached=true", async () => {
    resetAnalyzeRouteRateLimiterForTests();
    const handler = createPostHandler({
      parseRequestBody: (body) => body as never,
      runOrchestrator: async () => buildOrchestratorResult({ cached: true, updatedSince: false }),
      getRuntimeEnv: () => allowedEnv
    });

    const response = await handler(
      createRequest("chrome-extension://abc123", {
        domain: "spotify.com",
        tcUrl: "https://spotify.com/legal",
        textHash: "a".repeat(64),
        text: "terms"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.cached).toBe(true);
    expect(payload.updatedSince).toBe(false);
    expect(response.headers.get("access-control-allow-origin")).toBe("chrome-extension://abc123");
  });

  it("returns cache miss response when orchestrator reports cached=false", async () => {
    resetAnalyzeRouteRateLimiterForTests();
    const handler = createPostHandler({
      parseRequestBody: (body) => body as never,
      runOrchestrator: async () => buildOrchestratorResult({ cached: false, updatedSince: false }),
      getRuntimeEnv: () => allowedEnv
    });

    const response = await handler(
      createRequest("chrome-extension://abc123", {
        domain: "example.com",
        tcUrl: "https://example.com/terms",
        textHash: "b".repeat(64),
        text: "terms"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.cached).toBe(false);
    expect(payload.updatedSince).toBe(false);
  });

  it("returns updatedSince=true when orchestrator reports hash mismatch path", async () => {
    resetAnalyzeRouteRateLimiterForTests();
    const handler = createPostHandler({
      parseRequestBody: (body) => body as never,
      runOrchestrator: async () => buildOrchestratorResult({ cached: false, updatedSince: true }),
      getRuntimeEnv: () => allowedEnv
    });

    const response = await handler(
      createRequest("chrome-extension://abc123", {
        domain: "example.com",
        tcUrl: "https://example.com/terms",
        textHash: "c".repeat(64),
        text: "terms updated"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.cached).toBe(false);
    expect(payload.updatedSince).toBe(true);
  });

  it("returns 403 for blocked CORS origin", async () => {
    resetAnalyzeRouteRateLimiterForTests();
    const handler = createPostHandler({
      parseRequestBody: (body) => body as never,
      runOrchestrator: async () => buildOrchestratorResult(),
      getRuntimeEnv: () => allowedEnv
    });

    const response = await handler(
      createRequest("chrome-extension://blocked", {
        domain: "spotify.com",
        tcUrl: "https://spotify.com/legal",
        textHash: "d".repeat(64),
        text: "terms"
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("NOT_ALLOWED_ORIGIN");
  });
});
