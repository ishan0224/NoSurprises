import { describe, expect, it } from "vitest";

import { resetEnvForTests } from "../../lib/env";
import { proxy } from "../../proxy";

function withEnv<T>(env: Record<string, string>, fn: () => T): T {
  const previous = { ...process.env };
  process.env = { ...process.env, ...env };
  resetEnvForTests();
  try {
    return fn();
  } finally {
    process.env = previous;
    resetEnvForTests();
  }
}

describe("proxy CORS integration", () => {
  it("handles OPTIONS preflight for allowed origin", () => {
    const response = withEnv(
      {
        ALLOWED_ORIGINS: "chrome-extension://abc123"
      },
      () =>
        proxy(
          new Request("http://localhost/api/analyze", {
            method: "OPTIONS",
            headers: {
              origin: "chrome-extension://abc123"
            }
          })
        )
    );

    expect(response).toBeDefined();
    expect(response?.status).toBe(200);
    expect(response?.headers.get("access-control-allow-origin")).toBe("chrome-extension://abc123");
  });

  it("blocks disallowed origin for API route", () => {
    const response = withEnv(
      {
        ALLOWED_ORIGINS: "chrome-extension://abc123"
      },
      () =>
        proxy(
          new Request("http://localhost/api/analyze", {
            method: "POST",
            headers: {
              origin: "chrome-extension://blocked"
            }
          })
        )
    );

    expect(response).toBeDefined();
    expect(response?.status).toBe(403);
  });
});
