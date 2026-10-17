import { APIError, APIConnectionError, APITimeoutError, errorFrom, type ApiErrorBody } from "../errors.js";
import { expandPath, type Operation } from "../operations.js";
import { decide, parseRetryAfter, sleep, type RetryInfo } from "./retry.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface TransportConfig {
  apiKey: string | null;
  baseURL: string;
  timeoutMs: number;
  maxRetries: number;
  maxRetryWaitMs: number;
  fetchImpl: FetchLike;
  defaultHeaders: Record<string, string>;
  userAgent: string;
  onRetry?: (info: RetryInfo) => void;
}

export interface RequestArgs {
  operation: Operation;
  pathParams?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Already serialised. The paginator depends on controlling these bytes. */
  bodyText?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  headers?: Record<string, string>;
}

export interface RawResponse<T> {
  data: T;
  /**
   * The whole parsed body. Most routes answer `{ info, data }` and `data` is
   * what callers want; the prompt writes answer `{ dry_run, created, …, data }`
   * where the fields beside `data` are the point, so they read this instead.
   */
  body: unknown;
  info: Record<string, unknown>;
  requestId: string | null;
  status: number;
  headers: Record<string, string>;
  /** The exact bytes sent, so pagination can assert it resends them. */
  sentBody: string | null;
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function requestIdOf(body: ApiErrorBody | null, headers: Record<string, string>): string | null {
  // The header fallback is not cosmetic: a Cloudflare-level 502 or a body
  // rejected before the handler ran returns no JSON at all, and that is exactly
  // when the id matters most.
  return body?.request_id ?? headers["x-request-id"] ?? headers["cf-ray"] ?? null;
}

export async function performRequest<T>(cfg: TransportConfig, args: RequestArgs): Promise<RawResponse<T>> {
  const { operation } = args;
  const path = expandPath(operation.path, args.pathParams);
  const url = new URL(cfg.baseURL.replace(/\/$/, "") + path);
  for (const [key, value] of Object.entries(args.query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": cfg.userAgent,
    ...cfg.defaultHeaders,
    ...args.headers,
  };
  // The key is a header, always. The API rejects a key in the query string with
  // a 400 precisely so that keys stay out of access logs; this client must
  // never be the thing that puts one there.
  if (operation.authenticated && cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  if (args.bodyText !== undefined) headers["content-type"] = "application/json";

  const maxRetries = args.maxRetries ?? cfg.maxRetries;
  const timeoutMs = args.timeoutMs ?? cfg.timeoutMs;

  let attempt = 0;
  let sleptMs = 0;
  const attemptRequestIds: string[] = [];

  for (;;) {
    attempt += 1;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = args.signal ? anySignal([args.signal, timeoutSignal]) : timeoutSignal;

    let response: Response | null = null;
    let networkError: unknown = null;
    let timedOut = false;

    try {
      response = await cfg.fetchImpl(url.toString(), {
        method: operation.method,
        headers,
        ...(args.bodyText !== undefined ? { body: args.bodyText } : {}),
        signal,
      });
    } catch (err) {
      // A caller-supplied abort is the caller's decision; never retry it.
      if (args.signal?.aborted) throw err;
      timedOut = timeoutSignal.aborted;
      networkError = err;
    }

    if (response) {
      const resHeaders = headersToObject(response.headers);
      const text = await response.text();
      let parsed: unknown = null;
      if (text !== "") {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      const requestId = requestIdOf(parsed as ApiErrorBody | null, resHeaders);
      if (requestId) attemptRequestIds.push(requestId);

      if (response.ok) {
        const envelope = parsed as { info?: Record<string, unknown>; data?: unknown } | null;
        // The spec route is not enveloped; everything else is.
        const data = operation.authenticated && envelope !== null && typeof envelope === "object" && "data" in envelope
          ? (envelope.data as T)
          : (parsed as T);
        return {
          data,
          body: parsed,
          info: (envelope?.info as Record<string, unknown> | undefined) ?? {},
          requestId,
          status: response.status,
          headers: resHeaders,
          sentBody: args.bodyText ?? null,
        };
      }

      const retryAfterMs = parseRetryAfter(resHeaders["retry-after"]);
      const decision = decide({
        operation,
        attempt,
        maxRetries,
        status: response.status,
        retryAfterMs,
        networkError: false,
        timedOut: false,
      });

      if (decision.retry && sleptMs + decision.waitMs <= cfg.maxRetryWaitMs) {
        cfg.onRetry?.({ attempt, maxRetries, waitMs: decision.waitMs, reason: decision.reason!, status: response.status });
        await sleep(decision.waitMs, args.signal);
        sleptMs += decision.waitMs;
        continue;
      }

      const body = (parsed ?? {}) as ApiErrorBody;
      throw errorFrom({
        status: response.status,
        code: body.error?.code ?? fallbackCode(response.status),
        message: body.error?.message ?? response.statusText ?? "request failed",
        details: body.error?.details,
        requestId,
        headers: resHeaders,
        attempts: attempt,
        attemptRequestIds,
      });
    }

    const decision = decide({ operation, attempt, maxRetries, status: null, retryAfterMs: null, networkError: true, timedOut });
    if (decision.retry && sleptMs + decision.waitMs <= cfg.maxRetryWaitMs) {
      cfg.onRetry?.({ attempt, maxRetries, waitMs: decision.waitMs, reason: decision.reason!, status: null });
      await sleep(decision.waitMs, args.signal);
      sleptMs += decision.waitMs;
      continue;
    }

    const message = timedOut
      ? `rankraft: request to ${operation.method} ${operation.path} timed out after ${timeoutMs}ms`
      : `rankraft: could not reach ${url.host}`;
    throw timedOut ? new APITimeoutError(message, networkError) : new APIConnectionError(message, networkError);
  }
}

/** `AbortSignal.any` arrived in Node 20.3; engines says >=20, so cover the gap. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const native = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof native === "function") return native.call(AbortSignal, signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function fallbackCode(status: number): string {
  if (status === 401) return "invalid_api_key";
  if (status === 404) return "not_found";
  if (status === 413) return "payload_too_large";
  if (status === 422) return "validation_failed";
  if (status === 429) return "rate_limited";
  if (status === 409) return "conflict";
  if (status >= 500) return "internal_error";
  return "bad_request";
}

export { APIError };
