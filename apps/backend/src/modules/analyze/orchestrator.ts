import type { AnalyzeRequest, AnalyzeSuccessResponse, AnalysisResult } from "@contracts/api";

import { logger } from "../../lib/logger";
import { analyzeTerms } from "../../services/ai.service";
import { getCached, saveAnalysis, type CachedResult } from "../../services/cache.service";
import { processTermsText } from "../../services/text.service";

export type AnalyzeOrchestratorResult = Omit<AnalyzeSuccessResponse, "requestId">;

export interface AnalyzeOrchestratorDependencies {
  getCachedByDomain: (domain: string) => Promise<CachedResult | null>;
  processText: (rawText: string) => { cleanedText: string; hash: string; wasTruncated: boolean };
  analyzeCleanedText: (cleanedText: string) => Promise<AnalysisResult>;
  persistAnalysis: (domain: string, tcUrl: string, hash: string, analysis: AnalysisResult) => Promise<void>;
}

function withDependencies(
  overrides?: Partial<AnalyzeOrchestratorDependencies>
): AnalyzeOrchestratorDependencies {
  return {
    getCachedByDomain: overrides?.getCachedByDomain ?? getCached,
    processText: overrides?.processText ?? processTermsText,
    analyzeCleanedText: overrides?.analyzeCleanedText ?? analyzeTerms,
    persistAnalysis: overrides?.persistAnalysis ?? saveAnalysis
  };
}

function mapCachedToResponse(cached: CachedResult): AnalyzeOrchestratorResult {
  return {
    cached: true,
    updatedSince: false,
    analyzedAt: cached.analyzedAt,
    riskScore: cached.riskScore,
    riskLabel: cached.riskLabel,
    summary: cached.summary,
    redFlags: cached.redFlags
  };
}

export async function orchestrateAnalyze(
  request: AnalyzeRequest,
  overrides?: Partial<AnalyzeOrchestratorDependencies>
): Promise<AnalyzeOrchestratorResult> {
  const deps = withDependencies(overrides);
  const cached = await deps.getCachedByDomain(request.domain);

  if (cached && cached.textHash === request.textHash) {
    return mapCachedToResponse(cached);
  }

  const processed = deps.processText(request.text);
  if (processed.wasTruncated) {
    logger.warn("Terms text exceeded max length and was truncated.", {
      domain: request.domain
    });
  }

  // Defensive cache check after canonicalization in case client hash strategy changes.
  if (cached && cached.textHash === processed.hash) {
    return mapCachedToResponse(cached);
  }

  const analysis = await deps.analyzeCleanedText(processed.cleanedText);
  await deps.persistAnalysis(request.domain, request.tcUrl, processed.hash, analysis);

  return {
    cached: false,
    updatedSince: Boolean(cached),
    analyzedAt: new Date().toISOString(),
    riskScore: analysis.riskScore,
    riskLabel: analysis.riskLabel,
    summary: analysis.summary,
    redFlags: analysis.redFlags
  };
}
