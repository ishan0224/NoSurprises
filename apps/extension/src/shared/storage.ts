import type {
  DomainAnalysisStorageKey,
  DomainErrorStorageKey,
  DomainStatusStorageKey,
  DomainLinksStorageKey,
  MetaLastDomainKey,
  StoredErrorRecord,
  StoredStatusRecord,
  StoredAnalysisRecord,
  StoredLinksRecord
} from "@contracts/storage";

export const makeAnalysisStorageKey = (domain: string): DomainAnalysisStorageKey => `analysis:${domain}`;
export const makeStatusStorageKey = (domain: string): DomainStatusStorageKey => `status:${domain}`;
export const makeErrorStorageKey = (domain: string): DomainErrorStorageKey => `error:${domain}`;

export const makeLinksStorageKey = (domain: string): DomainLinksStorageKey => `links:${domain}`;
export const META_LAST_DOMAIN_KEY: MetaLastDomainKey = "meta:lastDomain";

export type { StoredAnalysisRecord, StoredStatusRecord, StoredErrorRecord, StoredLinksRecord };
