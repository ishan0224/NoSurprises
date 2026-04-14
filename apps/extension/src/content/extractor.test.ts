/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import {
  buildExtractorMessage,
  collectTcLinks,
  createTcFoundMessage,
  executeExtractor,
  extractReadabilityText,
  isTcHeadingText,
  isTcUrlPath,
  MAX_EXTRACTED_TEXT_LENGTH,
  selectBestLegalTextCandidate,
  truncateExtractedText,
  toSha256Hex
} from "./extractor";

const createDocument = (html: string): Document => {
  const doc = document.implementation.createHTMLDocument("test");
  doc.body.innerHTML = html;
  return doc;
};

describe("isTcUrlPath", () => {
  it("returns true for known legal path keywords", () => {
    expect(isTcUrlPath("https://example.com/legal/terms-of-service")).toBe(true);
    expect(isTcUrlPath("https://example.com/datenschutz")).toBe(true);
  });

  it("returns false for non-legal paths", () => {
    expect(isTcUrlPath("https://example.com/pricing")).toBe(false);
    expect(isTcUrlPath("https://example.com/company/about")).toBe(false);
  });
});

describe("isTcHeadingText", () => {
  it("detects legal headings in h1/h2 tags", () => {
    const doc = createDocument("<h1>Terms and Conditions</h1><p>Body</p>");
    expect(isTcHeadingText(doc)).toBe(true);
  });

  it("returns false when headings are unrelated", () => {
    const doc = createDocument("<h1>Home</h1><h2>Features</h2>");
    expect(isTcHeadingText(doc)).toBe(false);
  });
});

describe("collectTcLinks", () => {
  it("collects footer/nav links matching terms keywords and caps at five", () => {
    const doc = createDocument(`
      <footer>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/legal">Legal</a>
        <a href="/tos">TOS</a>
        <a href="/eula">EULA</a>
        <a href="/policy">Policy</a>
      </footer>
      <nav>
        <a href="/contact">Contact</a>
      </nav>
    `);

    const links = collectTcLinks(doc, "https://example.com/home");
    expect(links).toHaveLength(5);
    expect(links[0]?.href).toBe("https://example.com/terms");
    expect(links.every((entry) => entry.href.startsWith("https://example.com/"))).toBe(true);
  });
});

describe("extraction", () => {
  it("extracts text with Readability on valid content", () => {
    const doc = createDocument(`
      <article>
        <h1>Terms of Service</h1>
        <p>This agreement governs use of the product and related services for all users.</p>
        <p>By using the service you accept the conditions, privacy policy, and data handling terms.</p>
      </article>
    `);

    const extracted = extractReadabilityText(doc);
    expect(extracted).toContain("Terms of Service");
    expect(extracted).toContain("agreement governs use");
  });

  it("falls back to body text when Readability returns null", async () => {
    const doc = createDocument("<main><h1>Terms</h1><p>Fallback text should be used.</p></main>");
    const message = await createTcFoundMessage(
      doc,
      "https://www.example.com/legal/terms",
      () => ({ parse: () => null })
    );

    expect(message.text).toContain("Fallback text should be used.");
    expect(message.domain).toBe("example.com");
  });

  it("truncates very large extracted text before hashing/sending", async () => {
    const oversized = "A".repeat(MAX_EXTRACTED_TEXT_LENGTH + 5000);
    const truncated = truncateExtractedText(oversized);

    expect(truncated).toHaveLength(MAX_EXTRACTED_TEXT_LENGTH);
    expect(truncated.endsWith("A")).toBe(true);
  });

  it("falls back to full-body legal content when readability returns promo-like snippet", async () => {
    const doc = createDocument(`
      <h1>Terms of Service</h1>
      <p>Done with complete ease and no hassles at all.</p>
      <section>
        <h2>Terms of the Airlines</h2>
        <p>The airline tickets available through the Website are subject to the terms & conditions of the concerned airline, including cancellation and refund policies.</p>
        <h2>Pricing</h2>
        <p>The total price displayed includes base fare, applicable taxes, and convenience fees.</p>
        <h2>Travel Documents</h2>
        <p>It shall be the sole responsibility of the user to ensure they are in possession of valid travel documents.</p>
      </section>
    `);

    const message = await createTcFoundMessage(
      doc,
      "https://www.makemytrip.com/legal/in/eng/user_agreement.html",
      () => ({
        parse: () => ({
          textContent: "Done with complete ease and no hassles at all."
        })
      })
    );

    expect(message.text.toLowerCase()).toContain("terms of the airlines");
    expect(message.text.toLowerCase()).toContain("travel documents");
    expect(message.text.toLowerCase()).not.toBe("done with complete ease and no hassles at all.");
  });
});

describe("candidate selection", () => {
  it("prefers richer legal candidate for likely legal pages", () => {
    const doc = createDocument("<h1>Terms of Service</h1>");
    const selected = selectBestLegalTextCandidate(
      doc,
      "https://example.com/terms",
      "We may update things from time to time.",
      "Terms of Service. Liability limitations apply. Refund and cancellation policies apply. Travel documents required. Pricing and fees are subject to terms."
    );

    expect(selected.toLowerCase()).toContain("liability");
    expect(selected.toLowerCase()).toContain("refund");
  });
});

describe("hashing", () => {
  it("returns deterministic sha256 hex output", async () => {
    const first = await toSha256Hex("same-content");
    const second = await toSha256Hex("same-content");

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("extractor message flow", () => {
  it("returns TC_FOUND when page is a T&C page", async () => {
    const doc = createDocument("<article><h1>Legal Terms</h1><p>Sample</p></article>");
    const message = await buildExtractorMessage(doc, "https://example.com/legal");

    expect(message.type).toBe("TC_FOUND");
  });

  it("returns TC_LINKS_FOUND when legal links are in nav/footer on non-T&C page", async () => {
    const doc = createDocument("<footer><a href=\"/terms\">Terms and Conditions</a></footer>");
    const message = await buildExtractorMessage(doc, "https://example.com/home");

    expect(message.type).toBe("TC_LINKS_FOUND");
    if (message.type === "TC_LINKS_FOUND") {
      expect(message.links).toHaveLength(1);
    }
  });

  it("returns TC_NOT_FOUND when no legal signal exists", async () => {
    const doc = createDocument("<main><h1>Welcome</h1><p>Hello</p></main>");
    const message = await buildExtractorMessage(doc, "https://example.com/home");

    expect(message.type).toBe("TC_NOT_FOUND");
  });

  it("sends exactly one message during execution", async () => {
    const doc = createDocument("<footer><a href=\"/terms\">Terms</a></footer>");
    const sendMessage = vi.fn();

    await executeExtractor(doc, "https://example.com/home", sendMessage);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]?.type).toBe("TC_LINKS_FOUND");
  });
});
