import { describe, expect, it } from "vitest";
import {
  APIError,
  AuthenticationError,
  ConfigurationError,
  NotFoundError,
  RankRaft,
  RateLimitError,
  ValidationError,
} from "../src/index.js";
import { KEY, envelope, fakeFetch } from "./helpers.js";

/**
 * These pin decisions, not plumbing. If one of them stops failing when the
 * behaviour is removed, the test has been weakened.
 */
describe("the key never escapes", () => {
  const classes = [APIError, AuthenticationError, NotFoundError, ValidationError, RateLimitError];

  it("appears in no serialised error", () => {
    for (const Cls of classes) {
      const err = new Cls({
        status: 401,
        code: "invalid_api_key",
        message: "nope",
        details: { note: "nothing here" },
        requestId: "r1",
        headers: { "retry-after": "60" },
        attempts: 1,
        attemptRequestIds: ["r1"],
      });
      expect(err.message).not.toContain(KEY);
      expect(String(err)).not.toContain(KEY);
      expect(JSON.stringify(err)).not.toContain(KEY);
      expect(err.stack ?? "").not.toContain(KEY);
    }
  });

  it("appears in no request URL, for any operation", async () => {
    const { fetch, calls } = fakeFetch([envelope([])]);
    const client = new RankRaft({ apiKey: KEY, fetch, maxRetries: 0 });
    await client.sites.list();
    await client.platforms.list();
    await client.prompts.list({ site_id: "s1" });
    await client.reports.visibility({ site_id: "s1", start_date: "2026-01-01", end_date: "2026-01-02" });
    for (const call of calls) {
      expect(call.url).not.toContain(KEY);
      expect(call.body ?? "").not.toContain(KEY);
    }
  });

  it("refuses a baseURL that carries a credential in the query string", () => {
    // The API rejects a key in the query string with a 400 so that keys stay
    // out of access logs. This client will not smuggle one in via config.
    for (const bad of ["https://api.rankraft.ai/v1?api_key=x", "https://api.rankraft.ai/v1?token=x", "https://api.rankraft.ai/v1?key=x"]) {
      expect(() => new RankRaft({ apiKey: KEY, baseURL: bad })).toThrow(ConfigurationError);
    }
    expect(() => new RankRaft({ apiKey: KEY, baseURL: "https://api.rankraft.ai/v1?region=eu" })).not.toThrow();
  });

  it("will not construct without a key", () => {
    const saved = process.env["RANKRAFT_API_KEY"];
    delete process.env["RANKRAFT_API_KEY"];
    try {
      expect(() => new RankRaft()).toThrow(ConfigurationError);
    } finally {
      if (saved !== undefined) process.env["RANKRAFT_API_KEY"] = saved;
    }
  });
});
