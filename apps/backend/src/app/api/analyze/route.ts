import type { AnalyzeErrorResponse, AnalyzeSuccessResponse } from "@contracts/api";

import { buildCorsHeaders, isOriginAllowed } from "../../../lib/cors";
import { getEnv } from "../../../lib/env";
import { AppError, getHttpStatusForError, toAnalyzeErrorResponse } from "../../../lib/errors";
import { logger } from "../../../lib/logger";
import { checkFixedWindowLimit, resetRateLimiterForTests } from "../../../lib/rate-limit";
import { orchestrateAnalyze } from "../../../modules/analyze/orchestrator";
import { parseAnalyzeRequest } from "../../../modules/analyze/schema";

const ANALYZE_RATE_LIMIT = 10;
const ANALYZE_RATE_WINDOW_MS = 60_000;

export interface AnalyzeRouteDependencies {
  parseRequestBody: typeof parseAnalyzeRequest;
  runOrchestrator: typeof orchestrateAnalyze;
  getRuntimeEnv: typeof getEnv;
}

function withDependencies(overrides?: Partial<AnalyzeRouteDependencies>): AnalyzeRouteDependencies {
  return {
    parseRequestBody: overrides?.parseRequestBody ?? parseAnalyzeRequest,
    runOrchestrator: overrides?.runOrchestrator ?? orchestrateAnalyze,
    getRuntimeEnv: overrides?.getRuntimeEnv ?? getEnv
  };
}

function createRequestId(): string {
  return crypto.randomUUID();
}

function jsonResponse(
  payload: AnalyzeSuccessResponse | AnalyzeErrorResponse,
  status: number,
  origin: string | null,
  allowedOrigins: string[]
): Response {
  const response = Response.json(payload, { status });
  const corsHeaders = buildCorsHeaders(origin, allowedOrigins);
  corsHeaders.forEach((value, key) => response.headers.set(key, value));
  return response;
}

function enforceRateLimit(origin: string | null, domain: string): void {
  const key = `${origin ?? "no-origin"}:${domain}`;
  const result = checkFixedWindowLimit(key, ANALYZE_RATE_LIMIT, ANALYZE_RATE_WINDOW_MS);
  if (!result.allowed) {
    throw new AppError("RATE_LIMITED", "Too many requests. Please retry later.");
  }
}

export function createPostHandler(overrides?: Partial<AnalyzeRouteDependencies>) {
  const deps = withDependencies(overrides);

  return async function postHandler(request: Request): Promise<Response> {
    const requestId = createRequestId();
    const origin = request.headers.get("origin");
    const env = deps.getRuntimeEnv();
    const startedAtMs = Date.now();
    let requestDomain: string | undefined;
    let cacheHit: boolean | undefined;

    try {
      if (!isOriginAllowed(origin, env.allowedOrigins)) {
        throw new AppError("NOT_ALLOWED_ORIGIN", "Origin is not allowed.");
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch (error) {
        throw new AppError("INVALID_REQUEST", "Request body must be valid JSON.", { cause: error });
      }

      const parsedRequest = deps.parseRequestBody(body);
      requestDomain = parsedRequest.domain;
      enforceRateLimit(origin, parsedRequest.domain);
      const orchestrated = await deps.runOrchestrator(parsedRequest);
      cacheHit = orchestrated.cached;

      const successPayload: AnalyzeSuccessResponse = {
        ...orchestrated,
        requestId
      };

      logger.info("Analyze route succeeded.", {
        requestId,
        domain: requestDomain,
        origin,
        latencyMs: Date.now() - startedAtMs,
        cacheHit: cacheHit ?? false
      });

      return jsonResponse(successPayload, 200, origin, env.allowedOrigins);
    } catch (error) {
      logger.error("Analyze route failed.", {
        requestId,
        domain: requestDomain ?? "unknown",
        origin,
        latencyMs: Date.now() - startedAtMs,
        cacheHit: cacheHit ?? false,
        error
      });
      const status = getHttpStatusForError(error);
      const errorPayload = toAnalyzeErrorResponse(error, requestId);
      return jsonResponse(errorPayload, status, origin, env.allowedOrigins);
    }
  };
}

const postHandler = createPostHandler();

export async function POST(request: Request): Promise<Response> {
  return postHandler(request);
}

export function resetAnalyzeRouteRateLimiterForTests(): void {
  resetRateLimiterForTests();
}
