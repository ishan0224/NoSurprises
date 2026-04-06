import { describe, expect, it } from "vitest";

import { analyzeTerms } from "../../services/ai.service";

function createMockClient(responses: string[]) {
  let index = 0;
  let calls = 0;

  return {
    getCalls() {
      return calls;
    },
    client: {
      async generate(_prompt: string): Promise<string> {
        calls += 1;
        const value = responses[index];
        index += 1;
        if (value === undefined) {
          throw new Error("No mock response available.");
        }
        return value;
      }
    }
  };
}

describe("ai.service", () => {
  it("parses valid JSON output from model", async () => {
    const validJson = JSON.stringify({
      riskScore: 7.4,
      riskLabel: "High Risk",
      summary: "The terms contain significant unilateral rights.",
      redFlags: [
        {
          title: "Unilateral changes",
          quote: "We may modify these terms at any time.",
          severity: "high"
        }
      ]
    });
    const { client, getCalls } = createMockClient([validJson]);

    const result = await analyzeTerms("sample cleaned terms", { client });

    expect(result.riskScore).toBe(7.4);
    expect(result.riskLabel).toBe("High Risk");
    expect(result.redFlags).toHaveLength(1);
    expect(getCalls()).toBe(1);
  });

  it("retries once when first model response is malformed and then succeeds", async () => {
    const malformed = "not-json";
    const validJson = JSON.stringify({
      riskScore: 3.2,
      riskLabel: "Low Risk",
      summary: "The terms are relatively balanced.",
      redFlags: []
    });
    const { client, getCalls } = createMockClient([malformed, validJson]);

    const result = await analyzeTerms("sample cleaned terms", { client });

    expect(result.riskLabel).toBe("Low Risk");
    expect(getCalls()).toBe(2);
  });

  it("throws UPSTREAM_AI_FAILED when model returns malformed output twice", async () => {
    const { client, getCalls } = createMockClient(["not-json", "still-not-json"]);

    await expect(analyzeTerms("sample cleaned terms", { client })).rejects.toMatchObject({
      code: "UPSTREAM_AI_FAILED"
    });
    expect(getCalls()).toBe(2);
  });

  it("throws INVALID_REQUEST when cleaned text is empty", async () => {
    await expect(
      analyzeTerms("   ", { client: { generate: async (_prompt: string) => "{}" } })
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST"
    });
  });
});
