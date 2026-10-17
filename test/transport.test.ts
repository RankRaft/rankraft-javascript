import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  ConfigurationError,
  ConflictError,
  InvalidCursorError,
  NotFoundError,
  PlanRequiredError,
  PromptLimitError,
  RankRaft,
  ValidationError,
} from "../src/index.js";
import { KEY, envelope, fakeFetch } from "./helpers.js";

const client = (fetch: ReturnType<typeof fakeFetch>["fetch"], extra = {}) =>
  new RankRaft({ apiKey: KEY, fetch, maxRetries: 0, ...extra });

describe("transport", () => {
  it("sends the key as a header and never in the URL", async () => {
    const { fetch, calls } = fakeFetch([envelope([{ id: "s1" }])]);
    await client(fetch).sites.list();
    const call = calls[0]!;
    expect(call.headers["x-api-key"]).toBe(KEY);
    expect(call.url).not.toContain(KEY);
    expect(call.url).toBe("https://api.rankraft.ai/v1/sites");
  });

  it("unwraps the { info, data } envelope", async () => {
    const { fetch } = fakeFetch([envelope([{ id: "s1", name: "Acme" }], { count: 1 })]);
    const sites = await client(fetch).sites.list();
    expect(sites).toEqual([{ id: "s1", name: "Acme" }]);
  });

  it("expands and encodes path parameters", async () => {
    const { fetch, calls } = fakeFetch([envelope([])]);
    await client(fetch).sites.competitors({ site_id: "a/b" });
    expect(calls[0]!.url).toBe("https://api.rankraft.ai/v1/sites/a%2Fb/competitors");
  });

  it("maps error.code to a class, not just the status", async () => {
    // 403 is two different failures. Only the code tells them apart.
    const { fetch } = fakeFetch([
      { status: 403, body: { error: { code: "plan_required", message: "Enterprise only" }, request_id: "r1" } },
    ]);
    await expect(client(fetch).sites.list()).rejects.toBeInstanceOf(PlanRequiredError);
  });

  it("falls back to the status when the code is unknown", async () => {
    const { fetch } = fakeFetch([{ status: 401, body: { error: { code: "some_future_code", message: "nope" } } }]);
    await expect(client(fetch).sites.list()).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("puts request_id in the message so a pasted stack trace is actionable", async () => {
    const { fetch } = fakeFetch([
      { status: 422, body: { error: { code: "validation_failed", message: "bad limit", details: ["limit"] }, request_id: "req_abc" } },
    ]);
    const err = await client(fetch).sites.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toContain("req_abc");
    expect((err as ValidationError).issues).toEqual(["limit"]);
  });

  it("recovers request_id from the header when there is no JSON body at all", async () => {
    // A Cloudflare-level 502 returns HTML. That is exactly when the id matters.
    const { fetch } = fakeFetch([{ status: 502, text: "<html>bad gateway</html>", headers: { "cf-ray": "ray123" } }]);
    const err = await client(fetch).sites.list().catch((e: unknown) => e);
    expect((err as Error).message).toContain("ray123");
  });

  it("another organization's site id is a 404, not a 403", async () => {
    const { fetch } = fakeFetch([{ status: 404, body: { error: { code: "not_found", message: "no such site" } } }]);
    await expect(client(fetch).sites.actions({ site_id: "someone-elses" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fetches one site and sends the actions status filter as a query parameter", async () => {
    const { fetch, calls } = fakeFetch([envelope({ id: "s1", name: "Acme" }), envelope([])]);
    const c = client(fetch);
    expect(await c.sites.get({ site_id: "s1" })).toEqual({ id: "s1", name: "Acme" });
    await c.sites.actions({ site_id: "s1", status: "all" });
    expect(calls[1]!.url).toBe("https://api.rankraft.ai/v1/sites/s1/actions?status=all");
  });

  it("returns the whole body for prompt writes, whose fields sit beside data", async () => {
    // `{ dry_run, created, existing, data }` — unwrapping to `data` alone
    // would silently drop the counts the caller asked for.
    const { fetch, calls } = fakeFetch([{ body: { dry_run: true, created: 1, existing: 0, data: [{ text: "x", status: "active" }] } }]);
    const result = await client(fetch).prompts.create({ site_id: "s1", prompts: [{ text: "x" }], dry_run: true });
    expect(result).toEqual({ dry_run: true, created: 1, existing: 0, data: [{ text: "x", status: "active" }] });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ dry_run: true, prompts: [{ text: "x" }] });
  });

  it("maps every code the API actually emits", async () => {
    const cases: [number, string, unknown][] = [
      [400, "invalid_cursor", InvalidCursorError],
      [409, "site_not_set_up", ConflictError],
      [422, "invalid_filter", ValidationError],
      [422, "invalid_date_range", ValidationError],
      [422, "prompt_limit_reached", PromptLimitError],
    ];
    for (const [status, code, cls] of cases) {
      const { fetch } = fakeFetch([{ status, body: { error: { code, message: "m", details: { remaining: 3, limit: 20 } }, request_id: "r" } }]);
      const err = await client(fetch).sites.list().catch((e: unknown) => e);
      expect(err, code).toBeInstanceOf(cls as new (...a: never[]) => unknown);
      if (err instanceof PromptLimitError) {
        expect(err.remaining).toBe(3);
        expect(err.limit).toBe(20);
      }
    }
  });

  it("refuses a site key where an API key belongs", () => {
    // The common paste mistake, which would otherwise surface as a bare 401.
    expect(() => new RankRaft({ apiKey: "rr_live_abcdefghijklmnop" })).toThrow(ConfigurationError);
  });

  it("does not send a key to the public spec route", async () => {
    const { fetch, calls } = fakeFetch([{ body: { openapi: "3.1.0", paths: {} } }]);
    const spec = await client(fetch).openapi();
    expect(calls[0]!.headers["x-api-key"]).toBeUndefined();
    expect(spec["openapi"]).toBe("3.1.0");
  });
});
