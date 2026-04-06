import type { AnalyzeRequest } from "@contracts/api";
import { z } from "zod";

import { AppError } from "../../lib/errors";

const requestSchema = z.object({
  domain: z.string().trim().min(1),
  tcUrl: z.string().trim().url(),
  textHash: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i, "textHash must be a sha256 hex string"),
  text: z.string().min(1)
});

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

export function parseAnalyzeRequest(body: unknown): AnalyzeRequest {
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("INVALID_REQUEST", "Request validation failed.", { cause: parsed.error });
  }

  return {
    domain: normalizeDomain(parsed.data.domain),
    tcUrl: parsed.data.tcUrl.trim(),
    textHash: parsed.data.textHash.trim().toLowerCase(),
    text: parsed.data.text
  };
}
