/**
 * Every error this client throws.
 *
 * Mapping is by `error.code` first and HTTP status second, so a code the API
 * adds later lands on the right status class instead of crashing a pinned
 * client. The mirror image of this hierarchy exists in the Python SDK under the
 * same names, so one support answer covers both.
 */

import { parseRetryAfter } from "./core/retry.js";

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
  request_id?: string;
}

export class RankRaftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Something about how the client was constructed, before any request. */
export class ConfigurationError extends RankRaftError {}

/** Constructed in a browser. See core/guard.ts for why this is fatal. */
export class BrowserEnvironmentError extends RankRaftError {}

/** The request never produced an HTTP response. */
export class APIConnectionError extends RankRaftError {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export class APITimeoutError extends APIConnectionError {}

/** Auto-pagination could not make progress, or the caller mutated mid-loop. */
export class PaginationError extends RankRaftError {}

export interface APIErrorInit {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  requestId: string | null;
  headers: Record<string, string>;
  attempts: number;
  attemptRequestIds: string[];
}

export class APIError extends RankRaftError {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  /**
   * The last attempt's id. `cf-ray` changes per attempt, so a retried call has
   * several; `attemptRequestIds` holds them all, and support needs the list.
   */
  readonly requestId: string | null;
  readonly headers: Record<string, string>;
  readonly attempts: number;
  readonly attemptRequestIds: string[];

  constructor(init: APIErrorInit) {
    // The id goes in the message, not only on a property. A customer pastes a
    // stack trace; they do not know to read `err.requestId`.
    const suffix = [
      init.requestId ? `request_id=${init.requestId}` : null,
      init.attempts > 1 ? `attempt ${init.attempts}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    super(`rankraft ${init.status} ${init.code} — ${init.message}${suffix ? ` (${suffix})` : ""}`);
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.headers = init.headers;
    this.attempts = init.attempts;
    this.attemptRequestIds = init.attemptRequestIds;
  }
}

export class BadRequestError extends APIError {}
/**
 * The cursor belongs to a different query. The server fingerprints every
 * field except `cursor` and `limit`, so this means the filter, range, grouping
 * or metrics changed between pages. Start again without a cursor.
 */
export class InvalidCursorError extends BadRequestError {}
export class AuthenticationError extends APIError {}
export class PlanRequiredError extends APIError {}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
/** 409. Today only `site_not_set_up`: the site has no brand profile yet. */
export class ConflictError extends APIError {}
export class PayloadTooLargeError extends APIError {}
export class ValidationError extends APIError {
  /** The server's `details`, narrowed when it is a list. */
  get issues(): unknown[] {
    return Array.isArray(this.details) ? this.details : [];
  }
}
/** 422 `prompt_limit_reached`. `details` carries limit, active, requested, remaining. */
export class PromptLimitError extends ValidationError {
  get remaining(): number | null {
    const d = this.details as { remaining?: unknown } | null;
    return typeof d?.remaining === "number" ? d.remaining : null;
  }
  get limit(): number | null {
    const d = this.details as { limit?: unknown } | null;
    return typeof d?.limit === "number" ? d.limit : null;
  }
}
export class RateLimitError extends APIError {
  get retryAfterSeconds(): number | null {
    const ms = parseRetryAfter(this.headers["retry-after"]);
    return ms === null ? null : Math.ceil(ms / 1000);
  }
  get limit(): string | null {
    return this.headers["x-ratelimit-limit"] ?? null;
  }
  get policy(): string | null {
    return this.headers["x-ratelimit-policy"] ?? null;
  }
}
export class InternalServerError extends APIError {}

/**
 * Error codes we know by name. Unknown codes fall through to the status class,
 * which is why a new server-side code can never break an older client.
 *
 * The conformance test asserts these keys equal the spec's error-code enum.
 */
export const ERROR_CODE_CLASSES: Record<string, typeof APIError> = {
  // 400
  invalid_json: BadRequestError,
  invalid_cursor: InvalidCursorError,
  api_key_in_url: BadRequestError,
  // 401 / 403
  invalid_api_key: AuthenticationError,
  plan_required: PlanRequiredError,
  insufficient_permission: PermissionDeniedError,
  // 404 / 409 / 413 / 415
  not_found: NotFoundError,
  site_not_set_up: ConflictError,
  payload_too_large: PayloadTooLargeError,
  unsupported_media_type: BadRequestError,
  // 422 — all validation, one of them with structured details
  invalid_request: ValidationError,
  invalid_filter: ValidationError,
  invalid_date_range: ValidationError,
  invalid_timezone: ValidationError,
  invalid_sort: ValidationError,
  prompt_limit_reached: PromptLimitError,
  // 429 / 5xx
  rate_limited: RateLimitError,
  internal_error: InternalServerError,
};

const STATUS_CLASSES: Record<number, typeof APIError> = {
  400: BadRequestError,
  401: AuthenticationError,
  403: PlanRequiredError,
  404: NotFoundError,
  409: ConflictError,
  413: PayloadTooLargeError,
  422: ValidationError,
  429: RateLimitError,
};

export function errorFrom(init: APIErrorInit): APIError {
  const byCode = ERROR_CODE_CLASSES[init.code];
  if (byCode) return new byCode(init);
  // 403 is ambiguous by status alone — plan_required and
  // insufficient_permission share it — so the code above is what distinguishes
  // them and this is only the fallback.
  const byStatus = STATUS_CLASSES[init.status] ?? (init.status >= 500 ? InternalServerError : APIError);
  return new byStatus(init);
}
