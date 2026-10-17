/**
 * The operation table.
 *
 * This is load-bearing code, not documentation. It drives method dispatch, the
 * retry decision, whether a response paginates, and the conformance test that
 * compares this SDK against the published OpenAPI document. A hand-written
 * client only stays honest if there is exactly one place that enumerates what
 * the API can do.
 */

export interface Operation {
  readonly method: "GET" | "POST" | "PATCH";
  /** Route template, with `{site_id}`-style placeholders. Never an expanded URL. */
  readonly path: string;
  /**
   * Whether replaying this request is safe.
   *
   * Deliberately per-operation and never inferred from the HTTP method. Six of
   * our report endpoints are POST but are pure reads, and a method-based policy
   * would be wrong in both directions: it would refuse to retry a timed-out
   * report, and it would happily replay a genuine mutation. The first operation
   * that is unsafe to replay sets this to false and nobody has to remember.
   */
  readonly retryable: boolean;
  /** Whether the response carries `info.next_cursor`. */
  readonly paginates: boolean;
  /** False only for the public spec route, which must not receive a key. */
  readonly authenticated: boolean;
}

export const OPERATIONS = {
  // ---- Discovery -----------------------------------------------------------
  getMe: { method: "GET", path: "/me", retryable: true, paginates: false, authenticated: true },
  listSites: { method: "GET", path: "/sites", retryable: true, paginates: false, authenticated: true },
  getSite: { method: "GET", path: "/sites/{site_id}", retryable: true, paginates: false, authenticated: true },
  listCompetitors: { method: "GET", path: "/sites/{site_id}/competitors", retryable: true, paginates: false, authenticated: true },
  listPlatforms: { method: "GET", path: "/platforms", retryable: true, paginates: false, authenticated: true },
  listActions: { method: "GET", path: "/sites/{site_id}/actions", retryable: true, paginates: false, authenticated: true },

  // ---- Prompts -------------------------------------------------------------
  listPrompts: { method: "GET", path: "/sites/{site_id}/prompts", retryable: true, paginates: true, authenticated: true },
  // Retryable because the endpoint is defined to return the existing prompt for
  // text that already exists, so a replay cannot create a duplicate.
  createPrompts: { method: "POST", path: "/sites/{site_id}/prompts", retryable: true, paginates: false, authenticated: true },
  // Retryable because applying the same patch twice yields the same state.
  updatePrompts: { method: "PATCH", path: "/sites/{site_id}/prompts", retryable: true, paginates: false, authenticated: true },
  setPromptStatus: { method: "PATCH", path: "/sites/{site_id}/prompts/status", retryable: true, paginates: false, authenticated: true },

  // ---- Reports (POST bodies, but pure reads) -------------------------------
  reportVisibility: { method: "POST", path: "/reports/visibility", retryable: true, paginates: true, authenticated: true },
  reportCitations: { method: "POST", path: "/reports/citations", retryable: true, paginates: true, authenticated: true },
  reportSentiment: { method: "POST", path: "/reports/sentiment", retryable: true, paginates: true, authenticated: true },
  reportBots: { method: "POST", path: "/reports/bots", retryable: true, paginates: true, authenticated: true },
  reportReferrals: { method: "POST", path: "/reports/referrals", retryable: true, paginates: true, authenticated: true },
  queryAnswers: { method: "POST", path: "/answers", retryable: true, paginates: true, authenticated: true },

  // ---- Spec ----------------------------------------------------------------
  getOpenApi: { method: "GET", path: "/openapi.json", retryable: true, paginates: false, authenticated: false },
} as const satisfies Record<string, Operation>;

export type OperationName = keyof typeof OPERATIONS;

/** Fill a route template. Values are percent-encoded; a missing one throws. */
export function expandPath(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params[key];
    if (value === undefined || value === "") {
      throw new Error(`rankraft: missing path parameter "${key}" for ${template}`);
    }
    return encodeURIComponent(value);
  });
}
