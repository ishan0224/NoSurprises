import { describe, expect, it, vi } from "vitest";

import type { AnalyzeSuccessResponse } from "@contracts/api";
import type { ExtensionMessage } from "@contracts/extension-messages";

import { handleExtensionMessage, type ChromeWorkerApi, type WorkerContext } from "./worker";

interface MockHarness {
  context: WorkerContext;
  store: Record<string, unknown>;
  fetchMock: ReturnType<typeof vi.fn>;
  queryMock: ReturnType<typeof vi.fn>;
  tabSendMessageMock: ReturnType<typeof vi.fn>;
  executeScriptMock: ReturnType<typeof vi.fn>;
  sendMessageMock: ReturnType<typeof vi.fn>;
}

const createHarness = (): MockHarness => {
  const store: Record<string, unknown> = {};

  const queryMock = vi.fn(async () => [{ id: 1, url: "https://example.com/home" } as chrome.tabs.Tab]);
  const tabSendMessageMock = vi.fn(async () => ({}));
  const executeScriptMock = vi.fn(async () => []);
  const sendMessageMock = vi.fn(async () => undefined);
  const fetchMock = vi.fn();

  const chromeApi: ChromeWorkerApi = {
    runtime: {
      sendMessage: sendMessageMock,
      onMessage: {
        addListener: vi.fn()
      }
    },
    tabs: {
      query: queryMock,
      sendMessage: tabSendMessageMock
    },
    scripting: {
      executeScript: executeScriptMock
    },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | object | null) => {
          if (typeof keys === "string") {
            return { [keys]: store[keys] };
          }

          if (Array.isArray(keys)) {
            return keys.reduce<Record<string, unknown>>((acc, key) => {
              acc[key] = store[key];
              return acc;
            }, {});
          }

          if (keys && typeof keys === "object") {
            return Object.keys(keys).reduce<Record<string, unknown>>((acc, key) => {
              acc[key] = store[key];
              return acc;
            }, {});
          }

          return { ...store };
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        })
      }
    }
  };

  const context: WorkerContext = {
    chromeApi,
    fetchImpl: fetchMock as unknown as typeof fetch,
    now: () => "2026-04-05T00:00:00.000Z",
    endpointUrl: "http://localhost:3000/api/analyze",
    contentScriptFile: "extractor.js"
  };

  return {
    context,
    store,
    fetchMock,
    queryMock,
    tabSendMessageMock,
    executeScriptMock,
    sendMessageMock
  };
};

const successResult: AnalyzeSuccessResponse = {
  cached: false,
  updatedSince: false,
  analyzedAt: "2026-04-05T00:00:00.000Z",
  riskScore: 6.5,
  riskLabel: "Medium Risk",
  summary: "Summary",
  redFlags: [{ title: "Arbitration", quote: "You waive class action rights.", severity: "high" }],
  requestId: "req_1"
};

describe("background worker orchestration", () => {
  it("ANALYZE_PAGE falls back to script injection when extractor is not yet present", async () => {
    const harness = createHarness();
    harness.tabSendMessageMock.mockRejectedValue(new Error("No receiver"));

    await handleExtensionMessage(harness.context, { type: "ANALYZE_PAGE" });

    expect(harness.tabSendMessageMock).toHaveBeenCalledWith(1, { type: "RUN_EXTRACTION" });
    expect(harness.executeScriptMock).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ["extractor.js"]
    });
    expect(harness.store["status:example.com"]).toMatchObject({
      domain: "example.com",
      status: "loading"
    });
  });

  it("ANALYZE_PAGE reuses existing extractor without re-injection", async () => {
    const harness = createHarness();

    await handleExtensionMessage(harness.context, { type: "ANALYZE_PAGE" });

    expect(harness.tabSendMessageMock).toHaveBeenCalledWith(1, { type: "RUN_EXTRACTION" });
    expect(harness.executeScriptMock).not.toHaveBeenCalled();
    expect(harness.store["status:example.com"]).toMatchObject({
      domain: "example.com",
      status: "loading"
    });
  });

  it("TC_FOUND cache hit skips API call and emits ANALYSIS_READY", async () => {
    const harness = createHarness();
    harness.store["analysis:example.com"] = {
      domain: "example.com",
      tcUrl: "https://example.com/terms",
      textHash: "same-hash",
      result: successResult,
      storedAt: "2026-04-05T00:00:00.000Z"
    };

    await handleExtensionMessage(harness.context, {
      type: "TC_FOUND",
      domain: "example.com",
      tcUrl: "https://example.com/terms",
      text: "sample text",
      textHash: "same-hash"
    });

    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(harness.sendMessageMock).toHaveBeenCalledWith({
      type: "ANALYSIS_READY",
      domain: "example.com",
      result: successResult
    });
    expect(harness.store["status:example.com"]).toMatchObject({ status: "ready" });
  });

  it("TC_FOUND cache miss calls API and stores ready result", async () => {
    const harness = createHarness();
    harness.fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (_name: string) => "application/json"
      },
      json: async () => successResult
    } as Response);

    await handleExtensionMessage(harness.context, {
      type: "TC_FOUND",
      domain: "example.com",
      tcUrl: "https://example.com/terms",
      text: "sample text",
      textHash: "new-hash"
    });

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [, fetchInit] = harness.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(fetchInit.method).toBe("POST");
    expect(fetchInit.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(fetchInit.body))).toMatchObject({
      domain: "example.com",
      tcUrl: "https://example.com/terms",
      textHash: "new-hash",
      text: "sample text"
    });

    expect(harness.store["analysis:example.com"]).toMatchObject({
      domain: "example.com",
      textHash: "new-hash"
    });
    expect(harness.store["status:example.com"]).toMatchObject({ status: "ready" });
    expect(harness.sendMessageMock).toHaveBeenCalledWith({
      type: "ANALYSIS_READY",
      domain: "example.com",
      result: successResult
    });
  });

  it("TC_LINKS_FOUND persists links and links_found status", async () => {
    const harness = createHarness();
    const message: ExtensionMessage = {
      type: "TC_LINKS_FOUND",
      domain: "example.com",
      links: [{ label: "Terms", href: "https://example.com/terms" }]
    };

    await handleExtensionMessage(harness.context, message);

    expect(harness.store["links:example.com"]).toMatchObject({
      domain: "example.com",
      links: [{ label: "Terms", href: "https://example.com/terms" }]
    });
    expect(harness.store["status:example.com"]).toMatchObject({ status: "links_found" });
  });

  it("TC_NOT_FOUND sets not_found status", async () => {
    const harness = createHarness();

    await handleExtensionMessage(harness.context, {
      type: "TC_NOT_FOUND",
      domain: "example.com",
      pageUrl: "https://example.com/home"
    });

    expect(harness.store["status:example.com"]).toMatchObject({
      domain: "example.com",
      status: "not_found"
    });
  });

  it("API errors persist error state and emit ANALYSIS_ERROR", async () => {
    const harness = createHarness();
    harness.fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      headers: {
        get: (_name: string) => "application/json"
      },
      json: async () => ({
        error: {
          code: "UPSTREAM_AI_FAILED",
          message: "AI unavailable",
          requestId: "req_err"
        }
      })
    } as Response);

    await handleExtensionMessage(harness.context, {
      type: "TC_FOUND",
      domain: "example.com",
      tcUrl: "https://example.com/terms",
      text: "sample text",
      textHash: "hash-err"
    });

    expect(harness.store["error:example.com"]).toMatchObject({
      domain: "example.com",
      error: {
        code: "UPSTREAM_AI_FAILED",
        message: "AI unavailable",
        requestId: "req_err"
      }
    });
    expect(harness.store["status:example.com"]).toMatchObject({ status: "error" });
    expect(harness.sendMessageMock).toHaveBeenCalledWith({
      type: "ANALYSIS_ERROR",
      domain: "example.com",
      error: {
        code: "UPSTREAM_AI_FAILED",
        message: "AI unavailable",
        requestId: "req_err"
      }
    });
  });
});
