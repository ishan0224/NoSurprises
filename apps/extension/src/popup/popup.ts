import type { AnalyzeErrorBody, AnalyzeSuccessResponse, RedFlag, RiskLabel } from "@contracts/api";
import type { AnalysisStatus, TcLink } from "@contracts/storage";
import type { AnalysisErrorMessage, AnalysisReadyMessage, RetryAnalysisMessage } from "@contracts/extension-messages";
import {
  POPUP_COPY,
  POPUP_ERROR_MESSAGES,
  RED_FLAG_SEVERITY_CLASS,
  RED_FLAG_SEVERITY_LABELS,
  RISK_LABEL_CLASS
} from "../shared/constants";
import {
  makeAnalysisStorageKey,
  makeErrorStorageKey,
  makeLinksStorageKey,
  makeStatusStorageKey
} from "../shared/storage";

type PopupStatus = AnalysisStatus | "idle";

export interface PopupViewState {
  domain: string;
  pageUrl: string;
  status: PopupStatus;
  tcUrl: string;
  result?: AnalyzeSuccessResponse;
  error?: AnalyzeErrorBody;
  links?: TcLink[];
}

export interface PopupActions {
  onAnalyze: () => Promise<void> | void;
  onRetry: (message: RetryAnalysisMessage) => Promise<void> | void;
}

export interface ChromePopupApi {
  tabs: {
    query: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  };
  storage: {
    local: {
      get: (keys?: string | string[] | object | null) => Promise<Record<string, unknown>>;
    };
  };
  runtime: {
    sendMessage: (message: unknown) => Promise<unknown> | void;
    onMessage: {
      addListener: (
        callback: (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: () => void) => void
      ) => void;
    };
  };
}

export const normalizeDomain = (hostname: string): string => hostname.replace(/^www\./i, "").toLowerCase();

export const getFriendlyErrorMessage = (error?: AnalyzeErrorBody): string => {
  if (!error) {
    return POPUP_ERROR_MESSAGES.INTERNAL_ERROR;
  }

  return POPUP_ERROR_MESSAGES[error.code] ?? POPUP_ERROR_MESSAGES.INTERNAL_ERROR;
};

const createElement = <T extends keyof HTMLElementTagNameMap>(
  tagName: T,
  className?: string,
  text?: string
): HTMLElementTagNameMap[T] => {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (typeof text === "string") {
    node.textContent = text;
  }
  return node;
};

export const renderRedFlag = (flag: RedFlag): HTMLElement => {
  const item = createElement("li", `red-flag ${RED_FLAG_SEVERITY_CLASS[flag.severity]}`);
  const title = createElement("p", "red-flag-title", flag.title);
  const quote = createElement("p", "red-flag-quote", flag.quote);
  const severity = createElement(
    "span",
    `red-flag-severity ${RED_FLAG_SEVERITY_CLASS[flag.severity]}`,
    RED_FLAG_SEVERITY_LABELS[flag.severity]
  );

  item.append(title, quote, severity);
  return item;
};

export const renderRiskBadge = (score: number, label: RiskLabel): HTMLElement => {
  const badge = createElement("div", `risk-badge ${RISK_LABEL_CLASS[label]}`);
  badge.textContent = `${score.toFixed(1)} • ${label}`;
  return badge;
};

export const renderLinkList = (links: TcLink[]): HTMLElement => {
  const list = createElement("ul", "links-list");

  for (const link of links) {
    const item = createElement("li", "links-item");
    const anchor = createElement("a", "links-anchor", link.label);
    anchor.href = link.href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    item.append(anchor);
    list.append(item);
  }

  return list;
};

const renderHeadline = (text: string): HTMLElement => createElement("h1", "popup-title", text);

const renderDescription = (text: string): HTMLElement => createElement("p", "popup-description", text);

const renderPrimaryButton = (
  label: string,
  onClick: () => Promise<void> | void,
  options: { disabled?: boolean; id?: string } = {}
): HTMLButtonElement => {
  const button = createElement("button", "popup-button", label);
  if (options.id) {
    button.id = options.id;
  }
  button.type = "button";
  button.disabled = options.disabled ?? false;
  button.addEventListener("click", () => void onClick());
  return button;
};

export const renderPopupState = (
  root: HTMLElement,
  state: PopupViewState,
  actions: PopupActions
): void => {
  root.innerHTML = "";
  const wrapper = createElement("section", "popup");
  wrapper.append(renderHeadline(POPUP_COPY.title));

  switch (state.status) {
    case "loading": {
      wrapper.append(renderDescription(POPUP_COPY.loadingText));
      const button = renderPrimaryButton(POPUP_COPY.idleHeadline, actions.onAnalyze, {
        disabled: true,
        id: "analyze-button"
      });
      wrapper.append(button);
      break;
    }
    case "ready": {
      wrapper.append(createElement("h2", "section-title", POPUP_COPY.readyHeadline));
      if (state.result) {
        wrapper.append(renderRiskBadge(state.result.riskScore, state.result.riskLabel));
        if (state.result.updatedSince) {
          wrapper.append(createElement("div", "updated-banner", POPUP_COPY.updatedBanner));
        }
        wrapper.append(renderDescription(state.result.summary));

        if (state.result.redFlags.length > 0) {
          wrapper.append(createElement("h3", "section-subtitle", POPUP_COPY.redFlagsHeadline));
          const list = createElement("ul", "red-flags-list");
          state.result.redFlags.forEach((flag) => list.append(renderRedFlag(flag)));
          wrapper.append(list);
        }
      }

      const retryMessage: RetryAnalysisMessage = {
        type: "RETRY_ANALYSIS",
        domain: state.domain,
        tcUrl: state.tcUrl
      };
      wrapper.append(renderPrimaryButton(POPUP_COPY.reanalyzeLabel, () => actions.onRetry(retryMessage), { id: "retry-button" }));
      break;
    }
    case "links_found": {
      wrapper.append(renderDescription(POPUP_COPY.linksHeadline));
      wrapper.append(renderLinkList(state.links ?? []));
      wrapper.append(renderDescription(POPUP_COPY.linksSubtext));
      break;
    }
    case "not_found": {
      wrapper.append(renderDescription(POPUP_COPY.notFoundHeadline));
      wrapper.append(renderDescription(POPUP_COPY.notFoundSubtext));
      const retryMessage: RetryAnalysisMessage = {
        type: "RETRY_ANALYSIS",
        domain: state.domain,
        tcUrl: state.tcUrl
      };
      wrapper.append(renderPrimaryButton(POPUP_COPY.retryLabel, () => actions.onRetry(retryMessage), { id: "retry-button" }));
      break;
    }
    case "error": {
      wrapper.append(renderDescription(getFriendlyErrorMessage(state.error)));
      const retryMessage: RetryAnalysisMessage = {
        type: "RETRY_ANALYSIS",
        domain: state.domain,
        tcUrl: state.tcUrl
      };
      wrapper.append(renderPrimaryButton(POPUP_COPY.retryLabel, () => actions.onRetry(retryMessage), { id: "retry-button" }));
      break;
    }
    case "idle":
    default: {
      wrapper.append(renderDescription(POPUP_COPY.idleSubtext));
      wrapper.append(renderPrimaryButton(POPUP_COPY.idleHeadline, actions.onAnalyze, { id: "analyze-button" }));
      break;
    }
  }

  root.append(wrapper);
};

const createDefaultState = (pageUrl: string): PopupViewState => {
  const parsed = new URL(pageUrl);
  const domain = normalizeDomain(parsed.hostname);
  return {
    domain,
    pageUrl: parsed.toString(),
    status: "idle",
    tcUrl: parsed.toString()
  };
};

export const loadPopupState = async (chromeApi: ChromePopupApi, pageUrl: string): Promise<PopupViewState> => {
  const state = createDefaultState(pageUrl);
  const statusKey = makeStatusStorageKey(state.domain);
  const analysisKey = makeAnalysisStorageKey(state.domain);
  const errorKey = makeErrorStorageKey(state.domain);
  const linksKey = makeLinksStorageKey(state.domain);

  const data = await chromeApi.storage.local.get([statusKey, analysisKey, errorKey, linksKey]);

  const statusRecord = data[statusKey] as { status?: PopupStatus } | undefined;
  const analysisRecord = data[analysisKey] as { tcUrl?: string; result?: AnalyzeSuccessResponse } | undefined;
  const errorRecord = data[errorKey] as { error?: AnalyzeErrorBody } | undefined;
  const linksRecord = data[linksKey] as { links?: TcLink[] } | undefined;

  return {
    ...state,
    status: statusRecord?.status ?? "idle",
    tcUrl: analysisRecord?.tcUrl ?? state.tcUrl,
    result: analysisRecord?.result,
    error: errorRecord?.error,
    links: linksRecord?.links
  };
};

export const initPopup = async (
  documentNode: Document = document,
  chromeApi: ChromePopupApi = chrome as unknown as ChromePopupApi
): Promise<void> => {
  const root = documentNode.getElementById("app");
  if (!root) {
    return;
  }

  const [activeTab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  const pageUrl = typeof activeTab?.url === "string" ? activeTab.url : "https://example.com";
  let state = await loadPopupState(chromeApi, pageUrl);

  const render = (): void =>
    renderPopupState(root, state, {
      onAnalyze: async () => {
        state = { ...state, status: "loading" };
        render();
        await Promise.resolve(chromeApi.runtime.sendMessage({ type: "ANALYZE_PAGE" }));
      },
      onRetry: async (message) => {
        state = { ...state, status: "loading" };
        render();
        await Promise.resolve(chromeApi.runtime.sendMessage(message));
      }
    });

  render();

  chromeApi.runtime.onMessage.addListener((rawMessage) => {
    if (!rawMessage || typeof rawMessage !== "object" || !("type" in rawMessage)) {
      return;
    }

    const message = rawMessage as AnalysisReadyMessage | AnalysisErrorMessage;
    if (message.type === "ANALYSIS_READY" && message.domain === state.domain) {
      state = {
        ...state,
        status: "ready",
        result: message.result,
        error: undefined
      };
      render();
      return;
    }

    if (message.type === "ANALYSIS_ERROR" && message.domain === state.domain) {
      state = {
        ...state,
        status: "error",
        error: message.error
      };
      render();
    }
  });
};

declare const chrome: ChromePopupApi | undefined;

if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  typeof chrome !== "undefined" &&
  chrome?.runtime?.onMessage
) {
  void initPopup();
}
