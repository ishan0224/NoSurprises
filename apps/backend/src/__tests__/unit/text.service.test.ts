import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  MAX_CLEANED_TEXT_LENGTH,
  canonicalizeText,
  computeSha256Hex,
  processTermsText
} from "../../services/text.service";

describe("text.service", () => {
  it("strips residual HTML tags, collapses whitespace, trims, and lowercases", () => {
    const raw = "  <main>HELLO\n\n   WORLD</main>   ";
    const cleaned = canonicalizeText(raw);

    expect(cleaned).toBe("hello world");
  });

  it("computes hash from cleaned text deterministically", () => {
    const raw = " <div>HELLO     WORLD</div> ";
    const first = processTermsText(raw);
    const second = processTermsText(raw);

    expect(first.cleanedText).toBe("hello world");
    expect(first.hash).toBe(second.hash);
    expect(first.hash).toBe(computeSha256Hex("hello world"));
  });

  it("hashes cleaned output instead of raw input", () => {
    const raw = "<p>  HELLO     WORLD  </p>";
    const processed = processTermsText(raw);
    const rawHash = createHash("sha256").update(raw, "utf8").digest("hex");

    expect(processed.hash).not.toBe(rawHash);
    expect(processed.hash).toBe(computeSha256Hex(processed.cleanedText));
  });

  it("truncates cleaned text at MAX_CLEANED_TEXT_LENGTH and marks truncation", () => {
    const raw = `  ${"A".repeat(MAX_CLEANED_TEXT_LENGTH + 10)}  `;
    const processed = processTermsText(raw);

    expect(processed.wasTruncated).toBe(true);
    expect(processed.cleanedText.length).toBe(MAX_CLEANED_TEXT_LENGTH);
    expect(processed.cleanedText).toBe("a".repeat(MAX_CLEANED_TEXT_LENGTH));
  });

  it("does not mark truncation when cleaned text is within limit", () => {
    const raw = "Terms";
    const processed = processTermsText(raw);

    expect(processed.wasTruncated).toBe(false);
    expect(processed.cleanedText).toBe("terms");
  });
});
