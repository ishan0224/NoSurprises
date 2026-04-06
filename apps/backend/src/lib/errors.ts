import type { AnalyzeErrorCode, AnalyzeErrorResponse } from "@contracts/api";

const statusByCode: Record<AnalyzeErrorCode, number> = {
  INVALID_REQUEST: 400,
  NOT_ALLOWED_ORIGIN: 403,
  RATE_LIMITED: 429,
  UPSTREAM_AI_FAILED: 502,
  INTERNAL_ERROR: 500
};

export class AppError extends Error {
  public readonly code: AnalyzeErrorCode;
  public readonly status: number;
  public readonly cause?: unknown;

  constructor(code: AnalyzeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = statusByCode[code];
    this.cause = options?.cause;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function getHttpStatusForError(error: unknown): number {
  if (isAppError(error)) {
    return error.status;
  }
  return statusByCode.INTERNAL_ERROR;
}

export function toAnalyzeErrorResponse(error: unknown, requestId: string): AnalyzeErrorResponse {
  if (isAppError(error)) {
    return {
      error: {
        code: error.code,
        message: error.message,
        requestId
      }
    };
  }

  return {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId
    }
  };
}
