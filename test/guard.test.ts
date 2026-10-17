import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserEnvironmentError, RankRaft } from "../src/index.js";
import { resetBrowserWarning } from "../src/core/guard.js";
import { KEY } from "./helpers.js";

function pretendBrowser(): () => void {
  (globalThis as Record<string, unknown>)["window"] = { document: { createElement: () => ({}) } };
  return () => {
    delete (globalThis as Record<string, unknown>)["window"];
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["window"];
  resetBrowserWarning();
  vi.restoreAllMocks();
});

describe("the browser guard", () => {
  it("throws at construction, not at the first request", () => {
    // The key leaks at bundle time, long before any request is made, and the
    // request itself would only produce an opaque CORS failure.
    const restore = pretendBrowser();
    try {
      expect(() => new RankRaft({ apiKey: KEY })).toThrow(BrowserEnvironmentError);
    } finally {
      restore();
    }
  });

  it("explains both failures: the exposed key and the absent CORS headers", () => {
    const restore = pretendBrowser();
    try {
      const err = (() => {
        try {
          new RankRaft({ apiKey: KEY });
        } catch (e) {
          return e as Error;
        }
        throw new Error("expected a throw");
      })();
      expect(err.message).toContain("readable by every");
      expect(err.message).toContain("no CORS headers");
      expect(err.message).toContain("dangerouslyAllowBrowser");
    } finally {
      restore();
    }
  });

  it("lets an extension through, loudly, when it opts in", () => {
    const restore = pretendBrowser();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(() => new RankRaft({ apiKey: KEY, dangerouslyAllowBrowser: true })).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });

  it("does not fire on a bare window with no document", () => {
    // Some non-browser runtimes define `window`. Workers and Deno must pass.
    (globalThis as Record<string, unknown>)["window"] = {};
    expect(() => new RankRaft({ apiKey: KEY })).not.toThrow();
  });
});
