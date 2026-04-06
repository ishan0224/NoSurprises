import type { AnalysisResult } from "@contracts/api";

import { AppError, isAppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { analysesRepository, type AnalysesRepository } from "../repositories/analyses.repository";
import { websitesRepository, type WebsitesRepository } from "../repositories/websites.repository";

export interface CachedResult extends AnalysisResult {
  domain: string;
  tcUrl: string;
  textHash: string;
  analyzedAt: string;
}

export interface CacheServiceDependencies {
  websitesRepo: WebsitesRepository;
  analysesRepo: AnalysesRepository;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function withDependencies(overrides?: Partial<CacheServiceDependencies>): CacheServiceDependencies {
  return {
    websitesRepo: overrides?.websitesRepo ?? websitesRepository,
    analysesRepo: overrides?.analysesRepo ?? analysesRepository
  };
}

export async function getCached(
  domain: string,
  overrides?: Partial<CacheServiceDependencies>
): Promise<CachedResult | null> {
  const normalizedDomain = normalizeDomain(domain);
  const { websitesRepo, analysesRepo } = withDependencies(overrides);

  try {
    const website = await websitesRepo.getByDomain(normalizedDomain);
    if (!website) {
      return null;
    }

    const latest = await analysesRepo.getLatestByWebsiteId(website.id);
    if (!latest) {
      return null;
    }

    return {
      domain: website.domain,
      tcUrl: website.tcUrl,
      textHash: latest.contentHash,
      analyzedAt: latest.analyzedAt,
      riskScore: latest.riskScore,
      riskLabel: latest.riskLabel,
      summary: latest.summary,
      redFlags: latest.redFlags
    };
  } catch (error) {
    logger.error("Cache lookup failed.", { domain: normalizedDomain, error });
    if (isAppError(error)) {
      throw error;
    }
    throw new AppError("INTERNAL_ERROR", "Cache lookup failed.", { cause: error });
  }
}

export async function saveAnalysis(
  domain: string,
  tcUrl: string,
  hash: string,
  analysis: AnalysisResult,
  overrides?: Partial<CacheServiceDependencies>
): Promise<void> {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedTcUrl = tcUrl.trim();
  const normalizedHash = hash.trim().toLowerCase();
  const { analysesRepo } = withDependencies(overrides);

  if (!normalizedDomain || !normalizedTcUrl || !normalizedHash) {
    throw new AppError("INVALID_REQUEST", "Domain, tcUrl, and hash are required for cache save.");
  }

  try {
    await analysesRepo.saveLatestAtomic({
      domain: normalizedDomain,
      tcUrl: normalizedTcUrl,
      contentHash: normalizedHash,
      riskScore: analysis.riskScore,
      riskLabel: analysis.riskLabel,
      summary: analysis.summary,
      redFlags: analysis.redFlags
    });
  } catch (error) {
    logger.error("Cache save failed.", { domain: normalizedDomain, error });
    if (isAppError(error)) {
      throw error;
    }
    throw new AppError("INTERNAL_ERROR", "Cache save failed.", { cause: error });
  }
}
