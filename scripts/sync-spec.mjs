#!/usr/bin/env node
/**
 * Vendor the published OpenAPI document into spec/openapi.json.
 *
 * The SDK never fetches this at runtime - it is a test fixture, and the
 * conformance suite is the thing that reads it. Committing it means a PR diff
 * shows the API surface change, and the daily spec-sync workflow turns a
 * change nobody told us about into a pull request.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const url = process.env.RANKRAFT_SPEC_URL ?? "https://api.rankraft.ai/v1/openapi.json";
const out = fileURLToPath(new URL("../spec/openapi.json", import.meta.url));

const res = await fetch(url, { headers: { accept: "application/json" } });
if (!res.ok) {
  console.error(`sync-spec: ${url} returned ${res.status} ${res.statusText}`);
  process.exit(1);
}
const spec = await res.json();
if (typeof spec?.openapi !== "string" || typeof spec?.paths !== "object") {
  console.error("sync-spec: that did not look like an OpenAPI document");
  process.exit(1);
}
writeFileSync(out, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`sync-spec: wrote ${Object.keys(spec.paths).length} paths from ${url} (info.version=${spec.info?.version ?? "?"})`);
