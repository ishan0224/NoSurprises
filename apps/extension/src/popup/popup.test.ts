/* @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";

import type { PopupActions, PopupViewState } from "./popup";
import {
  reducePopupStateFromRuntimeMessage,
  renderLinkList,
  renderPopupState,
  renderRedFlag,
  renderRiskBadge
} from "./popup";

const baseState: PopupViewState = {
  domain: "example.com",
  pageUrl: "https://example.com/home",
  tcUrl: "https://example.com/terms",
  status: "idle"
};

const createRoot = (): HTMLDivElement => {
  const root = document.createElement("div");
  root.id = "app";
  return root;
};

const createActions = (): PopupActions => ({
  onAnalyze: vi.fn(),
  onRetry: vi.fn()
});

describe("popup state rendering", () => {
  it("renders idle state with analyze CTA", () => {
    const root = createRoot();
    const actions = createActions();

    renderPopupState(root, baseState, actions);

    expect(root.textContent).toContain("Analyze this page");
    expect(root.textContent).toContain("Click to check the Terms & Conditions on this page");
    expect(root.querySelector("#analyze-button")).not.toBeNull();
  });

  it("renders loading state with disabled action", () => {
    const root = createRoot();
    const actions = createActions();

    renderPopupState(root, { ...baseState, status: "loading" }, actions);

    const button = root.querySelector("#analyze-button") as HTMLButtonElement | null;
    expect(root.textContent).toContain("Analyzing Terms & Conditions...");
    expect(button?.disabled).toBe(true);
  });

  it("renders ready state with risk, summary, flags and reanalyze", () => {
    const root = createRoot();
    const actions = createActions();

    renderPopupState(
      root,
      {
        ...baseState,
        status: "ready",
        result: {
          cached: false,
          updatedSince: false,
          analyzedAt: "2026-04-05T00:00:00.000Z",
          riskScore: 7.3,
          riskLabel: "High Risk",
          summary: "Summary text.",
          redFlags: [{ title: "Arbitration", quote: "Waiver clause.", severity: "high" }],
          requestId: "req_1"
        }
      },
      actions
    );

    expect(root.textContent).toContain("Risk Analysis");
    expect(root.textContent).toContain("7.3 • High Risk");
    expect(root.textContent).toContain("Summary text.");
    expect(root.textContent).toContain("Red flags");
    expect(root.querySelector("#retry-button")).not.toBeNull();
  });

  it("renders updated banner when updatedSince is true", () => {
    const root = createRoot();
    const actions = createActions();

    renderPopupState(
      root,
      {
        ...baseState,
        status: "ready",
        result: {
          cached: false,
          updatedSince: true,
          analyzedAt: "2026-04-05T00:00:00.000Z",
          riskScore: 5.1,
          riskLabel: "Medium Risk",
          summary: "Summary",
          redFlags: [],
          requestId: "req_2"
        }
      },
      actions
    );

    expect(root.textContent).toContain("T&C has changed since your last visit");
  });

  it("renders links_found state with link list", () => {
    const root = createRoot();
    const actions = createActions();

    renderPopupState(
      root,
      {
        ...baseState,
        status: "links_found",
        links: [
          { label: "Terms", href: "https://example.com/terms" },
          { label: "Privacy", href: "https://example.com/privacy" }
        ]
      },
      actions
    );

    const anchors = root.querySelectorAll(".links-anchor");
    expect(root.textContent).toContain("We found Terms & Conditions links on this site:");
    expect(anchors).toHaveLength(2);
    expect((anchors[0] as HTMLAnchorElement).href).toBe("https://example.com/terms");
  });

  it("renders not_found state with retry action", () => {
    const root = createRoot();
    const actions = createActions();

    renderPopupState(root, { ...baseState, status: "not_found" }, actions);

    expect(root.textContent).toContain("No Terms & Conditions detected on this page");
    expect(root.querySelector("#retry-button")).not.toBeNull();
  });

  it("renders error state with friendly message and retry", () => {
    const root = createRoot();
    const actions = createActions();

    renderPopupState(
      root,
      {
        ...baseState,
        status: "error",
        error: {
          code: "UPSTREAM_AI_FAILED",
          message: "raw error",
          requestId: "req_err"
        }
      },
      actions
    );

    expect(root.textContent).toContain("The AI service is temporarily unavailable. Please retry shortly.");
    expect(root.querySelector("#retry-button")).not.toBeNull();
  });
});

describe("popup actions", () => {
  it("sends ANALYZE_PAGE via onAnalyze when idle CTA is clicked", () => {
    const root = createRoot();
    const actions = createActions();
    const onAnalyze = actions.onAnalyze as ReturnType<typeof vi.fn>;

    renderPopupState(root, baseState, actions);
    (root.querySelector("#analyze-button") as HTMLButtonElement).click();

    expect(onAnalyze).toHaveBeenCalledTimes(1);
  });

  it("sends RETRY_ANALYSIS payload via onRetry when retry is clicked", () => {
    const root = createRoot();
    const actions = createActions();
    const onRetry = actions.onRetry as ReturnType<typeof vi.fn>;

    renderPopupState(root, { ...baseState, status: "error" }, actions);
    (root.querySelector("#retry-button") as HTMLButtonElement).click();

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]).toEqual({
      type: "RETRY_ANALYSIS",
      domain: "example.com",
      tcUrl: "https://example.com/terms"
    });
  });
});

describe("popup helper renderers", () => {
  it("renders red flag severity classes for low/medium/high", () => {
    const low = renderRedFlag({ title: "Low", quote: "q", severity: "low" });
    const medium = renderRedFlag({ title: "Medium", quote: "q", severity: "medium" });
    const high = renderRedFlag({ title: "High", quote: "q", severity: "high" });

    expect(low.className).toContain("severity-low");
    expect(medium.className).toContain("severity-medium");
    expect(high.className).toContain("severity-high");
  });

  it("renders risk badge and link list helpers", () => {
    const badge = renderRiskBadge(4.4, "Low Risk");
    const list = renderLinkList([{ label: "Terms", href: "https://example.com/terms" }]);

    expect(badge.textContent).toBe("4.4 • Low Risk");
    expect(list.querySelectorAll("a")).toHaveLength(1);
  });
});

describe("popup runtime state reducer", () => {
  it("applies links_found updates for the active domain", () => {
    const updated = reducePopupStateFromRuntimeMessage(baseState, {
      type: "TC_LINKS_FOUND",
      domain: "example.com",
      links: [{ label: "Terms", href: "https://example.com/terms" }]
    });

    expect(updated.status).toBe("links_found");
    expect(updated.links).toEqual([{ label: "Terms", href: "https://example.com/terms" }]);
  });

  it("applies not_found updates for the active domain", () => {
    const updated = reducePopupStateFromRuntimeMessage(baseState, {
      type: "TC_NOT_FOUND",
      domain: "example.com",
      pageUrl: "https://example.com/home"
    });

    expect(updated.status).toBe("not_found");
  });

  it("ignores runtime messages for other domains", () => {
    const updated = reducePopupStateFromRuntimeMessage(baseState, {
      type: "TC_NOT_FOUND",
      domain: "another.com",
      pageUrl: "https://another.com/home"
    });

    expect(updated).toBe(baseState);
  });
});
