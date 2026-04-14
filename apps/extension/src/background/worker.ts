import type { AnalyzeErrorBody, AnalyzeRequest, AnalyzeSuccessResponse } from "@contracts/api";
import type {
  AnalyzePageMessage,
  AnalysisErrorMessage,
  AnalysisReadyMessage,
  ExtensionMessage,
  RetryAnalysisMessage,
  TcFoundMessage,
  TcLinksFoundMessage,
  TcNotFoundMessage
} from "@contracts/extension-messages";
import type {
  AnalysisStatus,
  StoredAnalysisRecord,
  StoredErrorRecord,
  StoredLinksRecord,
  StoredMetaRecord,
  StoredStatusRecord
} from "@contracts/storage";
import { ANALYZE_ENDPOINT_URL, CONTENT_SCRIPT_FILE, EXTRACTOR_RUN_COMMAND } from "../shared/constants";
import {
  makeAnalysisStorageKey,
  makeErrorStorageKey,
  makeLinksStorageKey,
  makeStatusStorageKey,
  META_LAST_DOMAIN_KEY
} from "../shared/storage";

export interface ChromeWorkerApi {
  runtime: {
    sendMessage: (message: ExtensionMessage) => Promise<unknown> | void;
    onMessage: {
      addListener: (
        callback: (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: () => void) => void
      ) => void;
    };
  };
  tabs: {
    query: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>;
  };
  scripting: {
    executeScript: (injection: { target: { tabId: number }; files: string[] }) => Promise<unknown[]>;
  };
  storage: {
    local: {
      get: (keys?: string | string[] | object | null) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    };
  };
}

export interface WorkerContext {
  chromeApi: ChromeWorkerApi;
  fetchImpl: typeof fetch;
  now: () => string;
  endpointUrl: string;
  contentScriptFile: string;
}

export const normalizeDomain = (hostname: string): string => hostname.replace(/^www\./i, "").toLowerCase();

const createInternalError = (message: string): AnalyzeErrorBody => ({
  code: "INTERNAL_ERROR",
  message,
  requestId: `ext_${Date.now()}`
});

const createInternalErrorFromUnknown = (fallbackMessage: string, error: unknown): AnalyzeErrorBody => {
  if (error instanceof Error && error.message.trim()) {
    return createInternalError(`${fallbackMessage} (${error.message})`);
  }
  return createInternalError(fallbackMessage);
};

const summarizeResponseFailure = (status: number, responseBody: unknown): AnalyzeErrorBody => {
  if (typeof responseBody === "string" && responseBody.trim()) {
    const trimmed = responseBody.trim().slice(0, 180);
    return createInternalError(`Analyze API failed with HTTP ${status}. ${trimmed}`);
  }
  return createInternalError(`Analyze API failed with HTTP ${status}.`);
};

const isAnalyzeSuccessResponse = (value: unknown): value is AnalyzeSuccessResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AnalyzeSuccessResponse>;
  return (
    typeof candidate.cached === "boolean" &&
    typeof candidate.updatedSince === "boolean" &&
    typeof candidate.analyzedAt === "string" &&
    typeof candidate.riskScore === "number" &&
    typeof candidate.riskLabel === "string" &&
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.redFlags) &&
    typeof candidate.requestId === "string"
  );
};

const parseAnalyzeError = (value: unknown): AnalyzeErrorBody | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const maybeErrorResponse = value as {
    error?: {
      code?: unknown;
      message?: unknown;
      requestId?: unknown;
    };
  };

  if (
    typeof maybeErrorResponse.error?.code === "string" &&
    typeof maybeErrorResponse.error?.message === "string" &&
    typeof maybeErrorResponse.error?.requestId === "string"
  ) {
    return {
      code: maybeErrorResponse.error.code as AnalyzeErrorBody["code"],
      message: maybeErrorResponse.error.message,
      requestId: maybeErrorResponse.error.requestId
    };
  }

  return null;
};

const getActiveTabContext = async (
  context: WorkerContext
): Promise<{ tabId: number; pageUrl: string; domain: string } | null> => {
  const tabs = await context.chromeApi.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  if (!tab || typeof tab.id !== "number" || typeof tab.url !== "string") {
    return null;
  }

  try {
    const parsed = new URL(tab.url);
    return {
      tabId: tab.id,
      pageUrl: parsed.toString(),
      domain: normalizeDomain(parsed.hostname)
    };
  } catch {
    return null;
  }
};

const persistStatus = async (
  context: WorkerContext,
  domain: string,
  status: AnalysisStatus
): Promise<StoredStatusRecord> => {
  const statusKey = makeStatusStorageKey(domain);
  const statusRecord: StoredStatusRecord = {
    domain,
    status,
    updatedAt: context.now()
  };
  const metaRecord: StoredMetaRecord = {
    lastDomain: domain
  };

  await context.chromeApi.storage.local.set({
    [statusKey]: statusRecord,
    [META_LAST_DOMAIN_KEY]: metaRecord
  });

  return statusRecord;
};

const persistError = async (
  context: WorkerContext,
  domain: string,
  error: AnalyzeErrorBody
): Promise<StoredErrorRecord> => {
  const errorKey = makeErrorStorageKey(domain);
  const record: StoredErrorRecord = {
    domain,
    error,
    updatedAt: context.now()
  };

  await context.chromeApi.storage.local.set({
    [errorKey]: record
  });

  return record;
};

const emitReady = async (
  context: WorkerContext,
  domain: string,
  result: AnalyzeSuccessResponse
): Promise<void> => {
  const message: AnalysisReadyMessage = {
    type: "ANALYSIS_READY",
    domain,
    result
  };
  await Promise.resolve(context.chromeApi.runtime.sendMessage(message));
};

const emitError = async (context: WorkerContext, domain: string, error: AnalyzeErrorBody): Promise<void> => {
  const message: AnalysisErrorMessage = {
    type: "ANALYSIS_ERROR",
    domain,
    error
  };
  await Promise.resolve(context.chromeApi.runtime.sendMessage(message));
};

const injectExtractorScript = async (context: WorkerContext, tabId: number): Promise<void> => {
  await context.chromeApi.scripting.executeScript({
    target: { tabId },
    files: [context.contentScriptFile]
  });
};

const triggerExistingExtractor = async (context: WorkerContext, tabId: number): Promise<boolean> => {
  try {
    await context.chromeApi.tabs.sendMessage(tabId, { type: EXTRACTOR_RUN_COMMAND });
    return true;
  } catch {
    return false;
  }
};

export const isAnalyzePageMessage = (message: ExtensionMessage): message is AnalyzePageMessage =>
  message.type === "ANALYZE_PAGE";

export const isRetryAnalysisMessage = (message: ExtensionMessage): message is RetryAnalysisMessage =>
  message.type === "RETRY_ANALYSIS";

const handleAnalyzeTrigger = async (context: WorkerContext): Promise<void> => {
  const tabContext = await getActiveTabContext(context);
  if (!tabContext) {
    return;
  }

  await persistStatus(context, tabContext.domain, "loading");

  const alreadyInjected = await triggerExistingExtractor(context, tabContext.tabId);
  if (alreadyInjected) {
    return;
  }

  await injectExtractorScript(context, tabContext.tabId);
};

const handleTcFound = async (context: WorkerContext, message: TcFoundMessage): Promise<void> => {
  const analysisKey = makeAnalysisStorageKey(message.domain);
  const existingRaw = await context.chromeApi.storage.local.get(analysisKey);
  const existingRecord = existingRaw[analysisKey] as StoredAnalysisRecord | undefined;

  if (existingRecord && existingRecord.textHash === message.textHash) {
    await persistStatus(context, message.domain, "ready");
    await emitReady(context, message.domain, existingRecord.result);
    return;
  }

  const request: AnalyzeRequest = {
    domain: message.domain,
    tcUrl: message.tcUrl,
    textHash: message.textHash,
    text: message.text
  };

  try {
    const response = await context.fetchImpl(context.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });

    let responseBody: unknown;
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.toLowerCase().includes("application/json")) {
        responseBody = (await response.json()) as unknown;
      } else {
        responseBody = await response.text();
      }
    } catch (error) {
      responseBody = `Failed to parse API response body: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
    }

    if (!response.ok) {
      const parsedError =
        parseAnalyzeError(responseBody) ?? summarizeResponseFailure(response.status, responseBody);
      await persistError(context, message.domain, parsedError);
      await persistStatus(context, message.domain, "error");
      await emitError(context, message.domain, parsedError);
      return;
    }

    if (!isAnalyzeSuccessResponse(responseBody)) {
      const parsedError = createInternalError("Analyze API returned invalid response shape.");
      await persistError(context, message.domain, parsedError);
      await persistStatus(context, message.domain, "error");
      await emitError(context, message.domain, parsedError);
      return;
    }

    const storedRecord: StoredAnalysisRecord = {
      domain: message.domain,
      tcUrl: message.tcUrl,
      textHash: message.textHash,
      result: responseBody,
      storedAt: context.now()
    };

    await context.chromeApi.storage.local.set({
      [analysisKey]: storedRecord
    });
    await persistStatus(context, message.domain, "ready");
    await emitReady(context, message.domain, responseBody);
  } catch (caughtError) {
    const error = createInternalErrorFromUnknown(
      "Network failure while analyzing terms.",
      caughtError
    );
    await persistError(context, message.domain, error);
    await persistStatus(context, message.domain, "error");
    await emitError(context, message.domain, error);
  }
};

const handleTcLinksFound = async (context: WorkerContext, message: TcLinksFoundMessage): Promise<void> => {
  const linksKey = makeLinksStorageKey(message.domain);
  const linksRecord: StoredLinksRecord = {
    domain: message.domain,
    links: message.links,
    discoveredAt: context.now()
  };

  await context.chromeApi.storage.local.set({
    [linksKey]: linksRecord
  });
  await persistStatus(context, message.domain, "links_found");
};

const handleTcNotFound = async (context: WorkerContext, message: TcNotFoundMessage): Promise<void> => {
  await persistStatus(context, message.domain, "not_found");
};

export const handleExtensionMessage = async (context: WorkerContext, message: ExtensionMessage): Promise<void> => {
  switch (message.type) {
    case "ANALYZE_PAGE":
    case "RETRY_ANALYSIS":
      await handleAnalyzeTrigger(context);
      return;
    case "TC_FOUND":
      await handleTcFound(context, message);
      return;
    case "TC_LINKS_FOUND":
      await handleTcLinksFound(context, message);
      return;
    case "TC_NOT_FOUND":
      await handleTcNotFound(context, message);
      return;
    case "ANALYSIS_READY":
    case "ANALYSIS_ERROR":
      return;
    default:
      return;
  }
};

export const createWorkerContext = (
  chromeApi: ChromeWorkerApi,
  fetchImpl: typeof fetch = fetch
): WorkerContext => {
  // Bind fetch to globalThis because service-worker fetch can throw
  // "Illegal invocation" when called with an arbitrary receiver.
  const boundFetch = fetchImpl.bind(globalThis) as typeof fetch;

  return {
    chromeApi,
    fetchImpl: boundFetch,
    now: () => new Date().toISOString(),
    endpointUrl: ANALYZE_ENDPOINT_URL,
    contentScriptFile: CONTENT_SCRIPT_FILE
  };
};

export const registerWorkerListeners = (context: WorkerContext): void => {
  context.chromeApi.runtime.onMessage.addListener((rawMessage) => {
    if (!rawMessage || typeof rawMessage !== "object" || !("type" in rawMessage)) {
      return;
    }
    void handleExtensionMessage(context, rawMessage as ExtensionMessage);
  });
};

declare const chrome: ChromeWorkerApi | undefined;

if (
  typeof chrome !== "undefined" &&
  chrome?.runtime?.onMessage &&
  chrome?.tabs &&
  chrome?.scripting &&
  chrome?.storage?.local
) {
  const runtimeContext = createWorkerContext(chrome);
  registerWorkerListeners(runtimeContext);
}
