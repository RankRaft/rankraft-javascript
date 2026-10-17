import { describe, expect, it, vi } from "vitest";
import { OPERATIONS, RankRaft, RateLimitError, ValidationError } from "../src/index.js";
import { backoffMs, decide, parseRetryAfter } from "../src/core/retry.js";
import { KEY, envelope, fakeFetch } from "./helpers.js";

const op = OPERATIONS.reportVisibility;
const write = { ...OPERATIONS.createPrompts, retryable: false };

describe("retry policy", () => {
  it("retries a 429 even for an operation that is not safe to replay", () => {
    // The limiter rejects before the handler runs, so nothing happened.
    const d = decide({ operation: write, attempt: 1, maxRetries: 2, status: 429, retryAfterMs: 60_000, networkError: false, timedOut: false });
    expect(d).toEqual({ retry: true, waitMs: 60_000, reason: "rate_limit" });
  });

  it("honours Retry-After exactly and never sooner", () => {
    // The window is a fixed 60s with no remaining-count header, so an early
    // retry is guaranteed to fail and spends another request.
    const d = decide({ operation: op, attempt: 1, maxRetries: 5, status: 429, retryAfterMs: 60_000, networkError: false, timedOut: false });
    expect(d.waitMs).toBe(60_000);
    expect(backoffMs(1, () => 1)).toBeLessThan(60_000);
  });

  it("never retries a 422", () => {
    const d = decide({ operation: op, attempt: 1, maxRetries: 5, status: 422, retryAfterMs: null, networkError: false, timedOut: false });
    expect(d.retry).toBe(false);
  });

  it("does not retry a 502 for an operation marked unsafe to replay", () => {
    expect(decide({ operation: write, attempt: 1, maxRetries: 5, status: 502, retryAfterMs: null, networkError: false, timedOut: false }).retry).toBe(false);
    expect(decide({ operation: op, attempt: 1, maxRetries: 5, status: 502, retryAfterMs: null, networkError: false, timedOut: false }).retry).toBe(true);
  });

  it("parses Retry-After as seconds or an HTTP date", () => {
    expect(parseRetryAfter("60")).toBe(60_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("not a date")).toBeNull();
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000);
  });

  it("caps the backoff at eight seconds", () => {
    expect(backoffMs(99, () => 1)).toBe(8_000);
  });
});

describe("retry, end to end", () => {
  it("retries a 502 and then succeeds", async () => {
    const { fetch, calls } = fakeFetch([{ status: 502, body: { error: { code: "internal_error", message: "x" } } }, envelope([])]);
    const onRetry = vi.fn();
    const client = new RankRaft({ apiKey: KEY, fetch, maxRetries: 2, onRetry });
    await client.sites.list();
    expect(calls).toHaveLength(2);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("gives up when the total sleep budget would be exceeded, rather than stalling", async () => {
    // Retry-After says 60s; a 100ms budget means we refuse and hand the caller
    // a RateLimitError they can schedule around.
    const { fetch, calls } = fakeFetch([
      { status: 429, body: { error: { code: "rate_limited", message: "slow down" } }, headers: { "retry-after": "60", "x-ratelimit-limit": "120" } },
    ]);
    const client = new RankRaft({ apiKey: KEY, fetch, maxRetries: 5, maxRetryWaitMs: 100 });
    const err = await client.sites.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterSeconds).toBe(60);
    expect((err as RateLimitError).limit).toBe("120");
    expect(calls).toHaveLength(1);
  });

  it("does not retry a validation failure", async () => {
    const { fetch, calls } = fakeFetch([{ status: 422, body: { error: { code: "validation_failed", message: "no" } } }]);
    const client = new RankRaft({ apiKey: KEY, fetch, maxRetries: 3 });
    await expect(client.sites.list()).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(1);
  });

  it("reports every attempt's request id, because cf-ray changes per attempt", async () => {
    const { fetch } = fakeFetch([
      // retry-after: 0 keeps the test deterministic without a real sleep.
      { status: 503, body: { error: { code: "internal_error", message: "x" }, request_id: "ray1" }, headers: { "retry-after": "0" } },
      { status: 503, body: { error: { code: "internal_error", message: "x" }, request_id: "ray2" }, headers: { "retry-after": "0" } },
    ]);
    const client = new RankRaft({ apiKey: KEY, fetch, maxRetries: 1, maxRetryWaitMs: 1000 });
    const err = await client.sites.list().catch((e: unknown) => e);
    expect((err as { attemptRequestIds: string[] }).attemptRequestIds).toEqual(["ray1", "ray2"]);
  });
});
