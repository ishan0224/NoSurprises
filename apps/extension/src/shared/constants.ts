import type { AnalyzeErrorCode, AnalyzeRequest, RedFlagSeverity, RiskLabel } from "@contracts/api";

export const DEFAULT_API_BASE_URL = "http://localhost:3000";
export const API_BASE_URL = import.meta.env.API_BASE_URL ?? DEFAULT_API_BASE_URL;
export const ANALYZE_ENDPOINT_PATH = "/api/analyze";
export const ANALYZE_ENDPOINT_URL = new URL(ANALYZE_ENDPOINT_PATH, API_BASE_URL).toString();

export const CONTENT_SCRIPT_FILE = "extractor.js";
export const EXTRACTOR_RUN_COMMAND = "RUN_EXTRACTION";
export const WORKER_MESSAGE_CHANNEL = "nosuprises";

export const POPUP_COPY = {
  title: "NoSurprises",
  idleHeadline: "Analyze this page",
  idleSubtext: "Click to check the Terms & Conditions on this page",
  loadingText: "Analyzing Terms & Conditions...",
  readyHeadline: "Risk Analysis",
  updatedBanner: "T&C has changed since your last visit",
  linksHeadline: "We found Terms & Conditions links on this site:",
  linksSubtext: "Navigate to one of these pages, then click Analyze",
  notFoundHeadline: "No Terms & Conditions detected on this page",
  notFoundSubtext: "Try navigating to the site's T&C page and clicking Analyze",
  retryLabel: "Try again",
  reanalyzeLabel: "Re-analyze",
  redFlagsHeadline: "Red flags"
} as const;

export const POPUP_ERROR_MESSAGES: Record<AnalyzeErrorCode, string> = {
  INVALID_REQUEST: "The analysis request was invalid. Please try again.",
  NOT_ALLOWED_ORIGIN: "This extension origin is not allowed to call the API.",
  RATE_LIMITED: "Rate limit reached. Please wait a moment and retry.",
  UPSTREAM_AI_FAILED: "The AI service is temporarily unavailable. Please retry shortly.",
  INTERNAL_ERROR: "Unexpected error while analyzing this page. Please retry."
};

export const RED_FLAG_SEVERITY_LABELS: Record<RedFlagSeverity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High"
};

export const RED_FLAG_SEVERITY_CLASS: Record<RedFlagSeverity, string> = {
  low: "severity-low",
  medium: "severity-medium",
  high: "severity-high"
};

export const RISK_LABEL_CLASS: Record<RiskLabel, string> = {
  "Low Risk": "risk-low",
  "Medium Risk": "risk-medium",
  "High Risk": "risk-high"
};

export type AnalyzePayload = AnalyzeRequest;
