import { Readability } from "@mozilla/readability";
import type {
  ExtensionMessage,
  TcFoundMessage,
  TcLinksFoundMessage,
  TcNotFoundMessage
} from "@contracts/extension-messages";
import type { TcLink } from "@contracts/storage";

export type ExtractedTermsPayload = Pick<TcFoundMessage, "domain" | "tcUrl" | "text" | "textHash">;

const TERMS_KEYWORDS = [
  "terms",
  "legal",
  "privacy",
  "tos",
  "eula",
  "conditions",
  "agreement",
  "policy",
  "policies",
  "datenschutz"
] as const;

const MAX_LINK_CANDIDATES = 5;
export const MAX_EXTRACTED_TEXT_LENGTH = 120_000;
export const MIN_LEGAL_TEXT_LENGTH = 800;
export const MIN_LEGAL_KEYWORD_HITS = 5;

const LEGAL_QUALITY_KEYWORDS = [
  "terms",
  "conditions",
  "liability",
  "refund",
  "cancellation",
  "warranty",
  "indemn",
  "governing law",
  "arbitration",
  "privacy",
  "account",
  "booking",
  "check-in",
  "travel document",
  "fees"
] as const;

const LEGAL_SECTION_MARKERS = [
  "terms of service",
  "limitation of liability",
  "disclaimer",
  "refund",
  "cancellation",
  "check-in",
  "travel documents",
  "responsibilities",
  "pricing",
  "governing law"
] as const;

export interface ReadabilityResultLike {
  textContent?: string | null;
}

export interface ReadabilityParserLike {
  parse: () => ReadabilityResultLike | null;
}

export type ReadabilityFactory = (documentNode: Document) => ReadabilityParserLike;

interface ExtractionCandidate {
  source: "readability" | "full_body";
  text: string;
  length: number;
  legalKeywordHits: number;
  sectionMarkerHits: number;
  qualityScore: number;
}

const EXTRACTOR_RUN_COMMAND = "RUN_EXTRACTION";
export type ExtractorCommandMessage = { type: typeof EXTRACTOR_RUN_COMMAND };

export const normalizeDomain = (hostname: string): string => hostname.replace(/^www\./i, "").toLowerCase();

const includesTermsKeyword = (value: string): boolean => {
  const normalizedValue = value.toLowerCase();
  return TERMS_KEYWORDS.some((keyword) => normalizedValue.includes(keyword));
};

export const isTcUrlPath = (pageUrl: string): boolean => {
  try {
    const parsed = new URL(pageUrl);
    return includesTermsKeyword(parsed.pathname);
  } catch {
    return false;
  }
};

export const isTcHeadingText = (documentNode: Document): boolean => {
  const headings = documentNode.querySelectorAll("h1, h2");
  return Array.from(headings).some((heading) => includesTermsKeyword(heading.textContent ?? ""));
};

export const collectTcLinks = (documentNode: Document, pageUrl: string): TcLink[] => {
  const links = documentNode.querySelectorAll("footer a[href], nav a[href]");
  const dedupe = new Set<string>();
  const candidates: TcLink[] = [];

  for (const link of links) {
    if (candidates.length >= MAX_LINK_CANDIDATES) {
      break;
    }

    const rawHref = link.getAttribute("href");
    if (!rawHref) {
      continue;
    }

    const absoluteHref = new URL(rawHref, pageUrl).toString();
    const label = (link.textContent ?? "").replace(/\s+/g, " ").trim() || absoluteHref;
    const isMatch = includesTermsKeyword(label) || includesTermsKeyword(absoluteHref);

    if (!isMatch || dedupe.has(absoluteHref)) {
      continue;
    }

    dedupe.add(absoluteHref);
    candidates.push({
      label,
      href: absoluteHref
    });
  }

  return candidates;
};

export const createReadabilityParser = (documentNode: Document): Readability => {
  const clonedDocument = documentNode.cloneNode(true) as Document;
  return new Readability(clonedDocument, { charThreshold: 0 });
};

export const extractReadabilityText = (
  documentNode: Document,
  parserFactory: ReadabilityFactory = createReadabilityParser
): string | null => {
  const parser = parserFactory(documentNode);
  const article = parser.parse();
  const textContent = article?.textContent?.trim();

  return textContent ? textContent : null;
};

export const fallbackDocumentText = (documentNode: Document): string =>
  documentNode.body?.innerText ?? documentNode.body?.textContent ?? "";

export const cleanExtractedText = (rawText: string): string =>
  rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export const truncateExtractedText = (cleanedText: string): string =>
  cleanedText.length > MAX_EXTRACTED_TEXT_LENGTH
    ? cleanedText.slice(0, MAX_EXTRACTED_TEXT_LENGTH)
    : cleanedText;

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let index = 0;
  let count = 0;
  while (true) {
    const foundAt = haystack.indexOf(needle, index);
    if (foundAt === -1) {
      return count;
    }
    count += 1;
    index = foundAt + needle.length;
  }
}

function computeLegalKeywordHits(lowerText: string): number {
  return LEGAL_QUALITY_KEYWORDS.reduce((total, keyword) => total + countOccurrences(lowerText, keyword), 0);
}

function computeSectionMarkerHits(lowerText: string): number {
  return LEGAL_SECTION_MARKERS.reduce(
    (total, marker) => total + (lowerText.includes(marker) ? 1 : 0),
    0
  );
}

function buildExtractionCandidate(
  source: ExtractionCandidate["source"],
  rawText: string | null | undefined
): ExtractionCandidate | null {
  if (!rawText) {
    return null;
  }

  const cleanedText = truncateExtractedText(cleanExtractedText(rawText));
  if (!cleanedText) {
    return null;
  }

  const lowerText = cleanedText.toLowerCase();
  const legalKeywordHits = computeLegalKeywordHits(lowerText);
  const sectionMarkerHits = computeSectionMarkerHits(lowerText);
  const qualityScore =
    legalKeywordHits * 8 + sectionMarkerHits * 12 + Math.min(cleanedText.length / 2_000, 20);

  return {
    source,
    text: cleanedText,
    length: cleanedText.length,
    legalKeywordHits,
    sectionMarkerHits,
    qualityScore
  };
}

function shouldForceFullBodyForLegalPage(
  bestCandidate: ExtractionCandidate,
  fullBodyCandidate: ExtractionCandidate
): boolean {
  if (
    bestCandidate.length < MIN_LEGAL_TEXT_LENGTH ||
    bestCandidate.legalKeywordHits < MIN_LEGAL_KEYWORD_HITS
  ) {
    return true;
  }

  if (
    bestCandidate.source === "readability" &&
    fullBodyCandidate.length > bestCandidate.length * 2 &&
    fullBodyCandidate.legalKeywordHits >= bestCandidate.legalKeywordHits + 2
  ) {
    return true;
  }

  return false;
}

export function selectBestLegalTextCandidate(
  documentNode: Document,
  pageUrl: string,
  readabilityText: string | null,
  fullBodyText: string
): string {
  const fullBodyCandidate = buildExtractionCandidate("full_body", fullBodyText);
  if (!fullBodyCandidate) {
    return "";
  }

  const readabilityCandidate = buildExtractionCandidate("readability", readabilityText);
  const bestCandidate =
    readabilityCandidate && readabilityCandidate.qualityScore > fullBodyCandidate.qualityScore
      ? readabilityCandidate
      : fullBodyCandidate;

  const isLikelyLegalPage = isTcUrlPath(pageUrl) || isTcHeadingText(documentNode);
  if (!isLikelyLegalPage) {
    return bestCandidate.text;
  }

  return shouldForceFullBodyForLegalPage(bestCandidate, fullBodyCandidate)
    ? fullBodyCandidate.text
    : bestCandidate.text;
}

export const toSha256Hex = async (input: string): Promise<string> => {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const createTcFoundMessage = async (
  documentNode: Document,
  pageUrl: string,
  parserFactory: ReadabilityFactory = createReadabilityParser
): Promise<TcFoundMessage> => {
  const parsed = new URL(pageUrl);
  const domain = normalizeDomain(parsed.hostname);
  const readabilityText = extractReadabilityText(documentNode, parserFactory);
  const fullBodyText = fallbackDocumentText(documentNode);
  const text = selectBestLegalTextCandidate(documentNode, pageUrl, readabilityText, fullBodyText);
  const textHash = await toSha256Hex(text);

  return {
    type: "TC_FOUND",
    domain,
    tcUrl: parsed.toString(),
    text,
    textHash
  };
};

export const buildExtractorMessage = async (
  documentNode: Document,
  pageUrl: string
): Promise<TcFoundMessage | TcLinksFoundMessage | TcNotFoundMessage> => {
  const parsed = new URL(pageUrl);
  const domain = normalizeDomain(parsed.hostname);

  if (isTcUrlPath(pageUrl) || isTcHeadingText(documentNode)) {
    return createTcFoundMessage(documentNode, pageUrl);
  }

  const links = collectTcLinks(documentNode, pageUrl);
  if (links.length > 0) {
    return {
      type: "TC_LINKS_FOUND",
      domain,
      links
    };
  }

  return {
    type: "TC_NOT_FOUND",
    domain,
    pageUrl: parsed.toString()
  };
};

export const executeExtractor = async (
  documentNode: Document = document,
  pageUrl: string = window.location.href,
  sendMessage: (message: ExtensionMessage) => Promise<unknown> | unknown = (message) =>
    chrome.runtime.sendMessage(message)
): Promise<TcFoundMessage | TcLinksFoundMessage | TcNotFoundMessage> => {
  const message = await buildExtractorMessage(documentNode, pageUrl);
  await Promise.resolve(sendMessage(message));
  return message;
};

interface ExtractorWindow extends Window {
  __nosurprisesExtractorRuntimeInitialized?: boolean;
}

const isExtractorCommandMessage = (value: unknown): value is ExtractorCommandMessage => {
  if (!value || typeof value !== "object") {
    return false;
  }
  return (value as { type?: unknown }).type === EXTRACTOR_RUN_COMMAND;
};

export const initializeExtractorRuntime = (
  runtimeWindow: ExtractorWindow = window,
  runtimeDocument: Document = document
): void => {
  if (runtimeWindow.__nosurprisesExtractorRuntimeInitialized) {
    return;
  }
  runtimeWindow.__nosurprisesExtractorRuntimeInitialized = true;

  chrome.runtime.onMessage.addListener((rawMessage) => {
    if (!isExtractorCommandMessage(rawMessage)) {
      return;
    }
    void executeExtractor(runtimeDocument, runtimeWindow.location.href);
  });

  // First injection should immediately run extraction once.
  void executeExtractor(runtimeDocument, runtimeWindow.location.href);
};

if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  typeof chrome !== "undefined" &&
  typeof chrome.runtime?.sendMessage === "function" &&
  typeof chrome.runtime?.onMessage?.addListener === "function"
) {
  initializeExtractorRuntime();
}
