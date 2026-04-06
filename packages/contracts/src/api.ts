export type RedFlagSeverity = "low" | "medium" | "high";

export interface RedFlag {
  title: string;
  quote: string;
  severity: RedFlagSeverity;
}

export type RiskLabel = "Low Risk" | "Medium Risk" | "High Risk";

export interface AnalyzeRequest {
  domain: string;
  tcUrl: string;
  textHash: string;
  text: string;
}

export interface AnalyzeSuccessResponse {
  cached: boolean;
  updatedSince: boolean;
  analyzedAt: string;
  riskScore: number;
  riskLabel: RiskLabel;
  summary: string;
  redFlags: RedFlag[];
  requestId: string;
}

export type AnalysisResult = Pick<
  AnalyzeSuccessResponse,
  "riskScore" | "riskLabel" | "summary" | "redFlags"
>;

export type AnalyzeErrorCode =
  | "INVALID_REQUEST"
  | "NOT_ALLOWED_ORIGIN"
  | "RATE_LIMITED"
  | "UPSTREAM_AI_FAILED"
  | "INTERNAL_ERROR";

export interface AnalyzeErrorBody {
  code: AnalyzeErrorCode;
  message: string;
  requestId: string;
}

export interface AnalyzeErrorResponse {
  error: AnalyzeErrorBody;
}

export type AnalyzeResponse = AnalyzeSuccessResponse | AnalyzeErrorResponse;
