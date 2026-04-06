import { AppError } from "../lib/errors";
import { getSupabaseAdminClient } from "../lib/supabase-admin";

export interface WebsiteRecord {
  id: string;
  domain: string;
  tcUrl: string;
  createdAt: string;
}

export interface WebsitesRepository {
  getByDomain(domain: string): Promise<WebsiteRecord | null>;
  upsertByDomain(domain: string, tcUrl: string): Promise<WebsiteRecord>;
}

function toWebsiteRecord(row: {
  id: string;
  domain: string;
  tc_url: string;
  created_at: string;
}): WebsiteRecord {
  return {
    id: row.id,
    domain: row.domain,
    tcUrl: row.tc_url,
    createdAt: row.created_at
  };
}

export const websitesRepository: WebsitesRepository = {
  async getByDomain(domain: string): Promise<WebsiteRecord | null> {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("websites")
      .select("id, domain, tc_url, created_at")
      .eq("domain", domain)
      .maybeSingle();

    if (error) {
      throw new AppError("INTERNAL_ERROR", "Failed to fetch website by domain.", { cause: error });
    }
    if (!data) {
      return null;
    }
    return toWebsiteRecord(data);
  },

  async upsertByDomain(domain: string, tcUrl: string): Promise<WebsiteRecord> {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("websites")
      .upsert(
        {
          domain,
          tc_url: tcUrl
        },
        { onConflict: "domain" }
      )
      .select("id, domain, tc_url, created_at")
      .single();

    if (error) {
      throw new AppError("INTERNAL_ERROR", "Failed to upsert website.", { cause: error });
    }

    return toWebsiteRecord(data);
  }
};
