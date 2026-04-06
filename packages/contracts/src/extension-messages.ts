import type { AnalyzeErrorBody, AnalyzeSuccessResponse } from "./api";
import type { TcLink } from "./storage";

export interface TcFoundMessage {
  type: "TC_FOUND";
  domain: string;
  tcUrl: string;
  text: string;
  textHash: string;
}

export interface TcNotFoundMessage {
  type: "TC_NOT_FOUND";
  domain: string;
  pageUrl: string;
}

export interface TcLinksFoundMessage {
  type: "TC_LINKS_FOUND";
  domain: string;
  links: TcLink[];
}

export interface AnalysisReadyMessage {
  type: "ANALYSIS_READY";
  domain: string;
  result: AnalyzeSuccessResponse;
}

export interface AnalysisErrorMessage {
  type: "ANALYSIS_ERROR";
  domain: string;
  error: AnalyzeErrorBody;
}

export interface RetryAnalysisMessage {
  type: "RETRY_ANALYSIS";
  domain: string;
  tcUrl: string;
}

export interface AnalyzePageMessage {
  type: "ANALYZE_PAGE";
}

export type ExtensionMessage =
  | TcFoundMessage
  | TcNotFoundMessage
  | TcLinksFoundMessage
  | AnalysisReadyMessage
  | AnalysisErrorMessage
  | RetryAnalysisMessage
  | AnalyzePageMessage;
