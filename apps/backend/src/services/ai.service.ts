import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AnalysisResult } from "@contracts/api";
import { z } from "zod";

import { getEnv } from "../lib/env";
import { AppError } from "../lib/errors";

export const AI_MODEL_NAME = "gemini-3-flash-preview";

export const ANALYSIS_PROMPT_TEMPLATE = [
  "You are a legal risk analysis assistant.",
  "Analyze the provided Terms and Conditions text and return JSON only.",
  "Do not include markdown, code fences, or any explanatory text.",
  "Return exactly this shape:",
  '{ "riskScore": number, "riskLabel": "Low Risk" | "Medium Risk" | "High Risk", "summary": string, "redFlags": [{ "title": string, "quote": string, "severity": "low" | "medium" | "high" }] }',
  "Rules:",
  "- riskScore must be between 0 and 10.",
  "- summary must be plain English.",
  "- Include at most 5 redFlags.",
  "- Each redFlag quote must come from the text."
].join("\n");

const analysisResultSchema: z.ZodType<AnalysisResult> = z.object({
  riskScore: z.number().min(0).max(10),
  riskLabel: z.enum(["Low Risk", "Medium Risk", "High Risk"]),
  summary: z.string().trim().min(1),
  redFlags: z
    .array(
      z.object({
        title: z.string().trim().min(1),
        quote: z.string().trim().min(1),
        severity: z.enum(["low", "medium", "high"])
      })
    )
    .max(5)
});

export interface AiModelClient {
  generate(prompt: string): Promise<string>;
}

class MalformedModelOutputError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MalformedModelOutputError";
  }
}

export function buildAnalysisPrompt(cleanedText: string): string {
  return `${ANALYSIS_PROMPT_TEMPLATE}\n\nTerms and Conditions:\n${cleanedText}`;
}

function extractJsonPayload(rawResponse: string): string {
  const trimmed = rawResponse.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    return withoutFence;
  }

  return withoutFence.slice(start, end + 1);
}

function parseModelOutput(rawResponse: string): AnalysisResult {
  const payload = extractJsonPayload(rawResponse);
  let parsed: unknown;

  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    throw new MalformedModelOutputError("Model output is not valid JSON.", { cause: error });
  }

  const result = analysisResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new MalformedModelOutputError("Model output does not match analysis schema.", {
      cause: result.error
    });
  }

  return result.data;
}

function isMalformedOutputError(error: unknown): error is MalformedModelOutputError {
  return error instanceof MalformedModelOutputError;
}

export function createGeminiModelClient(apiKey = getEnv().geminiApiKey): AiModelClient {
  if (!apiKey) {
    throw new AppError("INTERNAL_ERROR", "GEMINI_API_KEY is not configured.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: AI_MODEL_NAME });

  return {
    async generate(prompt: string): Promise<string> {
      const response = await model.generateContent(prompt);
      return response.response.text();
    }
  };
}

export async function analyzeTerms(
  cleanedText: string,
  options?: { client?: AiModelClient }
): Promise<AnalysisResult> {
  const text = cleanedText.trim();
  if (!text) {
    throw new AppError("INVALID_REQUEST", "Cannot analyze empty terms text.");
  }

  const client = options?.client ?? createGeminiModelClient();
  const prompt = buildAnalysisPrompt(text);

  // Retry once only when the model returns malformed/invalid JSON output.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let rawResponse: string;
    try {
      rawResponse = await client.generate(prompt);
    } catch (error) {
      throw new AppError("UPSTREAM_AI_FAILED", "Gemini request failed.", { cause: error });
    }

    try {
      return parseModelOutput(rawResponse);
    } catch (error) {
      if (isMalformedOutputError(error) && attempt === 0) {
        continue;
      }

      throw new AppError("UPSTREAM_AI_FAILED", "Gemini returned malformed analysis output.", {
        cause: error
      });
    }
  }

  throw new AppError("UPSTREAM_AI_FAILED", "Gemini analysis failed.");
}
