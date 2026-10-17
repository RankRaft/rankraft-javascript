import { describe, expect, it } from "vitest";
import { RankRaft } from "../src/index.js";

/**
 * One real call per endpoint against a staging Enterprise organization.
 *
 * This is the only check on behaviour the OpenAPI document cannot express —
 * above all whether the cursor really does survive a re-sent body, which is
 * the single assumption this client cannot verify any other way. Run it
 * before every release.
 *
 *   RANKRAFT_LIVE=1 RANKRAFT_API_KEY=rr_api_… pnpm exec vitest run test/live.test.ts
 */
const live = process.env["RANKRAFT_LIVE"] === "1" && Boolean(process.env["RANKRAFT_API_KEY"]);
const describeLive = live ? describe : describe.skip;

if (!live) {
  // eslint-disable-next-line no-console
  console.warn("\n  ⚠ live smoke suite skipped: set RANKRAFT_LIVE=1 and RANKRAFT_API_KEY.\n");
}

describeLive("live smoke", () => {
  // describe.skip still evaluates this body, so construction must be guarded.
  const rr = live ? new RankRaft() : (null as unknown as RankRaft);
  const window = { start_date: "2026-09-01", end_date: "2026-09-30" };

  it("identifies the key", async () => {
    const me = await rr.me();
    expect(me.organization.id).toBeTruthy();
    expect(["read", "write"]).toContain(me.key.permission);
  });

  it("lists sites, platforms, competitors and actions", async () => {
    const sites = await rr.sites.list();
    expect(Array.isArray(sites)).toBe(true);
    const site = sites[0];
    if (!site) return;
    await expect(rr.sites.competitors({ site_id: site.id })).resolves.toBeInstanceOf(Array);
    await expect(rr.sites.actions({ site_id: site.id })).resolves.toBeInstanceOf(Array);
    await expect(rr.platforms.list()).resolves.toBeInstanceOf(Array);
  });

  it("pages a report three deep without the cursor being rejected", async () => {
    // The assumption this whole client rests on. If the server hashes raw
    // bytes rather than a canonical form, this is where we find out.
    const sites = await rr.sites.list();
    const site = sites[0];
    if (!site) return;

    let pages = 0;
    for await (const page of rr.reports.visibility({ site_id: site.id, ...window, group_by: ["date"], limit: 1 }).iterPages()) {
      expect(Array.isArray(page.data)).toBe(true);
      if (++pages >= 3) break;
    }
    expect(pages).toBeGreaterThan(0);
  });

  it("returns 404, not 403, for a site in another organization", async () => {
    await expect(rr.sites.actions({ site_id: "00000000-0000-0000-0000-000000000000" })).rejects.toMatchObject({ status: 404 });
  });

  it("sends no CORS headers", async () => {
    const res = await rr.request("GET", "/sites");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["cache-control"]).toContain("no-store");
  });
});
