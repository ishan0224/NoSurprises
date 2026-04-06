import { describe, expect, it } from "vitest";

import type {
  AnalysesRepository,
  AnalysisRecord,
  SaveAnalysisAtomicInput
} from "../../repositories/analyses.repository";
import type { WebsiteRecord, WebsitesRepository } from "../../repositories/websites.repository";
import { getCached, saveAnalysis } from "../../services/cache.service";

class InMemoryWebsitesRepo implements WebsitesRepository {
  private readonly byDomain = new Map<string, WebsiteRecord>();

  async getByDomain(domain: string): Promise<WebsiteRecord | null> {
    return this.byDomain.get(domain) ?? null;
  }

  async upsertByDomain(domain: string, tcUrl: string): Promise<WebsiteRecord> {
    const existing = this.byDomain.get(domain);
    if (existing) {
      const updated: WebsiteRecord = { ...existing, tcUrl };
      this.byDomain.set(domain, updated);
      return updated;
    }

    const created: WebsiteRecord = {
      id: `w_${domain}`,
      domain,
      tcUrl,
      createdAt: new Date().toISOString()
    };
    this.byDomain.set(domain, created);
    return created;
  }
}

class InMemoryAnalysesRepo implements AnalysesRepository {
  private readonly rows: AnalysisRecord[] = [];
  private idCounter = 1;

  async getLatestByWebsiteId(websiteId: string): Promise<AnalysisRecord | null> {
    const found = this.rows.find((row) => row.websiteId === websiteId && row.isLatest);
    return found ?? null;
  }

  async saveLatestAtomic(input: SaveAnalysisAtomicInput): Promise<AnalysisRecord> {
    const websiteId = `w_${input.domain}`;

    for (const row of this.rows) {
      if (row.websiteId === websiteId) {
        row.isLatest = false;
      }
    }

    const existing = this.rows.find(
      (row) => row.websiteId === websiteId && row.contentHash === input.contentHash
    );

    if (existing) {
      existing.riskScore = input.riskScore;
      existing.riskLabel = input.riskLabel;
      existing.summary = input.summary;
      existing.redFlags = input.redFlags;
      existing.analyzedAt = input.analyzedAt ?? new Date().toISOString();
      existing.isLatest = true;
      return existing;
    }

    const created: AnalysisRecord = {
      id: `a_${this.idCounter++}`,
      websiteId,
      contentHash: input.contentHash,
      riskScore: input.riskScore,
      riskLabel: input.riskLabel,
      summary: input.summary,
      redFlags: input.redFlags,
      analyzedAt: input.analyzedAt ?? new Date().toISOString(),
      isLatest: true
    };

    this.rows.push(created);
    return created;
  }
}

describe("cache.service integration", () => {
  it("returns cached result on cache hit", async () => {
    const websites = new InMemoryWebsitesRepo();
    const analyses = new InMemoryAnalysesRepo();
    const domain = "spotify.com";
    const website = await websites.upsertByDomain(domain, "https://spotify.com/legal");
    await analyses.saveLatestAtomic({
      domain,
      tcUrl: website.tcUrl,
      contentHash: "hash_1",
      riskScore: 7.5,
      riskLabel: "High Risk",
      summary: "Risky terms.",
      redFlags: []
    });

    const result = await getCached(domain, { websitesRepo: websites, analysesRepo: analyses });

    expect(result).not.toBeNull();
    expect(result?.textHash).toBe("hash_1");
    expect(result?.riskLabel).toBe("High Risk");
  });

  it("returns null on cache miss", async () => {
    const websites = new InMemoryWebsitesRepo();
    const analyses = new InMemoryAnalysesRepo();

    const result = await getCached("missing.com", { websitesRepo: websites, analysesRepo: analyses });
    expect(result).toBeNull();
  });

  it("saves new analysis hash and exposes it as latest", async () => {
    const websites = new InMemoryWebsitesRepo();
    const analyses = new InMemoryAnalysesRepo();
    const domain = "example.com";
    const website = await websites.upsertByDomain(domain, "https://example.com/terms");

    await saveAnalysis(
      domain,
      website.tcUrl,
      "hash_old",
      {
        riskScore: 2,
        riskLabel: "Low Risk",
        summary: "Old summary",
        redFlags: []
      },
      { websitesRepo: websites, analysesRepo: analyses }
    );

    await saveAnalysis(
      domain,
      website.tcUrl,
      "hash_new",
      {
        riskScore: 8,
        riskLabel: "High Risk",
        summary: "New summary",
        redFlags: []
      },
      { websitesRepo: websites, analysesRepo: analyses }
    );

    const cached = await getCached(domain, { websitesRepo: websites, analysesRepo: analyses });
    expect(cached?.textHash).toBe("hash_new");
    expect(cached?.riskScore).toBe(8);
  });

  it("maps unknown DB errors to INTERNAL_ERROR", async () => {
    const failingWebsites: WebsitesRepository = {
      async getByDomain(): Promise<WebsiteRecord | null> {
        throw new Error("db down");
      },
      async upsertByDomain(): Promise<WebsiteRecord> {
        throw new Error("db down");
      }
    };

    const analyses = new InMemoryAnalysesRepo();

    await expect(
      getCached("spotify.com", { websitesRepo: failingWebsites, analysesRepo: analyses })
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR"
    });
  });
});
