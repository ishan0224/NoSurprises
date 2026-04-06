import type { AnalysisResult } from "@contracts/api";

import { AppError } from "../lib/errors";
import { getSupabaseAdminClient } from "../lib/supabase-admin";

export interface AnalysisRecord extends AnalysisResult {
  id: string;
  websiteId: string;
  contentHash: string;
  analyzedAt: string;
  isLatest: boolean;
}

export interface SaveAnalysisAtomicInput extends AnalysisResult {
  domain: string;
  tcUrl: string;
  contentHash: string;
  analyzedAt?: string;
}

export interface AnalysesRepository {
  getLatestByWebsiteId(websiteId: string): Promise<AnalysisRecord | null>;
  saveLatestAtomic(input: SaveAnalysisAtomicInput): Promise<AnalysisRecord>;
}

function toAnalysisRecord(row: {
  id: string;
  website_id: string;
  content_hash: string;
  risk_score: number | string;
  risk_label: "Low Risk" | "Medium Risk" | "High Risk";
  summary: string;
  red_flags: AnalysisResult["redFlags"];
  analyzed_at: string;
  is_latest: boolean;
}): AnalysisRecord {
  return {
    id: row.id,
    websiteId: row.website_id,
    contentHash: row.content_hash,
    riskScore: Number(row.risk_score),
    riskLabel: row.risk_label,
    summary: row.summary,
    redFlags: row.red_flags,
    analyzedAt: row.analyzed_at,
    isLatest: row.is_latest
  };
}

export const analysesRepository: AnalysesRepository = {
  async getLatestByWebsiteId(websiteId: string): Promise<AnalysisRecord | null> {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("analyses")
      .select(
        "id, website_id, content_hash, risk_score, risk_label, summary, red_flags, analyzed_at, is_latest"
      )
      .eq("website_id", websiteId)
      .eq("is_latest", true)
      .maybeSingle();

    if (error) {
      throw new AppError("INTERNAL_ERROR", "Failed to fetch latest analysis.", { cause: error });
    }
    if (!data) {
      return null;
    }
    return toAnalysisRecord(data);
  },

  async saveLatestAtomic(input: SaveAnalysisAtomicInput): Promise<AnalysisRecord> {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .rpc("save_analysis_version", {
        p_domain: input.domain,
        p_tc_url: input.tcUrl,
        p_content_hash: input.contentHash,
        p_risk_score: input.riskScore,
        p_risk_label: input.riskLabel,
        p_summary: input.summary,
        p_red_flags: input.redFlags,
        p_analyzed_at: input.analyzedAt ?? new Date().toISOString()
      })
      .single();

    if (error) {
      throw new AppError("INTERNAL_ERROR", "Failed to save analysis atomically.", { cause: error });
    }
    return toAnalysisRecord(
      data as {
        id: string;
        website_id: string;
        content_hash: string;
        risk_score: number | string;
        risk_label: "Low Risk" | "Medium Risk" | "High Risk";
        summary: string;
        red_flags: AnalysisResult["redFlags"];
        analyzed_at: string;
        is_latest: boolean;
      }
    );
  }
};
