import { ConfigurationError } from "./errors.js";
import { assertNotBrowser } from "./core/guard.js";
import { performRequest, type FetchLike, type RawResponse, type RequestArgs, type TransportConfig } from "./core/http.js";
import { Page, PagePromise, serializeWithCursor, type PageInfo } from "./core/pagination.js";
import { OPERATIONS, type OperationName } from "./operations.js";
import { SPEC_VERSION, VERSION } from "./version.js";
import type { RetryInfo } from "./core/retry.js";
import type { DateInput, Me } from "./types.js";

import { SitesResource } from "./resources/sites.js";
import { PlatformsResource } from "./resources/platforms.js";
import { PromptsResource } from "./resources/prompts.js";
import { ReportsResource } from "./resources/reports.js";
import { AnswersResource } from "./resources/answers.js";

export interface RankRaftOptions {
  /** Defaults to `process.env.RANKRAFT_API_KEY`. */
  apiKey?: string;
  /** Defaults to `process.env.RANKRAFT_BASE_URL` or https://api.rankraft.ai/v1. */
  baseURL?: string;
  /** Per attempt, not per call. Default 60s. */
  timeoutMs?: number;
  /** Default 2. Set 0 to disable. */
  maxRetries?: number;
  /**
   * Total time this client may spend asleep inside one logical call.
   *
   * A 429 carries `Retry-After: 60` and the window has no remaining-count
   * header, so honouring it means a real 60-second pause. Default 70s, which
   * permits exactly one rate-limit retry and then raises — a library that
   * silently blocks for two minutes is hostile.
   */
  maxRetryWaitMs?: number;
  fetch?: FetchLike;
  defaultHeaders?: Record<string, string>;
  /** Appended to the User-Agent. The MCP server sets this. */
  userAgentSuffix?: string;
  onRetry?: (info: RetryInfo) => void;
  /** Only for extensions and Electron main. See core/guard.ts. */
  dangerouslyAllowBrowser?: boolean;
}

const DEFAULT_BASE_URL = "https://api.rankraft.ai/v1";
const KEY_LIKE_PARAMS = ["api_key", "apikey", "key", "token", "access_token"];
/** Every RankRaft AI API key starts with this. Site keys (`rr_live_`) are a different thing. */
const KEY_PREFIX = "rr_api_";

/**
 * `process` is not a given: Cloudflare Workers without `nodejs_compat` have no
 * such global, and this client is meant to run there. Read it only if present.
 */
function envVar(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

function runtimeTag(): string {
  const g = globalThis as { process?: { versions?: { node?: string } }; Deno?: { version?: { deno?: string } }; Bun?: { version?: string }; navigator?: { userAgent?: string } };
  if (g.Bun?.version) return `bun/${g.Bun.version}`;
  if (g.Deno?.version?.deno) return `deno/${g.Deno.version.deno}`;
  if (g.process?.versions?.node) return `node/${g.process.versions.node}`;
  if (g.navigator?.userAgent === "Cloudflare-Workers") return "cloudflare-workers";
  return "unknown-runtime";
}

/** Inclusive `YYYY-MM-DD` in UTC, which is how the API defines a scan day. */
export function toDay(value: DateInput): string {
  if (typeof value === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new ConfigurationError(`rankraft: dates must be YYYY-MM-DD, got "${value}"`);
    }
    return value;
  }
  return value.toISOString().slice(0, 10);
}

export class RankRaft {
  readonly sites: SitesResource;
  readonly platforms: PlatformsResource;
  readonly prompts: PromptsResource;
  readonly reports: ReportsResource;
  readonly answers: AnswersResource;

  readonly #config: TransportConfig;

  constructor(options: RankRaftOptions = {}) {
    assertNotBrowser(options.dangerouslyAllowBrowser === true);

    const apiKey = (options.apiKey ?? envVar("RANKRAFT_API_KEY"))?.trim();
    if (!apiKey) {
      throw new ConfigurationError(
        "rankraft: no API key. Pass { apiKey } or set RANKRAFT_API_KEY. Create a key in the dashboard under Settings → API.",
      );
    }
    // The prefix only — never the full shape, which a pinned client must not
    // enforce. This catches the one mistake that is otherwise a confusing
    // 401: pasting a site key (`rr_live_…`) where an API key belongs.
    if (!apiKey.startsWith(KEY_PREFIX)) {
      throw new ConfigurationError(
        `rankraft: that is not an API key — API keys start with "${KEY_PREFIX}". A site key (rr_live_…) is for sending traffic, not reading it.`,
      );
    }

    const baseURL = options.baseURL ?? envVar("RANKRAFT_BASE_URL") ?? DEFAULT_BASE_URL;
    let parsed: URL;
    try {
      parsed = new URL(baseURL);
    } catch {
      throw new ConfigurationError(`rankraft: baseURL is not a valid URL: "${baseURL}"`);
    }
    // Refuse a base URL carrying a credential. The API rejects a key in the
    // query string with a 400 so keys stay out of access logs; this client is
    // not going to be the thing that smuggles one in through configuration.
    for (const name of KEY_LIKE_PARAMS) {
      if (parsed.searchParams.has(name)) {
        throw new ConfigurationError(
          `rankraft: baseURL carries a "${name}" query parameter. Credentials belong in the X-API-Key header, never in a URL.`,
        );
      }
    }

    const ua = [`rankraft-node/${VERSION}`, `spec/${SPEC_VERSION}`, runtimeTag(), options.userAgentSuffix]
      .filter(Boolean)
      .join(" ");

    this.#config = {
      apiKey,
      baseURL,
      timeoutMs: options.timeoutMs ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
      maxRetryWaitMs: options.maxRetryWaitMs ?? 70_000,
      fetchImpl: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
      defaultHeaders: options.defaultHeaders ?? {},
      userAgent: ua,
      ...(options.onRetry ? { onRetry: options.onRetry } : {}),
    };

    this.sites = new SitesResource(this);
    this.platforms = new PlatformsResource(this);
    this.prompts = new PromptsResource(this);
    this.reports = new ReportsResource(this);
    this.answers = new AnswersResource(this);
  }

  /** The key, the organization, the plan and the rate limits it is subject to. */
  async me(): Promise<Me> {
    const res = await this.call<Me>("getMe", {});
    return res.data;
  }

  /** The published OpenAPI document. Unauthenticated; no key is sent. */
  async openapi(): Promise<Record<string, unknown>> {
    const res = await this.call<Record<string, unknown>>("getOpenApi", {});
    return res.data;
  }

  /** Escape hatch for a route this version does not model yet. */
  async request<T = unknown>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    init: { body?: unknown; query?: RequestArgs["query"]; signal?: AbortSignal } = {},
  ): Promise<RawResponse<T>> {
    return performRequest<T>(this.#config, {
      operation: { method, path, retryable: method === "GET", paginates: false, authenticated: true },
      ...(init.query ? { query: init.query } : {}),
      ...(init.body !== undefined ? { bodyText: JSON.stringify(init.body) } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
    });
  }

  /** @internal */
  async call<T>(name: OperationName, args: Omit<RequestArgs, "operation">): Promise<RawResponse<T>> {
    return performRequest<T>(this.#config, { operation: OPERATIONS[name], ...args });
  }

  /**
   * @internal
   * Paginate a POST whose cursor lives in the body.
   *
   * `baseBody` is serialised once per page by `serializeWithCursor`, which
   * drops any cursor and appends the live one last — so every page's bytes are
   * identical apart from one trailing field, which is what the server's
   * body-hash-bound cursor requires.
   */
  paginateBody<TRow>(name: OperationName, baseBody: Record<string, unknown>, signal?: AbortSignal): PagePromise<TRow> {
    const frozen = { ...baseBody };
    const initialCursor = typeof baseBody["cursor"] === "string" ? (baseBody["cursor"] as string) : null;

    const fetchPage = async (cursor: string | null): Promise<Page<TRow>> => {
      const res = await this.call<TRow[]>(name, {
        bodyText: serializeWithCursor(frozen, cursor),
        ...(signal ? { signal } : {}),
      });
      return new Page<TRow>({
        data: res.data ?? [],
        info: res.info as PageInfo,
        requestId: res.requestId,
        cursor,
        fetchPage,
      });
    };

    return new PagePromise<TRow>(() => fetchPage(initialCursor));
  }

  /** @internal Paginate a GET whose cursor is a query parameter. */
  paginateQuery<TRow>(
    name: OperationName,
    pathParams: Record<string, string>,
    query: Record<string, string | number | boolean | null | undefined>,
    signal?: AbortSignal,
  ): PagePromise<TRow> {
    const frozen = { ...query };
    delete frozen["cursor"];
    const initialCursor = typeof query["cursor"] === "string" ? (query["cursor"] as string) : null;

    const fetchPage = async (cursor: string | null): Promise<Page<TRow>> => {
      const res = await this.call<TRow[]>(name, {
        pathParams,
        query: { ...frozen, ...(cursor === null ? {} : { cursor }) },
        ...(signal ? { signal } : {}),
      });
      return new Page<TRow>({
        data: res.data ?? [],
        info: res.info as PageInfo,
        requestId: res.requestId,
        cursor,
        fetchPage,
      });
    };

    return new PagePromise<TRow>(() => fetchPage(initialCursor));
  }
}
