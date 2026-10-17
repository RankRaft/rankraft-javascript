import type { Operation } from "../operations.js";

/**
 * When to try again, and how long to wait.
 *
 * Two rules carry the weight. Retryability comes from the operation table, not
 * the HTTP method, because this API's reports are POSTs that read. And a 429 is
 * always retryable regardless of the operation, because the rate limiter
 * rejects the request *before* the handler runs, so nothing happened.
 */

const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

export type RetryReason = "connection" | "timeout" | "status" | "rate_limit";

export interface RetryDecision {
  retry: boolean;
  waitMs: number;
  reason: RetryReason | null;
}

export interface RetryInfo {
  attempt: number;
  maxRetries: number;
  waitMs: number;
  reason: RetryReason;
  status: number | null;
}

/** `Retry-After` is seconds or an HTTP date. Anything else is ignored. */
export function parseRetryAfter(raw: string | null | undefined, now = Date.now()): number | null {
  if (raw == null || raw === "") return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** Exponential with full jitter. Used for everything except a 429. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = 500 * 2 ** (attempt - 1);
  return Math.round(random() * Math.min(base, 8_000));
}

export function decide(args: {
  operation: Operation;
  attempt: number;
  maxRetries: number;
  status: number | null;
  retryAfterMs: number | null;
  networkError: boolean;
  timedOut: boolean;
  random?: () => number;
}): RetryDecision {
  const none: RetryDecision = { retry: false, waitMs: 0, reason: null };
  if (args.attempt > args.maxRetries) return none;

  if (args.status === 429) {
    // Honour Retry-After exactly and never sooner. The window is a fixed 60s
    // with no remaining-count header, so an early retry is guaranteed to fail
    // *and* spends another request from the caller's budget.
    return { retry: true, waitMs: args.retryAfterMs ?? 60_000, reason: "rate_limit" };
  }

  if (!args.operation.retryable) return none;

  if (args.networkError || args.timedOut) {
    return { retry: true, waitMs: backoffMs(args.attempt, args.random), reason: args.timedOut ? "timeout" : "connection" };
  }
  if (args.status !== null && RETRYABLE_STATUS.has(args.status)) {
    return { retry: true, waitMs: args.retryAfterMs ?? backoffMs(args.attempt, args.random), reason: "status" };
  }
  return none;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
