import { describe, expect, it } from "vitest";
import { PaginationError, RankRaft, f, serializeWithCursor, type CitationsParams, type SentimentParams, type VisibilityParams } from "../src/index.js";
import { KEY, envelope, fakeFetch } from "./helpers.js";

const params = {
  site_id: "st_1",
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  group_by: ["platform"],
  metrics: ["visibility_score"],
  filter: f.and(f.in("platform", ["chatgpt", "ai_mode"]), f.not(f.is("category", "Brand"))),
} satisfies VisibilityParams;
const citationParams = { site_id: "st_1", start_date: "2026-09-01", end_date: "2026-09-30", group_by: ["platform"] } satisfies CitationsParams;
const sentimentParams = { site_id: "st_1", start_date: "2026-09-01", end_date: "2026-09-30" } satisfies SentimentParams;

describe("pagination", () => {
  it("re-sends a byte-identical body, with only the cursor appended", async () => {
    // The server binds the cursor to a hash of the body. Any re-serialisation
    // that reorders keys or re-applies defaults would 400 on page two.
    const { fetch, calls } = fakeFetch([
      envelope([{ visibility_score: 41 }], { next_cursor: "c2" }),
      envelope([{ visibility_score: 42 }], { next_cursor: "c3" }),
      envelope([{ visibility_score: 43 }], { next_cursor: null }),
    ]);
    const client = new RankRaft({ apiKey: KEY, fetch });

    const rows = [];
    for await (const row of client.reports.visibility(params)) rows.push(row);

    expect(rows).toHaveLength(3);
    expect(calls).toHaveLength(3);

    const stripCursor = (body: string) => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      delete parsed["cursor"];
      return JSON.stringify(parsed);
    };
    const first = stripCursor(calls[0]!.body!);
    expect(stripCursor(calls[1]!.body!)).toBe(first);
    expect(stripCursor(calls[2]!.body!)).toBe(first);
    expect(JSON.parse(calls[1]!.body!)["cursor"]).toBe("c2");
    expect(JSON.parse(calls[2]!.body!)["cursor"]).toBe("c3");
  });

  it("never reconstructs the body from the echoed filter", async () => {
    // The server echoes a *normalised* filter. Round-tripping it is the exact
    // bug that produces a 400 on page two.
    const { fetch, calls } = fakeFetch([
      envelope([{}], { next_cursor: "c2", filter: { and: [{ field: "platform", op: "in", value: ["CHATGPT"] }] } }),
      envelope([{}], { next_cursor: null }),
    ]);
    const client = new RankRaft({ apiKey: KEY, fetch });
    await client.reports.visibility(params).all();
    expect(calls[1]!.body).toContain('"chatgpt"');
    expect(calls[1]!.body).not.toContain("CHATGPT");
  });

  it("refuses to loop when the API hands back the same cursor", async () => {
    const { fetch } = fakeFetch([envelope([{}], { next_cursor: "same" }), envelope([{}], { next_cursor: "same" })]);
    const client = new RankRaft({ apiKey: KEY, fetch });
    await expect(client.reports.visibility(params).all()).rejects.toBeInstanceOf(PaginationError);
  });

  it("is awaitable for page one and iterable for every row", async () => {
    const { fetch } = fakeFetch([envelope([{ a: 1 }], { next_cursor: "c2", total_results: 2 }), envelope([{ a: 2 }], { next_cursor: null })]);
    const client = new RankRaft({ apiKey: KEY, fetch });
    const page = await client.reports.citations(citationParams);
    expect(page.data).toHaveLength(1);
    expect(page.info.total_results).toBe(2);
    expect(page.hasNextPage()).toBe(true);
    const next = await page.getNextPage();
    expect(next.hasNextPage()).toBe(false);
  });

  it("does not re-request when a PagePromise is awaited after iterating", async () => {
    const { fetch, calls } = fakeFetch([envelope([{ a: 1 }], { next_cursor: null })]);
    const client = new RankRaft({ apiKey: KEY, fetch });
    const promise = client.reports.sentiment(sentimentParams);
    await promise.all();
    await promise;
    expect(calls).toHaveLength(1);
  });

  it("paginates a GET through the query string", async () => {
    const { fetch, calls } = fakeFetch([envelope([{ id: "p1" }], { next_cursor: "c2" }), envelope([{ id: "p2" }], { next_cursor: null })]);
    const client = new RankRaft({ apiKey: KEY, fetch });
    const prompts = await client.prompts.list({ site_id: "st_1", status: "active" }).all();
    expect(prompts).toHaveLength(2);
    expect(calls[0]!.url).toContain("status=active");
    expect(calls[0]!.url).not.toContain("cursor=");
    expect(calls[1]!.url).toContain("cursor=c2");
  });

  it("drops any caller-supplied cursor from the frozen body and appends it last", () => {
    const body = serializeWithCursor({ b: 2, cursor: "stale", a: 1 }, "fresh");
    expect(body).toBe('{"b":2,"a":1,"cursor":"fresh"}');
    expect(serializeWithCursor({ b: 2, a: 1 })).toBe('{"b":2,"a":1}');
  });
});
