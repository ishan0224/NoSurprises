import type { AnalyzeErrorBody, AnalyzeSuccessResponse } from "./api";

export type AnalysisStatus = "idle" | "loading" | "ready" | "error" | "not_found" | "links_found";

export interface TcLink {
  label: string;
  href: string;
}

export type DomainAnalysisStorageKey = `analysis:${string}`;
export type DomainStatusStorageKey = `status:${string}`;
export type DomainErrorStorageKey = `error:${string}`;
export type DomainLinksStorageKey = `links:${string}`;
export type MetaLastDomainKey = "meta:lastDomain";

export interface StoredAnalysisRecord {
  domain: string;
  tcUrl: string;
  textHash: string;
  result: AnalyzeSuccessResponse;
  storedAt: string;
}

export interface StoredStatusRecord {
  domain: string;
  status: AnalysisStatus;
  updatedAt: string;
}

export interface StoredErrorRecord {
  domain: string;
  error: AnalyzeErrorBody;
  updatedAt: string;
}

export interface StoredLinksRecord {
  domain: string;
  links: TcLink[];
  discoveredAt: string;
}

export interface StoredMetaRecord {
  lastDomain: string | null;
}

export type ExtensionStorageRecord = {
  [key: DomainAnalysisStorageKey]: StoredAnalysisRecord;
} & {
  [key: DomainStatusStorageKey]: StoredStatusRecord;
} & {
  [key: DomainErrorStorageKey]: StoredErrorRecord;
} & {
  [key: DomainLinksStorageKey]: StoredLinksRecord;
} & {
  [key in MetaLastDomainKey]: StoredMetaRecord;
};
