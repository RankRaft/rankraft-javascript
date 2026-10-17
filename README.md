<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/brand/rankraft-mark-dark-bg.svg">
    <img src=".github/brand/rankraft-mark-light-bg.svg" alt="RankRaft AI" width="72" height="72">
  </picture>
</p>

<h1 align="center">rankraft</h1>

<p align="center">Official Node.js client for the <a href="https://rankraft.ai">RankRaft AI</a> API - how AI answer engines and AI crawlers see your brand.</p>

<p align="center">
  <a href="https://rankraft.ai"><b>rankraft.ai</b></a> &nbsp;·&nbsp;
  <a href="https://docs.rankraft.ai">Docs</a> &nbsp;·&nbsp;
  <a href="https://app.rankraft.ai">Dashboard</a> &nbsp;·&nbsp;
  <a href="https://docs.rankraft.ai/api-reference/introduction">API reference</a>
</p>

```bash
npm install rankraft
```

> **Server-side only.** `api.rankraft.ai` sends no CORS headers, deliberately,
> and a RankRaft AI key reads every site in your organisation. The client throws if
> you construct it in a browser. See [Why there is no browser build](#why-there-is-no-browser-build).

The API is **Enterprise-only**. Create a key in the dashboard under
**Settings → API**; it is shown once.

## Quick start

```ts
import { RankRaft, f } from "rankraft";

const rr = new RankRaft(); // reads RANKRAFT_API_KEY

const sites = await rr.sites.list();          // or rr.sites.get({ site_id })
const site = sites[0]!;

const page = await rr.reports.visibility({
  site_id: site.id,
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  group_by: ["platform"],
  metrics: ["visibility_score", "mention_rate", "citation_rate"],
  filter: f.and(f.in("platform", ["chatgpt", "ai_mode"]), f.not(f.is("category", "Brand"))),
});

console.log(page.info.total_results, page.data);
```

Numbers here equal the numbers on your dashboard by construction - both are
scored by the same package, not by two implementations of the same formula.

## Pagination

Every report method returns something that is **awaitable for the first page and
async-iterable for every row**.

```ts
// first page
const page = await rr.reports.citations({ site_id, start_date, end_date });

// every row, every page
for await (const row of rr.reports.citations({ site_id, start_date, end_date })) {
  await warehouse.write(row);
}

// or collect
const rows = await rr.reports.bots({ site_id, start_date, end_date }).all();
```

The cursor carries a fingerprint of the query that produced it (every field
except `cursor` and `limit`, canonicalised). The client freezes the body it
sent on page one and re-sends it with only `cursor` substituted, so the
fingerprint always matches. Change the filter, range, grouping or metrics
between pages and the API answers `InvalidCursorError` - start again without a
cursor. `limit` may change between pages.

## Errors

```ts
import { RateLimitError, ValidationError, PlanRequiredError } from "rankraft";

try {
  await rr.reports.visibility({ ... });
} catch (err) {
  if (err instanceof RateLimitError) console.log(err.retryAfterSeconds);
  if (err instanceof ValidationError) console.log(err.issues);
  if (err instanceof PlanRequiredError) console.log("needs an Enterprise plan");
}
```

Every `APIError` carries `status`, `code`, `details`, `requestId` and
`attemptRequestIds`. The request id is in the message too, so a pasted stack
trace is enough for support.

| Class | Status · `code` |
|---|---|
| `BadRequestError` | 400 · `invalid_json`, `api_key_in_url` |
| `InvalidCursorError` | 400 · `invalid_cursor` - the query changed between pages |
| `AuthenticationError` | 401 · `invalid_api_key` - missing, unknown, revoked or expired; deliberately one message |
| `PlanRequiredError` | 403 · `plan_required` - not on a live Enterprise plan |
| `PermissionDeniedError` | 403 · `insufficient_permission` - a read key tried to write |
| `NotFoundError` | 404 · `not_found` - no such site **in this organization** (never 403, so ids can't be enumerated) |
| `ConflictError` | 409 · `site_not_set_up` - finish the site's brand profile in the dashboard first |
| `PayloadTooLargeError` | 413 · `payload_too_large` - bodies are capped at 256 KB |
| `ValidationError` | 422 · `invalid_request`, `invalid_filter`, `invalid_date_range`, `invalid_timezone`, `invalid_sort` - `err.issues` has the detail |
| `PromptLimitError` | 422 · `prompt_limit_reached` - `err.remaining` and `err.limit` |
| `RateLimitError` | 429 · `rate_limited` - `err.retryAfterSeconds` |
| `InternalServerError` | 5xx · `internal_error` |

A code this client does not know falls back to the class for its status, so a
new server-side code never crashes a pinned install.

## Retries

On by default, two attempts after the first.

- A **429 is always retried**, because the limiter rejects before the handler
  runs, so nothing happened. `Retry-After` is honoured **exactly** - the window
  has no remaining-count header, so retrying early is guaranteed to fail and
  spends another request from your budget.
- Everything else is retried only when the operation is safe to replay. That is
  a per-operation property, not an HTTP-method guess: the report endpoints are
  POSTs that read.
- `maxRetryWaitMs` (default 70 s) bounds the **total** time the client may spend
  asleep inside one call, so a `Retry-After: 60` cannot silently stall you for
  two minutes. Past that it raises `RateLimitError` and you decide.

```ts
const rr = new RankRaft({
  maxRetries: 2,
  maxRetryWaitMs: 70_000,
  onRetry: ({ attempt, waitMs, reason }) => log.warn({ attempt, waitMs, reason }),
});
```

## Writing prompts

Prompts are the only thing this API writes, and it cannot delete them - deleting cascades away answer history and any Action Center baseline that
targeted the prompt.

```ts
const result = await rr.prompts.create({
  site_id,
  prompts: [{ text: "best mixed pickle brand", category: "Discovery" }],
  dry_run: true,        // see what would happen, change nothing
});
result.created;         // how many would be new
result.existing;        // how many already existed (returned, not duplicated)

await rr.prompts.setStatus({ site_id, prompt_ids: ["pr_1"], status: "disabled" });
```

Up to 100 prompts per call. A request that would exceed the plan's
active-prompt cap is refused whole with `PromptLimitError`.

Text that already exists returns the existing prompt rather than a duplicate.
Prompt text is immutable: changing it would make the history either side of the
edit incomparable while still looking like one series.

## Filters

Pass a plain object, or build one:

```ts
import { f } from "rankraft";

f.and(
  f.in("platform", ["chatgpt", "ai_mode"]),
  f.or(f.contains("prompt", "pricing"), f.not_contains("prompt", "free")),
);
```

Operators: `is`, `not_is`, `in`, `not_in`, `contains`, `not_contains` - all
case-insensitive. Values are strings on the wire; the builder stringifies
numbers and booleans for you (`f.is("verified", true)` sends `"true"`).

Which fields a report accepts: answer reports take `platform`, `prompt` (id
or text) and `category`; citations add `domain`, `owner` and `source_kind`;
traffic reports take `bot_name`, `bot_provider`, `bot_type`, `verified`,
`path`, `page_type` and `referral_source`.

The builder checks grammar and nothing else. Depth, list length, `limit` and
date spans are the server's limits and are not duplicated here - a copy in the
client is a copy that goes stale, and the 422 carries the real number.

## Why there is no browser build

Two separate problems, both fatal:

1. Your key would be in the JavaScript bundle every visitor downloads. A
   RankRaft AI key reads every site in your organisation.
2. `api.rankraft.ai` sends no CORS headers. The request would be blocked before
   it was sent.

So the client throws at construction - not at the first request, because the key
leaks at bundle time, long before any request is made. In a browser extension or
an Electron main process, pass `{ dangerouslyAllowBrowser: true }`.

## Options

| Option | Default |
|---|---|
| `apiKey` | `process.env.RANKRAFT_API_KEY` |
| `baseURL` | `process.env.RANKRAFT_BASE_URL` or `https://api.rankraft.ai/v1` |
| `timeoutMs` | `60000`, per attempt |
| `maxRetries` | `2` |
| `maxRetryWaitMs` | `70000`, total sleep per call |
| `fetch` | global `fetch` |
| `defaultHeaders` | `{}` |
| `userAgentSuffix` | - |
| `onRetry` | - |
| `dangerouslyAllowBrowser` | `false` |

Requires **Node 20+**, or any runtime with `fetch` - Cloudflare Workers, Deno
and Bun included. Zero runtime dependencies. ESM and CommonJS.

## The MCP server

If what you want is to ask questions in Claude, ChatGPT or Cursor rather than
write code, RankRaft AI also serves an MCP server at `mcp.rankraft.ai`. It is
OAuth-based (sign in with your dashboard account), available on every paid
plan, and read-only. This client is for the REST API, which is Enterprise-only
and can also manage prompts.

## Contributing

```bash
pnpm install
pnpm test          # unit suite
pnpm run check     # typecheck, tests, build, publint, attw
pnpm run spec:sync # refresh spec/openapi.json from the live API
```

`test/conformance.test.ts` compares this client against the published OpenAPI
document and is the thing that catches an endpoint we have not modelled. It
skips, loudly, while `spec/openapi.json` is absent.

## Licence

MIT

---

RankRaft AI - [rankraft.ai](https://rankraft.ai) · [docs.rankraft.ai](https://docs.rankraft.ai) · hello@rankraft.ai
