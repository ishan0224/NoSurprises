import { createHash } from "node:crypto";

import type { AnalyzeRequest } from "@contracts/api";

export const MAX_CLEANED_TEXT_LENGTH = 500_000;

const HTML_TAG_REGEX = /<[^>]*>/g;
const WHITESPACE_REGEX = /\s+/g;

export interface TextProcessingResult {
  cleanedText: AnalyzeRequest["text"];
  hash: AnalyzeRequest["textHash"];
  wasTruncated: boolean;
}

export function stripResidualHtmlTags(input: string): string {
  return input.replace(HTML_TAG_REGEX, " ");
}

export function collapseWhitespace(input: string): string {
  return input.replace(WHITESPACE_REGEX, " ");
}

export function canonicalizeText(rawText: string): string {
  const withoutTags = stripResidualHtmlTags(rawText);
  const collapsed = collapseWhitespace(withoutTags);
  return collapsed.trim().toLowerCase();
}

export function computeSha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function processTermsText(rawText: string): TextProcessingResult {
  const canonical = canonicalizeText(rawText);
  const wasTruncated = canonical.length > MAX_CLEANED_TEXT_LENGTH;
  const cleanedText = wasTruncated ? canonical.slice(0, MAX_CLEANED_TEXT_LENGTH) : canonical;

  return {
    cleanedText,
    hash: computeSha256Hex(cleanedText),
    wasTruncated
  };
}
